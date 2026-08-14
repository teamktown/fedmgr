/**
 * MCP-native OpenID Federation operations.
 *
 * Ontology for humans and LLM agents:
 * - Trust Anchor (TA): entity that signs subordinate statements.
 * - MCP entity: an MCP server represented as an OpenID Federation subordinate.
 * - Entity statement: self-signed JWT at /.well-known/openid-federation.
 * - Subordinate statement: TA-signed JWT returned by federation_fetch.
 * - Invocation token: runtime authorization JWT whose `aud` enumerates MCP
 *   endpoints a harness may connect to after federation trust succeeds.
 *
 * Spec mapping:
 * - Uses @letsfederate/ta-server federation helpers for OpenID Federation
 *   entity/subordinate statement semantics.
 * - Keeps MCP endpoint authorization outside entity statements so OIDF trust
 *   metadata and runtime invocation authorization remain separate layers.
 */
import { createHash } from "node:crypto";
import { importJWK, jwtVerify, type JWK } from "jose";
import { type KeyProvider } from "@letsfederate/kms";
import { signEntityStatement } from "@letsfederate/ta-server/federation/entity-statements";
import { signSubordinateStatement } from "@letsfederate/ta-server/federation/subordinate-statements";

export const MCP_TRUST_MARK_ID = "https://letsfederate.dev/trust-mark/mcp-server/v1";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function stableKid(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

export type McpEntityRegistration = {
  mcpId: string;
  entityId: string;
  endpoint: string;
  jwks: { keys: JWK[] };
  metadata: Record<string, unknown>;
  entityStatement: string;
  subordinateStatement: string;
};

export type TrustCircle = {
  trustAnchor: string;
  registrations: McpEntityRegistration[];
  invocationToken: string;
  audiences: string[];
};

export function mcpServerMetadata(opts: {
  displayName: string;
  endpoint: string;
  trustMarks?: string[];
}): Record<string, unknown> {
  return {
    federation_entity: {
      organization_name: opts.displayName,
      trust_marks: opts.trustMarks ?? [MCP_TRUST_MARK_ID],
    },
    mcp_server: {
      endpoint: opts.endpoint,
      transports: ["http"],
      capabilities: ["tools", "resources"],
      trust_policy: {
        required_trust_marks: opts.trustMarks ?? [MCP_TRUST_MARK_ID],
      },
    },
  };
}

export async function registerMcpEntity(opts: {
  trustAnchorEntityId: string;
  trustAnchorKms: KeyProvider;
  entityKms: KeyProvider;
  entityId: string;
  mcpId: string;
  endpoint: string;
  displayName?: string;
  ttlSeconds?: number;
}): Promise<McpEntityRegistration> {
  const jwks = await opts.entityKms.jwks();
  const metadata = mcpServerMetadata({
    displayName: opts.displayName ?? opts.mcpId,
    endpoint: opts.endpoint,
  });
  const entityStatement = await signEntityStatement(
    {
      entityId: opts.entityId,
      authorityHints: [opts.trustAnchorEntityId],
      ttlSeconds: opts.ttlSeconds,
      metadata,
    },
    opts.entityKms
  );
  const subordinateStatement = await signSubordinateStatement(
    {
      issuerEntityId: opts.trustAnchorEntityId,
      subjectEntityId: opts.entityId,
      subjectJwks: jwks,
      subjectMetadata: metadata,
      ttlSeconds: opts.ttlSeconds,
    },
    opts.trustAnchorKms
  );
  return {
    mcpId: opts.mcpId,
    entityId: opts.entityId,
    endpoint: opts.endpoint,
    jwks,
    metadata,
    entityStatement,
    subordinateStatement,
  };
}

export async function issueMcpInvocationToken(opts: {
  issuer: string;
  subject: string;
  audiences: string[];
  kms: KeyProvider;
  ttlSeconds?: number;
  trustMarks?: string[];
}): Promise<string> {
  if (opts.audiences.length === 0) {
    throw new Error("audiences must enumerate at least one MCP endpoint");
  }
  const now = nowSeconds();
  return opts.kms.signJwt({
    iss: opts.issuer,
    sub: opts.subject,
    aud: opts.audiences,
    iat: now,
    exp: now + (opts.ttlSeconds ?? 3600),
    scope: "mcp.invoke",
    trust_marks: opts.trustMarks ?? [MCP_TRUST_MARK_ID],
  });
}

export async function provisionMcpTrustCircle(opts: {
  trustAnchorEntityId: string;
  trustAnchorKms: KeyProvider;
  entityKmsFactory: (mcpId: string) => KeyProvider;
  issuerBase: string;
  endpointBase: string;
  subject: string;
  mcpCount: number;
}): Promise<TrustCircle> {
  const registrations: McpEntityRegistration[] = [];
  const issuerBase = opts.issuerBase.replace(/\/+$/, "");
  const endpointBase = opts.endpointBase.replace(/\/+$/, "");
  for (let i = 1; i <= opts.mcpCount; i += 1) {
    const mcpId = `mcp-${i}`;
    registrations.push(await registerMcpEntity({
      trustAnchorEntityId: opts.trustAnchorEntityId,
      trustAnchorKms: opts.trustAnchorKms,
      entityKms: opts.entityKmsFactory(mcpId),
      entityId: `${issuerBase}/mcp/${mcpId}`,
      mcpId,
      endpoint: `${endpointBase}/${mcpId}`,
      displayName: `MCP Server ${i}`,
    }));
  }
  const audiences = registrations.map((registration) => registration.endpoint);
  const invocationToken = await issueMcpInvocationToken({
    issuer: opts.trustAnchorEntityId,
    subject: opts.subject,
    audiences,
    kms: opts.trustAnchorKms,
  });
  return { trustAnchor: opts.trustAnchorEntityId, registrations, invocationToken, audiences };
}

/**
 * Derive the JWS verification algorithm from a public JWK.
 *
 * AI-NOTE: the alg MUST match the key type. The real Trust Anchor / Trust Mark
 * Issuer sign ES256 (EC P-256, via SoftKmsProvider); the in-memory OpenBao
 * transit path signs RS256. Hardcoding either one silently breaks verification
 * of the other — this was review Finding #5. Prefer the JWK's own `alg`, then
 * fall back to a kty/crv-based inference.
 */
function jwsAlgForJwk(jwk: JWK): string {
  if (jwk.alg) return jwk.alg;
  switch (jwk.kty) {
    case "EC":
      return jwk.crv === "P-384" ? "ES384" : jwk.crv === "P-521" ? "ES512" : "ES256";
    case "RSA":
      return "RS256";
    case "OKP":
      return "EdDSA";
    default:
      throw new Error(`cannot infer JWS algorithm for kty=${String(jwk.kty)}`);
  }
}

/** Import a public JWK for signature verification with the correct algorithm. */
async function importVerifyKey(jwk: JWK) {
  return importJWK(jwk, jwsAlgForJwk(jwk));
}

/**
 * Validate that an MCP invocation is admissible against the trust fabric.
 *
 * INVARIANT: returns a verdict for every well-formed input; only programmer
 * error throws. Malformed / invalid / tampered input ⇒
 * `{ trusted:false, checks, error }` — the validator must never propagate a
 * thrown exception to its caller (review Finding #8).
 *
 * `trusted` is the conjunction of five INDEPENDENT checks, each surfaced in
 * `checks` for diagnostics:
 *   1. subordinateSignatureValid  — the TA actually signed the subordinate stmt
 *   2. entitySelfStatementValid   — the subject signed its own entity config
 *   3. invocationSignatureValid   — the TA/issuer signed the invocation token
 *   4. invocationAudienceValid    — the target endpoint is in the token's `aud`
 *   5. requiredTrustMarkPresent   — the required mark is in the token (see #1)
 */
export async function validateMcpInvocation(opts: {
  trustAnchorJwks: { keys: JWK[] };
  subordinateStatement: string;
  entityStatement: string;
  invocationToken: string;
  endpoint: string;
  requiredTrustMark?: string;
}): Promise<{
  trusted: boolean;
  entityId: string | null;
  endpoint: string;
  checks: Record<string, boolean>;
  error?: string;
}> {
  const required = opts.requiredTrustMark ?? MCP_TRUST_MARK_ID;
  const checks: Record<string, boolean> = {
    subordinateSignatureValid: false,
    entitySelfStatementValid: false,
    invocationSignatureValid: false,
    invocationAudienceValid: false,
    requiredTrustMarkPresent: false,
  };
  let entityId: string | null = null;

  try {
    // 1. Trust Anchor key. SECURITY (#8): guard the array access rather than
    //    dereferencing keys[0] on a possibly-empty/absent array.
    const taJwk = opts.trustAnchorJwks?.keys?.[0];
    if (!taJwk) throw new Error("trust anchor JWKS has no keys");
    const taKey = await importVerifyKey(taJwk); // (#5) alg derived from the JWK

    // 2. Subordinate statement: the TA vouches for the subject's keys + metadata.
    //    SPEC: OIDF Subordinate Statements — these carry no `aud`. Audience
    //    binding is enforced on the invocation token below, NOT here. The prior
    //    `audience`-then-`.catch(retry)` pattern was a no-op that masked intent
    //    (review Finding #4).
    const subordinate = await jwtVerify(opts.subordinateStatement, taKey);
    checks.subordinateSignatureValid = true;

    // 3. Subject key from the subordinate (#8 guard before dereference).
    const subjectJwk = (subordinate.payload["jwks"] as { keys?: JWK[] } | undefined)
      ?.keys?.[0];
    if (!subjectJwk) throw new Error("subordinate statement has no subject jwks");
    const subjectKey = await importVerifyKey(subjectJwk);

    // 4. Entity self-statement: the subject signs its own configuration
    //    (iss === sub === the subject entity id).
    const subjectEntityId = subordinate.payload.sub as string;
    const entity = await jwtVerify(opts.entityStatement, subjectKey, {
      issuer: subjectEntityId,
      subject: subjectEntityId,
    });
    checks.entitySelfStatementValid = true;
    entityId = (entity.payload.sub as string | undefined) ?? null;

    // 5. Invocation token: issued by the TA/issuer. Verify signature + issuer
    //    here; evaluate audience as a CHECK (not a hard `audience:` assertion)
    //    so a mismatch yields a verdict instead of a thrown error (#4, #8).
    const access = await jwtVerify(opts.invocationToken, taKey, {
      issuer: subordinate.payload.iss as string,
    });
    checks.invocationSignatureValid = true;
    const aud = access.payload.aud;
    checks.invocationAudienceValid = Array.isArray(aud)
      ? aud.includes(opts.endpoint)
      : aud === opts.endpoint;

    // 6. SECURITY (#1): the required trust mark must be present in the ISSUED
    //    invocation JWT — the token the relying party is actually presented —
    //    not merely asserted in the TA's subordinate metadata. Gating on
    //    subordinate metadata let a token with no marks pass.
    //    SPEC: OIDF Trust Marks.
    const marks = access.payload["trust_marks"];
    const invocationMarks = Array.isArray(marks) ? marks.map((m) => String(m)) : [];
    checks.requiredTrustMarkPresent = invocationMarks.includes(required);

    const trusted =
      checks.subordinateSignatureValid &&
      checks.entitySelfStatementValid &&
      checks.invocationSignatureValid &&
      checks.invocationAudienceValid &&
      checks.requiredTrustMarkPresent;

    return { trusted, entityId, endpoint: opts.endpoint, checks };
  } catch (err) {
    // INVARIANT: fail closed — any verification error is a denial, surfaced via
    // `error` for diagnostics, never propagated as a throw.
    return {
      trusted: false,
      entityId,
      endpoint: opts.endpoint,
      checks,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function mcpKeyName(mcpId: string): string {
  return `fedmgr-mcp-${stableKid(mcpId)}`;
}
