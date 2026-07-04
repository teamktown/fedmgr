/**
 * fedmgr-mcp — MCP server for letsfederate trust infrastructure
 *
 * Exposes 10 tools covering federation status, entity enrollment,
 * trustmark issuance/verification, trust chain validation, and local CA
 * initialization. Uses stdio transport for compatibility with all MCP clients.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  validateTrustmark,
  validateTrustChain,
  formatTrustMessage,
  type TrustResult,
} from "@letsfederate/kms";
// SSRF guard — single source of truth lives in @letsfederate/kms (Finding #10).
import { assertSafeUrl, UrlSafetyError } from "@letsfederate/kms";
import { MemoryOpenBaoTransitClient, OpenBaoTransitProvider } from "@letsfederate/kms";
import type { JWK } from "jose";
import {
  provisionMcpTrustCircle,
  mcpKeyName,
  validateMcpInvocation,
  MCP_TRUST_MARK_ID,
} from "./openid-ops.js";
import { log, withSpan } from "./telemetry.js";
import {
  OIDF_TRUST_EXTENSION_ID,
  buildOidfTrustExtension,
} from "./oidf-trust-extension.js";

// Re-export the trust primitives so downstream packages (e.g. @letsfederate/waypoint,
// the trust multiplexer) can consume them — this package's exports map is restricted
// to "." so deep imports are blocked.
export {
  OIDF_TRUST_EXTENSION_ID,
  buildOidfTrustExtension,
  evaluateOidfTrust,
} from "./oidf-trust-extension.js";
export type {
  OidfTrustExtension,
  OidfTrustPolicy,
  OidfTrustDecision,
} from "./oidf-trust-extension.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// DEFAULT_TA_URL is the *network location* used to reach the Trust Anchor in the
// local lab. DEFAULT_TRUST_ANCHOR_ID is the canonical *entity identity* (the OIDF
// issuer / `iss`). In OpenID Federation an entity_id is a stable HTTPS URL that
// also serves discovery — but identity and reachable location are distinct, so a
// local lab can resolve the canonical id to localhost. SPEC: OIDF §"Entity
// Identifiers". (https://openid.net/specs/openid-federation-1_1.html)
const DEFAULT_TA_URL = "http://localhost:8090";
const DEFAULT_TMI_URL = "http://localhost:8080";
const DEFAULT_TRUST_ANCHOR_ID = "https://trust.letsfederate.org";
// fedmgr-mcp's own entity identity under the canonical anchor (patient zero: the
// tool that issues trust also advertises its own trust). FEDMGR_MCP_ENTITY_ID may
// be overridden for self-hosted deployments.
const FEDMGR_MCP_ENTITY_ID =
  process.env["FEDMGR_MCP_ENTITY_ID"] ?? `${DEFAULT_TRUST_ANCHOR_ID}/mcp/fedmgr-mcp`;

const TOOL_NAMES = [
  "federation_status",
  "list_subordinates",
  "enroll_server",
  "complete_enrollment",
  "issue_trustmark",
  "verify_trustmark",
  "check_trust_chain",
  "validate_mcp_invocation",
  "provision_mcp_trust_circle",
  "revoke_subordinate",
  "get_signed_config",
  "initialize_local_ca",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 1024 * 1024; // 1 MB

/**
 * Perform a JSON fetch, returning the parsed body.
 * Enforces a 10s timeout and 1MB response size cap to prevent DoS.
 * Throws with a descriptive message on HTTP errors or parse failures.
 */
