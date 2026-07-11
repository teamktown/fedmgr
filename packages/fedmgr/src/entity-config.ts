/**
 * Leaf entity-configuration minting — the issuing/hosting step (ADR 0002 G1).
 *
 * For an MCP server to become a resolvable OpenID Federation leaf, it must hold
 * its own keypair and SELF-HOST a signed Entity Configuration at
 * `<entity-id>/.well-known/openid-federation`. The Trust Anchor separately
 * issues a Subordinate Statement about it (via enrollment); a §10 verifier binds
 * the two. This module mints the leaf's own half — the self-signed configuration
 * — which the operator then hosts. It is pure and dependency-light (jose only)
 * so it is testable end-to-end against @letsfederate/oidf-verify.
 */
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  SignJWT,
  calculateJwkThumbprint,
  type JWK,
} from "jose";

export interface LeafKeypair {
  publicJwk: JWK;
  privateJwk: JWK;
}

/** Mint a fresh ES256 leaf keypair with a stable thumbprint kid. */
export async function mintLeafKeypair(): Promise<LeafKeypair> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = "ES256";
  publicJwk.kid = await calculateJwkThumbprint(publicJwk);
  const privateJwk = await exportJWK(privateKey);
  privateJwk.alg = "ES256";
  privateJwk.kid = publicJwk.kid;
  return { publicJwk, privateJwk };
}

export interface LeafEntityConfigOptions {
  /** The leaf's entity identifier (its base URL). iss == sub == this. */
  entityId: string;
  /** Superior entity IDs (the TA or intermediate the leaf enrolls under). */
  authorityHints: string[];
  /** The leaf's private JWK (ES256) used to self-sign. */
  privateJwk: JWK;
  /** The leaf's public JWK, published in the configuration's jwks. */
  publicJwk: JWK;
  /** The MCP server's public endpoint (adds mcp_server metadata). */
  endpoint?: string;
  /** Human-readable name. */
  organizationName?: string;
  /** Trust mark types this server requires callers to honor (advisory). */
  requiredTrustMarks?: string[];
  /** Lifetime in seconds (default 86400 = 24h). */
  ttlSeconds?: number;
  /** Fixed issue time (epoch seconds) — for reproducible tests. */
  iat?: number;
}

/**
 * Build and sign the leaf's self-signed Entity Configuration JWT.
 * Host the returned string at `<entityId>/.well-known/openid-federation` with
 * Content-Type application/entity-statement+jwt.
 */
export async function buildLeafEntityConfig(opts: LeafEntityConfigOptions): Promise<string> {
  if (!opts.entityId.startsWith("http")) {
    throw new Error(`[TRUST:FAIL] entity-id must be an http(s) URL, got "${opts.entityId}"`);
  }
  if (!Array.isArray(opts.authorityHints) || opts.authorityHints.length === 0) {
    throw new Error("[TRUST:FAIL] a leaf entity configuration needs at least one authority_hint (its TA)");
  }
  const now = opts.iat ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 86400;

  const metadata: Record<string, unknown> = {
    federation_entity: {
      ...(opts.organizationName ? { organization_name: opts.organizationName } : {}),
    },
  };
  if (opts.endpoint) {
    (metadata as Record<string, unknown>)["mcp_server"] = {
      endpoint: opts.endpoint,
      transports: ["http"],
      capabilities: ["tools", "resources"],
      ...(opts.requiredTrustMarks && opts.requiredTrustMarks.length > 0
        ? { trust_policy: { required_trust_marks: opts.requiredTrustMarks } }
        : {}),
    };
  }

  const payload: Record<string, unknown> = {
    iss: opts.entityId,
    sub: opts.entityId,
    iat: now,
    exp: now + ttl,
    jwks: { keys: [opts.publicJwk] },
    authority_hints: opts.authorityHints,
    metadata,
  };

  const key = await importJWK(opts.privateJwk, "ES256");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: opts.publicJwk.kid as string, typ: "entity-statement+jwt" })
    .sign(key);
}

/**
 * Sign the TA's enrollment challenge: a compact JWS over
 * `{ nonce, entity_id }` with the leaf's private key (proof of key
 * ownership). The TA verifies it against the JWKS it fetched from the
 * leaf's jwks_url and, on success, activates the subordinate.
 */
export async function buildEnrollmentProof(
  nonce: string,
  entityId: string,
  privateJwk: JWK
): Promise<string> {
  if (!nonce) throw new Error("[TRUST:FAIL] enrollment nonce is required");
  const key = await importJWK(privateJwk, "ES256");
  return new SignJWT({ nonce, entity_id: entityId })
    .setProtectedHeader({ alg: "ES256", kid: privateJwk.kid as string })
    .sign(key);
}
