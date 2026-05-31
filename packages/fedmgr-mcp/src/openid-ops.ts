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

export async function validateMcpInvocation(opts: {
  trustAnchorJwks: { keys: JWK[] };
  subordinateStatement: string;
  entityStatement: string;
  invocationToken: string;
  endpoint: string;
  requiredTrustMark?: string;
}): Promise<{ trusted: boolean; entityId: string; endpoint: string; checks: Record<string, boolean> }> {
  const taKey = await importJWK(opts.trustAnchorJwks.keys[0], "RS256");
  const subordinate = await jwtVerify(opts.subordinateStatement, taKey, {
    audience: opts.endpoint,
  }).catch(async () => jwtVerify(opts.subordinateStatement, taKey));

  const subjectJwk = ((subordinate.payload.jwks as { keys: JWK[] }).keys)[0];
  const subjectKey = await importJWK(subjectJwk, subjectJwk.alg === "RS256" ? "RS256" : "ES256");
  const entity = await jwtVerify(opts.entityStatement, subjectKey, {
    issuer: subordinate.payload.sub as string,
    subject: subordinate.payload.sub as string,
  });
  const access = await jwtVerify(opts.invocationToken, taKey, {
    issuer: subordinate.payload.iss as string,
    audience: opts.endpoint,
  });
  const metadata = subordinate.payload.metadata as { federation_entity?: { trust_marks?: string[] } } | undefined;
  const trustMarks = metadata?.federation_entity?.trust_marks ?? [];
  const required = opts.requiredTrustMark ?? MCP_TRUST_MARK_ID;
  return {
    trusted: trustMarks.includes(required),
    entityId: entity.payload.sub as string,
    endpoint: opts.endpoint,
    checks: {
      subordinateSignatureValid: true,
      entitySelfStatementValid: true,
      invocationAudienceValid: Array.isArray(access.payload.aud)
        ? access.payload.aud.includes(opts.endpoint)
        : access.payload.aud === opts.endpoint,
      requiredTrustMarkPresent: trustMarks.includes(required),
    },
  };
}

export function mcpKeyName(mcpId: string): string {
  return `fedmgr-mcp-${stableKid(mcpId)}`;
}