async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  // Size cap: check Content-Length header first, then body length
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > FETCH_MAX_BYTES) {
    throw new Error(`Response too large (${contentLength} bytes, max ${FETCH_MAX_BYTES})`);
  }
  const text = await res.text();
  if (text.length > FETCH_MAX_BYTES) {
    throw new Error(`Response too large (${text.length} bytes, max ${FETCH_MAX_BYTES})`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Decode a compact JWT without signature verification, returning header + payload.
 * WARNING: This function performs NO cryptographic verification. Use only for
 * displaying informational content to the user, never for authorization decisions.
 */
function unsafeDecodeJwtParts(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Not a valid compact JWT");
  const decode = (b64: string): Record<string, unknown> =>
    JSON.parse(
      Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      )
    ) as Record<string, unknown>;
  return { header: decode(parts[0]!), payload: decode(parts[1]!) };
}

/**
 * Format a TrustResult into a human-readable multi-line summary.
 */
function summarizeTrustResult(result: TrustResult): string {
  const lines: string[] = [
    `State: ${result.state}`,
    `Message: ${result.message}`,
  ];
  if (result.subject && result.subject !== "(unknown)") {
    lines.push(`Subject: ${result.subject}`);
  }
  if (result.issuer) lines.push(`Issuer: ${result.issuer}`);
  if (result.trustmarkId) lines.push(`Trustmark ID: ${result.trustmarkId}`);
  if (result.trustAnchor) lines.push(`Trust Anchor: ${result.trustAnchor}`);
  if (result.chainDepth !== undefined) lines.push(`Chain Depth: ${result.chainDepth}`);
  if (result.expiresAt) lines.push(`Expires At: ${result.expiresAt.toISOString()}`);
  if (result.adoptedFrom) {
    lines.push(`Adopted From: ${result.adoptedFrom.issuer} (id: ${result.adoptedFrom.trustmarkId})`);
  }
  if (result.recommendedAction) {
    lines.push(`\nRecommended Action: ${result.recommendedAction}`);
  }
  return lines.join("\n");
}

/**
 * Build a tool result text block with an optional [TRUST:*] prefix.
 */
function trustPrefix(result: TrustResult): string {
  if (result.state === "VALID") return "[TRUST:VALID]";
  if (result.state === "WARN") return "[TRUST:WARN]";
  return "[TRUST:FAIL]";
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/** Validate a URL arg; returns the cleaned URL string or throws with a user-friendly message. */
function requireSafeUrl(rawUrl: string, fieldName: string): string {
  try {
    return assertSafeUrl(rawUrl, fieldName).toString().replace(/\/$/, "");
  } catch (err) {
    if (err instanceof UrlSafetyError) throw new Error(`[TRUST:FAIL] ${err.message}`);
    throw err;
  }
}

async function toolFederationStatus(args: Record<string, unknown>): Promise<string> {
  const taUrl  = requireSafeUrl(String(args["ta_url"]  ?? DEFAULT_TA_URL),  "ta_url");
  const tmiUrl = requireSafeUrl(String(args["tmi_url"] ?? DEFAULT_TMI_URL), "tmi_url");

  const results: string[] = [];

  for (const [label, url] of [
    ["Trust Anchor (TA)", taUrl],
    ["Trust Mark Issuer (TMI)", tmiUrl],
  ] as [string, string][]) {
    try {
      const data = await fetchJson(`${url}/health`);
      results.push(`${label} [${url}]: UP\n${JSON.stringify(data, null, 2)}`);
    } catch (err) {
      results.push(`${label} [${url}]: DOWN — ${String(err)}`);
    }
  }

  return results.join("\n\n");
}

async function toolListSubordinates(args: Record<string, unknown>): Promise<string> {
  const taUrl = requireSafeUrl(String(args["ta_url"] ?? DEFAULT_TA_URL), "ta_url");
  const entityType = String(args["entity_type"] ?? "all");

  let url = `${taUrl}/federation_list`;
  if (entityType !== "all") {
    url += `?entity_type=${encodeURIComponent(entityType)}`;
  }

  const data = await fetchJson(url);
  return `Registered entities (type=${entityType}):\n${JSON.stringify(data, null, 2)}`;
}

interface SearchResultItem {
  entityId: string;
  status?: string;
  score: number;
  distance: number;
}

async function toolSearchFederation(args: Record<string, unknown>): Promise<string> {
  const taUrl = requireSafeUrl(String(args["ta_url"] ?? DEFAULT_TA_URL), "ta_url");
  const query = String(args["query"] ?? "").trim();
  if (!query) throw new Error("query is required");
  const kRaw = Number(args["k"] ?? 5);
  const k = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(Math.floor(kRaw), 50) : 5;

  const url =
    `${taUrl}/federation_search?q=${encodeURIComponent(query)}&k=${encodeURIComponent(String(k))}`;
  const data = (await fetchJson(url)) as { results?: SearchResultItem[] };

  const results = data.results ?? [];
  if (results.length === 0) {
    return `No federation entities matched "${query}".`;
  }

  const lines = results.map((r, i) => {
    const pct = (r.score * 100).toFixed(1);
    const status = r.status ? ` [${r.status}]` : "";
    return `${i + 1}. ${r.entityId}${status} — ${pct}% match`;
  });
  return [
    `Top ${results.length} federation entities for "${query}":`,
    "",
    ...lines,
    "",
    "Full response:",
    JSON.stringify(data, null, 2),
  ].join("\n");
}

async function toolEnrollServer(args: Record<string, unknown>): Promise<string> {
  const taUrl    = requireSafeUrl(String(args["ta_url"]    ?? DEFAULT_TA_URL), "ta_url");
  const entityId = requireSafeUrl(String(args["entity_id"]),                   "entity_id");
  const jwksUrl  = requireSafeUrl(String(args["jwks_url"]),                    "jwks_url");

  const data = await fetchJson(`${taUrl}/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, jwks_url: jwksUrl }),
  });

  const body = data as Record<string, unknown>;
  const enrollmentId = body["enrollment_id"] ?? body["id"] ?? "(unknown)";
  const nonce = body["nonce"] ?? "(unknown)";

  return [
    `Enrollment initiated for ${entityId}`,
    `enrollment_id: ${String(enrollmentId)}`,
    `nonce: ${String(nonce)}`,
    "",
    "Next step: Sign the nonce with your entity's private key and call complete_enrollment.",
    "",
    "Full response:",
    JSON.stringify(data, null, 2),
  ].join("\n");
}

async function toolCompleteEnrollment(args: Record<string, unknown>): Promise<string> {
  const taUrl = requireSafeUrl(String(args["ta_url"] ?? DEFAULT_TA_URL), "ta_url");
  const enrollmentId = String(args["enrollment_id"]);
  const proofJws = String(args["proof_jws"]);

  const data = await fetchJson(`${taUrl}/enroll/${encodeURIComponent(enrollmentId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof_jws: proofJws }),
  });

  return `Enrollment ${enrollmentId} completed.\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
}

/**
 * Build the POST body for the TMI `/trustmarks/issue` endpoint from MCP tool args.
 *
 * AI-NOTE: the field names here MUST match `IssueRequestSchema` in
 * @letsfederate/tmi-server/src/schemas.ts. A mismatch does not error loudly —
 * Zod's non-strict object silently strips unknown keys and applies defaults, so
 * a wrong name means the caller's value is dropped (review Finding #2). The
 * contract test in test/issue-trustmark-contract.test.mjs validates this body
 * against that exact schema to catch drift.
 */
export function buildIssueTrustmarkBody(
  args: Record<string, unknown>
): Record<string, unknown> {
  const subjectUrl = requireSafeUrl(String(args["subject_url"]), "subject_url");
  const ttlSeconds = Number(args["ttl_seconds"] ?? 3600);

  // SPEC: field names must match @letsfederate/tmi-server IssueRequestSchema —
  // `ttl_s` (not `ttl`) and `trustmark_id` (not `id`). The contract test pins this.
  const body: Record<string, unknown> = {
    sub: subjectUrl,
    ttl_s: ttlSeconds,
  };

  if (args["trustmark_id"]) body["trustmark_id"] = String(args["trustmark_id"]);
  if (args["image_digest"]) body["image_digest"] = String(args["image_digest"]);
  if (args["repo"]) body["repo"] = String(args["repo"]);
  return body;
}

async function toolIssueTrustmark(args: Record<string, unknown>): Promise<string> {
  const tmiUrl = requireSafeUrl(String(args["tmi_url"] ?? DEFAULT_TMI_URL), "tmi_url");
  const body = buildIssueTrustmarkBody(args);

  const data = await fetchJson(`${tmiUrl}/trustmarks/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return `Trustmark issued for ${String(body["sub"])}.\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
}

/**
 * Resolve the optional JWKS-override URL for trustmark verification.
 *
 * AI-NOTE: trustmarks are signed by the Trust Mark Issuer, so any JWKS override
 * MUST point at the TMI, never the Trust Anchor (review Finding #7 — overriding
 * with the TA JWKS makes every verification fail, since the TA lacks the TMI
 * signing key). Returns undefined by default: the trustmark's own `jku` header
 * (SSRF-checked inside validateTrustmark) already points to the TMI JWKS.
 */
export function resolveTrustmarkVerifyJwksUrl(
  args: Record<string, unknown>
): string | undefined {
  return args["tmi_url"]
    ? `${requireSafeUrl(String(args["tmi_url"]), "tmi_url")}/.well-known/jwks.json`
    : undefined;
}

async function toolVerifyTrustmark(args: Record<string, unknown>): Promise<string> {
  const jws = String(args["jws"]);
  const jwksUrl = resolveTrustmarkVerifyJwksUrl(args);

  const result = await validateTrustmark(jws, jwksUrl ? { jwksUrl } : {});
  const formatted = formatTrustMessage(result);
  const summary = summarizeTrustResult(result);
  const prefix = trustPrefix(result);

  return [
    `${prefix} Trustmark verification result`,
    "",
    summary,
    "",
    `Formatted: ${formatted}`,
    "",
    "Full result:",
    JSON.stringify(result, null, 2),
  ].join("\n");
}

async function toolCheckTrustChain(args: Record<string, unknown>): Promise<string> {
  const subjectUrl     = requireSafeUrl(String(args["subject_url"]),                           "subject_url");
  const trustAnchorUrl = requireSafeUrl(String(args["trust_anchor_url"] ?? DEFAULT_TA_URL),    "trust_anchor_url");

  const result = await validateTrustChain(subjectUrl, trustAnchorUrl);
  const formatted = formatTrustMessage(result);
  const summary = summarizeTrustResult(result);
  const prefix = trustPrefix(result);

  const lines = [
    `${prefix} Trust chain validation result`,
    "",
    summary,
    "",
    `Formatted: ${formatted}`,
    "",
    "Full result:",
    JSON.stringify(result, null, 2),
  ];

  if (result.state !== "VALID" && result.recommendedAction) {
    lines.push("", `Action required: ${result.recommendedAction}`);
  }

  return lines.join("\n");
}

/**
 * The MCP server capabilities. Advertises the `org.letsfederate/oidf-trust`
 * extension in-band at the `initialize` handshake so clients learn fedmgr-mcp's
 * OIDF identity + anchor + marks (patient zero). Exported so the advertisement is
 * directly testable. SPEC: https://modelcontextprotocol.io/extensions/overview
 */
export function buildServerCapabilities(): Record<string, unknown> {
  return {
    tools: {},
    resources: {},
    extensions: {
      [OIDF_TRUST_EXTENSION_ID]: buildOidfTrustExtension({
        entityId: FEDMGR_MCP_ENTITY_ID,
        trustAnchor: DEFAULT_TRUST_ANCHOR_ID,
        trustMarks: [MCP_TRUST_MARK_ID],
        ...(process.env["FEDMGR_MCP_IMAGE_DIGEST"]
          ? { imageDigest: process.env["FEDMGR_MCP_IMAGE_DIGEST"] }
          : {}),
      }),
    },
  };
}

/**
 * Defensively read a required non-empty string argument. MCP tool args are
 * untyped JSON, so we validate at the boundary rather than trusting the shape.
 */
function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`[TRUST:FAIL] missing required string argument "${key}"`);
  }
  return v;
}

/**
 * validate_mcp_invocation — the admission verdict, exposed over MCP.
 *
 * For the newcomer, the four inputs are signed JWTs (JWS, RFC 7515) that together
 * answer "should this MCP call be allowed?":
 *   - subordinate_statement : the Trust Anchor vouching for the MCP's keys/metadata
 *                             (OIDF "Subordinate Statement").
 *   - entity_statement      : the MCP's own self-signed configuration.
 *   - invocation_token      : the runtime authorization JWT whose `aud` lists the
 *                             permitted endpoints and whose `trust_marks` claim
 *                             must carry the required mark.
 *   - endpoint              : the MCP endpoint actually being invoked.
 * The trust anchor's public keys (JWKS) verify the signatures — supplied inline
 * via `trust_anchor_jwks`, or fetched from `${ta_url}/.well-known/jwks.json`
 * (SSRF-checked). Returns a fail-closed verdict: any problem ⇒ DENIED.
 * SPEC: OIDF §"Trust Marks" + §"Resolving a Trust Chain".
 */
export async function toolValidateMcpInvocation(args: Record<string, unknown>): Promise<string> {
  return withSpan("tool.validate_mcp_invocation", async (span) => {
    const subordinateStatement = requireString(args, "subordinate_statement");
    const entityStatement = requireString(args, "entity_statement");
    const invocationToken = requireString(args, "invocation_token");
    const endpoint = requireString(args, "endpoint");
    const requiredTrustMark = args["required_trust_mark"]
      ? String(args["required_trust_mark"])
      : undefined;
    span.setAttribute("mcp.endpoint", endpoint);

    // Resolve the Trust Anchor's public keys: inline JWKS, else the well-known
    // JWKS at the (SSRF-checked) TA URL.
    let trustAnchorJwks: { keys: JWK[] };
    const inlineJwks = args["trust_anchor_jwks"];
    if (inlineJwks && typeof inlineJwks === "object" && Array.isArray((inlineJwks as { keys?: unknown }).keys)) {
      trustAnchorJwks = inlineJwks as { keys: JWK[] };
      log.debug("using inline trust_anchor_jwks");
    } else {
      const taUrl = requireSafeUrl(String(args["ta_url"] ?? DEFAULT_TA_URL), "ta_url");
      log.debug("fetching trust anchor JWKS", { taUrl });
      trustAnchorJwks = (await fetchJson(`${taUrl}/.well-known/jwks.json`)) as { keys: JWK[] };
    }

    const verdict = await validateMcpInvocation({
      trustAnchorJwks,
      subordinateStatement,
      entityStatement,
      invocationToken,
      endpoint,
      ...(requiredTrustMark ? { requiredTrustMark } : {}),
    });

    span.setAttribute("mcp.trusted", verdict.trusted);
    // INVARIANT: a denial is a WARN, not an ERROR — denying a bad caller is the
    // system working correctly, not a fault.
    log[verdict.trusted ? "info" : "warn"]("mcp invocation verdict", {
      endpoint,
      entityId: verdict.entityId,
      trusted: verdict.trusted,
      checks: verdict.checks,
      ...(verdict.error ? { error: verdict.error } : {}),
    });

    const prefix = verdict.trusted ? "[TRUST:VALID]" : "[TRUST:FAIL]";
    const checkLines = Object.entries(verdict.checks)
      .map(([k, v]) => `  ${v ? "✓" : "✗"} ${k}`)
      .join("\n");
    return [
      `${prefix} MCP invocation ${verdict.trusted ? "ALLOWED" : "DENIED"} for endpoint ${endpoint}`,
      verdict.entityId ? `Entity: ${verdict.entityId}` : "",
      "Checks:",
      checkLines,
      verdict.error ? `Error: ${verdict.error}` : "",
      "",
      "Full verdict:",
      JSON.stringify(verdict, null, 2),
    ]
      .filter((line) => line !== "")
      .join("\n");
  }, { "mcp.tool": "validate_mcp_invocation" });
}

async function toolProvisionMcpTrustCircle(args: Record<string, unknown>): Promise<string> {
  const count = Number(args["mcp_count"] ?? 2);
  const issuerBase = String(args["issuer_base"] ?? "https://fedmgr.local");
  const endpointBase = String(args["endpoint_base"] ?? "https://mcp.local");
  const subject = String(args["subject"] ?? "claude-code");
  const trustAnchorEntityId = String(args["trust_anchor_entity_id"] ?? DEFAULT_TRUST_ANCHOR_ID);
  const ta = new OpenBaoTransitProvider({
    issuer: trustAnchorEntityId,
    keyName: "fedmgr-mcp-local-ta",
    client: new MemoryOpenBaoTransitClient(),
  });
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId,
    trustAnchorKms: ta,
    issuerBase,
    endpointBase,
    subject,
    mcpCount: count,
    entityKmsFactory: (mcpId) => new OpenBaoTransitProvider({
      issuer: `${issuerBase.replace(/\/+$/, "")}/mcp/${mcpId}`,
      keyName: mcpKeyName(mcpId),
      client: new MemoryOpenBaoTransitClient(),
    }),
  });
  return JSON.stringify({
    trust_anchor: circle.trustAnchor,
    entity_count: circle.registrations.length,
    audiences: circle.audiences,
    entities: circle.registrations.map((registration) => ({
      mcp_id: registration.mcpId,
      entity_id: registration.entityId,
      endpoint: registration.endpoint,
      metadata: registration.metadata,
    })),
    invocation_token: circle.invocationToken,
  }, null, 2);
}

async function toolRevokeSubordinate(args: Record<string, unknown>): Promise<string> {
  const taUrl    = requireSafeUrl(String(args["ta_url"]    ?? DEFAULT_TA_URL), "ta_url");
  const entityId = requireSafeUrl(String(args["entity_id"]),                   "entity_id");
  const reason = String(args["reason"]);

  const encodedId = encodeURIComponent(entityId);
  const data = await fetchJson(`${taUrl}/subordinates/${encodedId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });

  return `Subordinate ${entityId} revoked.\nReason: ${reason}\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
}

async function toolGetSignedConfig(args: Record<string, unknown>): Promise<string> {
  const entityUrl = requireSafeUrl(String(args["entity_url"]), "entity_url").replace(/\/$/, "");
  const configUrl = `${entityUrl}/.well-known/openid-federation`;

  const res = await fetch(configUrl);
  if (!res.ok) {
    throw new Error(`GET ${configUrl} returned HTTP ${res.status} ${res.statusText}`);
  }
  const jwtText = await res.text();
  const { header, payload } = unsafeDecodeJwtParts(jwtText.trim());

  return [
    `Signed entity configuration for ${entityUrl}`,
    "",
    "Header:",
    JSON.stringify(header, null, 2),
    "",
    "Payload:",
    JSON.stringify(payload, null, 2),
    "",
    `Raw JWT (${jwtText.length} chars): ${jwtText.slice(0, 120)}...`,
  ].join("\n");
}

async function toolInitializeLocalCa(): Promise<string> {
  // Detect key file existence for status reporting
  const repoRoot = new URL("../../../../", import.meta.url).pathname;

  const keyPaths = [
    { label: "TA private key", rel: "packages/ta-server/keys/private.jwk.enc" },
    { label: "TA public key", rel: "packages/ta-server/keys/public.jwk" },
    { label: "TMI private key", rel: "packages/tmi-server/keys/private.jwk.enc" },
    { label: "TMI public key", rel: "packages/tmi-server/keys/public.jwk" },
  ];

  const statusLines: string[] = [];
  for (const { label, rel } of keyPaths) {
    const full = path.resolve(repoRoot, rel);
    let exists = false;
    try {
      await fs.access(full);
      exists = true;
    } catch {
      exists = false;
    }
    statusLines.push(`  ${exists ? "[PRESENT]" : "[MISSING]"} ${label} (${rel})`);
  }

  return [
    "Local CA initialization guide",
    "=".repeat(50),
    "",
    "Key file status:",
    ...statusLines,
    "",
    "Step-by-step setup:",
    "",
    "1. Generate Trust Anchor keys:",
    "   npm run ta:keys:init",
    "   (Runs: bash scripts/tmi-keys-init.sh packages/ta-server/keys)",
    "",
    "2. Generate Trust Mark Issuer keys:",
    "   npm run tmi:keys:init",
    "   (Runs: bash scripts/tmi-keys-init.sh)",
    "",
    "3. Start the full lab environment (Docker required):",
    "   npm run lab:up",
    "   (Runs: docker compose -f examples/lab/docker-compose.yml up --build)",
    "",
    "4. Verify services are healthy:",
    "   curl http://localhost:8090/health   # Trust Anchor",
    "   curl http://localhost:8080/health   # Trust Mark Issuer",
    "",
    "5. Check entity configurations:",
    "   curl http://localhost:8090/.well-known/openid-federation",
    "   curl http://localhost:8080/.well-known/openid-federation",
    "",
    "To stop the lab:",
    "   npm run lab:down",
    "",
    "Note: Key files are encrypted at rest (PBES2 JWE). The tmi-decrypt.sh script",
    "mounts decrypted keys on tmpfs at runtime. Never commit unencrypted private keys.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "fedmgr-mcp", version: "0.0.1" },
    { capabilities: buildServerCapabilities() as Record<string, unknown> }
  );

  // ── List tools ────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "federation_status",
        description:
          "Check health of Trust Anchor (TA) and Trust Mark Issuer (TMI) servers.",
        inputSchema: {
          type: "object" as const,
          properties: {
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
            tmi_url: {
              type: "string",
              description: `URL of the Trust Mark Issuer server (default: ${DEFAULT_TMI_URL})`,
            },
          },
        },
      },
      {
        name: "list_subordinates",
        description: "List all registered entities in the federation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
            entity_type: {
              type: "string",
              enum: ["intermediate", "leaf", "all"],
              description: 'Filter by entity type: "intermediate", "leaf", or "all" (default)',
            },
          },
        },
      },
      {
        name: "search_federation",
        description:
          "Semantic (natural-language) search over registered federation entities. " +
          "Ranks entities by how well their id and metadata match the query using a " +
          "local RuVector vector index — e.g. \"who can issue trust marks?\" or " +
          "\"MCP server for weather\".",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "Natural-language description of the entity you're looking for.",
            },
            k: {
              type: "number",
              description: "Maximum number of results to return (default 5, max 50).",
            },
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "enroll_server",
        description:
          "Enroll a new MCP server or entity into the federation. Returns enrollment_id and nonce for the operator to sign.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entity_id: {
              type: "string",
              description: "Entity ID URL of the server being enrolled",
            },
            jwks_url: {
              type: "string",
              description: "URL of the entity's JWKS endpoint",
            },
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
          },
          required: ["entity_id", "jwks_url"],
        },
      },
      {
        name: "complete_enrollment",
        description:
          "Complete an enrollment challenge by providing the signed proof JWS.",
        inputSchema: {
          type: "object" as const,
          properties: {
            enrollment_id: {
              type: "string",
              description: "Enrollment ID returned by enroll_server",
            },
            proof_jws: {
              type: "string",
              description: "Compact JWS signed with the entity's private key over the nonce",
            },
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
          },
          required: ["enrollment_id", "proof_jws"],
        },
      },
      {
        name: "issue_trustmark",
        description:
          "Issue a signed trustmark for a subject entity via the TMI.",
        inputSchema: {
          type: "object" as const,
          properties: {
            subject_url: {
              type: "string",
              description: "URL identifying the subject entity to receive the trustmark",
            },
            tmi_url: {
              type: "string",
              description: `URL of the Trust Mark Issuer server (default: ${DEFAULT_TMI_URL})`,
            },
            trustmark_id: {
              type: "string",
              description: "Optional trustmark type URI (id claim)",
            },
            ttl_seconds: {
              type: "number",
              description: "Time-to-live in seconds (default: 3600)",
            },
            image_digest: {
              type: "string",
              description: "Optional OCI image digest to bind to this trustmark",
            },
            repo: {
              type: "string",
              description: "Optional source repository URL",
            },
          },
          required: ["subject_url"],
        },
      },
      {
        name: "verify_trustmark",
        description:
          "Verify a trustmark JWS token — checks signature, expiry, and issuer.",
        inputSchema: {
          type: "object" as const,
          properties: {
            jws: {
              type: "string",
              description: "Compact JWS trustmark token to verify",
            },
            tmi_url: {
              type: "string",
              description:
                "Optional Trust Mark Issuer URL whose JWKS overrides the trustmark's jku header. " +
                "Normally unnecessary — the trustmark's jku already points to the issuing TMI.",
            },
          },
          required: ["jws"],
        },
      },
      {
        name: "check_trust_chain",
        description:
          "Validate the full OIDF trust chain from a subject entity up to the trust anchor.",
        inputSchema: {
          type: "object" as const,
          properties: {
            subject_url: {
              type: "string",
              description: "URL of the entity whose trust chain should be validated",
            },
            trust_anchor_url: {
              type: "string",
              description: `Expected trust anchor URL (default: ${DEFAULT_TA_URL})`,
            },
          },
          required: ["subject_url"],
        },
      },
      {
        name: "validate_mcp_invocation",
        description:
          "Decide whether an MCP invocation is admissible: verifies the subordinate " +
          "statement, the MCP's entity self-statement, and the invocation token " +
          "(signature, audience, and required trust mark present in the JWT). " +
          "Fail-closed — any problem returns DENIED.",
        inputSchema: {
          type: "object" as const,
          properties: {
            subordinate_statement: {
              type: "string",
              description: "Compact JWS: the Trust Anchor's subordinate statement about the MCP",
            },
            entity_statement: {
              type: "string",
              description: "Compact JWS: the MCP's self-signed entity configuration",
            },
            invocation_token: {
              type: "string",
              description: "Compact JWS: the runtime authorization token (aud + trust_marks)",
            },
            endpoint: {
              type: "string",
              description: "The MCP endpoint being invoked (must appear in the token's aud)",
            },
            ta_url: {
              type: "string",
              description: `Trust Anchor URL whose JWKS verifies the statements (default: ${DEFAULT_TA_URL}). Ignored if trust_anchor_jwks is supplied.`,
            },
            trust_anchor_jwks: {
              type: "object",
              description: "Inline Trust Anchor JWKS ({ keys: [...] }); overrides ta_url fetch",
            },
            required_trust_mark: {
              type: "string",
              description: "Trust mark URI that MUST be present in the invocation token (defaults to the MCP trust mark)",
            },
          },
          required: ["subordinate_statement", "entity_statement", "invocation_token", "endpoint"],
        },
      },
      {
        name: "provision_mcp_trust_circle",
        description:
          "Provision an MCP trust circle with OIDF entity/subordinate statements and endpoint-scoped invocation token audiences.",
        inputSchema: {
          type: "object" as const,
          properties: {
            mcp_count: { type: "number", description: "Number of MCP entities to provision" },
            issuer_base: { type: "string", description: "Base URL for generated MCP entity IDs" },
            endpoint_base: { type: "string", description: "Base URL for generated MCP endpoint audiences" },
            subject: { type: "string", description: "Subject for the invocation token" },
            trust_anchor_entity_id: { type: "string", description: "Trust Anchor entity ID" },
          },
        },
      },
      {
        name: "revoke_subordinate",
        description:
          "Revoke and decommission a subordinate entity from the federation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entity_id: {
              type: "string",
              description: "Entity ID URL of the subordinate to revoke",
            },
            reason: {
              type: "string",
              description: "Human-readable reason for revocation (e.g. 'decommissioned', 'key compromise')",
            },
            ta_url: {
              type: "string",
              description: `URL of the Trust Anchor server (default: ${DEFAULT_TA_URL})`,
            },
          },
          required: ["entity_id", "reason"],
        },
      },
      {
        name: "get_signed_config",
        description:
          "Fetch and decode the signed entity configuration (OIDF entity statement) for any entity.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entity_url: {
              type: "string",
              description: "Base URL of the entity (/.well-known/openid-federation will be appended)",
            },
          },
          required: ["entity_url"],
        },
      },
      {
        name: "initialize_local_ca",
        description:
          "Get step-by-step instructions for initializing a local CA (TA + TMI) and check key file status.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  }));

  // ── List resources ────────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "federation://status",
        name: "Federation Status",
        description:
          "Current federation health state — polls both TA and TMI /health endpoints",
        mimeType: "application/json",
      },
    ],
  }));

  // ── Read resource ─────────────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== "federation://status") {
      throw new Error(`Unknown resource: ${req.params.uri}`);
    }

    const status: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      ta: { url: DEFAULT_TA_URL, status: "unknown" },
      tmi: { url: DEFAULT_TMI_URL, status: "unknown" },
    };

    for (const [key, url] of [
      ["ta", DEFAULT_TA_URL],
      ["tmi", DEFAULT_TMI_URL],
    ] as [string, string][]) {
      try {
        const data = await fetchJson(`${url}/health`);
        (status[key] as Record<string, unknown>)["status"] = "up";
        (status[key] as Record<string, unknown>)["data"] = data;
      } catch (err) {
        (status[key] as Record<string, unknown>)["status"] = "down";
        (status[key] as Record<string, unknown>)["error"] = String(err);
      }
    }

    return {
      contents: [
        {
          uri: "federation://status",
          mimeType: "application/json",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  });

  // ── Call tool ─────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const a = args as Record<string, unknown>;

    // One span per tool call; logs within inherit its trace/span ids.
    return withSpan(`mcp.tool.${name}`, async () => {
    log.debug("tool call", { tool: name });
    try {
      let text: string;

      switch (name) {
        case "federation_status":
          text = await toolFederationStatus(a);
          break;
        case "list_subordinates":
          text = await toolListSubordinates(a);
          break;
        case "search_federation":
          text = await toolSearchFederation(a);
          break;
        case "enroll_server":
          text = await toolEnrollServer(a);
          break;
        case "complete_enrollment":
          text = await toolCompleteEnrollment(a);
          break;
        case "issue_trustmark":
          text = await toolIssueTrustmark(a);
          break;
        case "verify_trustmark":
          text = await toolVerifyTrustmark(a);
          break;
        case "check_trust_chain":
          text = await toolCheckTrustChain(a);
          break;
        case "validate_mcp_invocation":
          text = await toolValidateMcpInvocation(a);
          break;
        case "provision_mcp_trust_circle":
          text = await toolProvisionMcpTrustCircle(a);
          break;
        case "revoke_subordinate":
          text = await toolRevokeSubordinate(a);
          break;
        case "get_signed_config":
          text = await toolGetSignedConfig(a);
          break;
        case "initialize_local_ca":
          text = await toolInitializeLocalCa();
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);
      // ERROR here = the tool threw unexpectedly. Note a DENIED trust verdict is
      // NOT an error — validate_mcp_invocation returns it as normal content.
      log.error("tool call failed", { tool: name, error: message });
      return {
        content: [
          {
            type: "text" as const,
            text: `[TRUST:FAIL] Tool "${name}" failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
    });
  });

  // ── Start transport ───────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    "[fedmgr-mcp] MCP server ready — stdio transport\n" +
    `[fedmgr-mcp] Tools: ${TOOL_NAMES.join(", ")}\n`
  );
}
