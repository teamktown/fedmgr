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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TA_URL = "http://localhost:8090";
const DEFAULT_TMI_URL = "http://localhost:8080";

const TOOL_NAMES = [
  "federation_status",
  "list_subordinates",
  "enroll_server",
  "complete_enrollment",
  "issue_trustmark",
  "verify_trustmark",
  "check_trust_chain",
  "revoke_subordinate",
  "get_signed_config",
  "initialize_local_ca",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Perform a JSON fetch, returning the parsed body.
 * Throws with a descriptive message on HTTP errors or parse failures.
 */
async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
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
 * Decode a compact JWT without verification, returning header + payload.
 */
function decodeJwtParts(jwt: string): {
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

async function toolFederationStatus(args: Record<string, unknown>): Promise<string> {
  const taUrl = String(args["ta_url"] ?? DEFAULT_TA_URL).replace(/\/$/, "");
  const tmiUrl = String(args["tmi_url"] ?? DEFAULT_TMI_URL).replace(/\/$/, "");

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
  const taUrl = String(args["ta_url"] ?? DEFAULT_TA_URL).replace(/\/$/, "");
  const entityType = String(args["entity_type"] ?? "all");

  let url = `${taUrl}/federation_list`;
  if (entityType !== "all") {
    url += `?entity_type=${encodeURIComponent(entityType)}`;
  }

  const data = await fetchJson(url);
  return `Registered entities (type=${entityType}):\n${JSON.stringify(data, null, 2)}`;
}

async function toolEnrollServer(args: Record<string, unknown>): Promise<string> {
  const taUrl = String(args["ta_url"] ?? DEFAULT_TA_URL).replace(/\/$/, "");
  const entityId = String(args["entity_id"]);
  const jwksUrl = String(args["jwks_url"]);

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
  const taUrl = String(args["ta_url"] ?? DEFAULT_TA_URL).replace(/\/$/, "");
  const enrollmentId = String(args["enrollment_id"]);
  const proofJws = String(args["proof_jws"]);

  const data = await fetchJson(`${taUrl}/enroll/${encodeURIComponent(enrollmentId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proof_jws: proofJws }),
  });

  return `Enrollment ${enrollmentId} completed.\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
}

async function toolIssueTrustmark(args: Record<string, unknown>): Promise<string> {
  const tmiUrl = String(args["tmi_url"] ?? DEFAULT_TMI_URL).replace(/\/$/, "");
  const subjectUrl = String(args["subject_url"]);
  const ttlSeconds = Number(args["ttl_seconds"] ?? 3600);

  const body: Record<string, unknown> = {
    sub: subjectUrl,
    ttl: ttlSeconds,
  };

  if (args["trustmark_id"]) body["id"] = String(args["trustmark_id"]);
  if (args["image_digest"]) body["image_digest"] = String(args["image_digest"]);
  if (args["repo"]) body["repo"] = String(args["repo"]);

  const data = await fetchJson(`${tmiUrl}/trustmarks/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return `Trustmark issued for ${subjectUrl}.\n\nResponse:\n${JSON.stringify(data, null, 2)}`;
}

async function toolVerifyTrustmark(args: Record<string, unknown>): Promise<string> {
  const jws = String(args["jws"]);
  const jwksUrl = args["ta_url"]
    ? `${String(args["ta_url"]).replace(/\/$/, "")}/.well-known/jwks.json`
    : undefined;

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
  const subjectUrl = String(args["subject_url"]);
  const trustAnchorUrl = String(args["trust_anchor_url"] ?? DEFAULT_TA_URL);

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

async function toolRevokeSubordinate(args: Record<string, unknown>): Promise<string> {
  const taUrl = String(args["ta_url"] ?? DEFAULT_TA_URL).replace(/\/$/, "");
  const entityId = String(args["entity_id"]);
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
  const entityUrl = String(args["entity_url"]).replace(/\/$/, "");
  const configUrl = `${entityUrl}/.well-known/openid-federation`;

  const res = await fetch(configUrl);
  if (!res.ok) {
    throw new Error(`GET ${configUrl} returned HTTP ${res.status} ${res.statusText}`);
  }
  const jwtText = await res.text();
  const { header, payload } = decodeJwtParts(jwtText.trim());

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
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
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
            ta_url: {
              type: "string",
              description:
                "Optional Trust Anchor URL; its JWKS will be used to override the jku header",
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

    try {
      let text: string;

      switch (name) {
        case "federation_status":
          text = await toolFederationStatus(a);
          break;
        case "list_subordinates":
          text = await toolListSubordinates(a);
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

  // ── Start transport ───────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    "[fedmgr-mcp] MCP server ready — stdio transport\n" +
    `[fedmgr-mcp] Tools: ${TOOL_NAMES.join(", ")}\n`
  );
}
