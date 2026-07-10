/**
 * OIDF Entity Statement generation
 *
 * Produces self-signed entity statements (JWTs with content-type
 * application/entity-statement+jwt) for the Trust Anchor and the TMI.
 *
 * Per OpenID Federation 1.0 draft-43:
 *   - Each entity's /.well-known/openid-federation returns a signed JWT
 *   - iss = sub = entity_id for a self-signed configuration
 *   - jwks contains the entity's own public key set
 *   - metadata contains the entity's role-specific metadata
 *   - exp is required (we default to 24h; operators should rotate regularly)
 *
 * NOTE: These are static scaffolding statements suitable for local lab and
 * OIDF certification test harness smoke runs. A production deployment would
 * dynamically sign and rotate entity statements.
 */

import { type KeyProvider } from "@letsfederate/kms";

export type EntityStatementConfig = {
  /** Entity ID — also used as iss and sub. */
  entityId: string;
  /** Authority hints — list of superior entity IDs (empty for TA). */
  authorityHints?: string[];
  /** Token lifetime in seconds (default 86400 = 24h). */
  ttlSeconds?: number;
  /** Additional metadata blocks to include. */
  metadata?: Record<string, unknown>;
  /**
   * Top-level `trust_mark_issuers` claim (OIDF §5.1.1). Published by a Trust
   * Anchor to declare which issuer entity IDs may mint each trust mark type:
   * `{ "<trust_mark_type>": ["<issuer entity id>", ...] }`. This is what lets a
   * verifier authorize a trust mark's (type, issuer) pair without trusting the
   * mark's own `jku`.
   */
  trustMarkIssuers?: Record<string, string[]>;
};

/**
 * Signs an OIDF entity statement JWT using the given KeyProvider.
 * Returns a compact JWS string.
 */
export async function signEntityStatement(
  config: EntityStatementConfig,
  kms: KeyProvider
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.ttlSeconds ?? 86400;
  const jwks = await kms.jwks();

  const payload = {
    iss: config.entityId,
    sub: config.entityId,
    iat: now,
    exp: now + ttl,
    jwks,
    ...(config.authorityHints && config.authorityHints.length > 0
      ? { authority_hints: config.authorityHints }
      : {}),
    ...(config.metadata ? { metadata: config.metadata } : {}),
    // trust_mark_issuers is a TOP-LEVEL claim per spec, not metadata.
    ...(config.trustMarkIssuers && Object.keys(config.trustMarkIssuers).length > 0
      ? { trust_mark_issuers: config.trustMarkIssuers }
      : {}),
  };

  return kms.signJwt(payload, {
    typ: "entity-statement+jwt",
  });
}

/**
 * Build the metadata block for a Trust Mark Issuer federation entity.
 */
export function tmiMetadata(jwksUri: string): Record<string, unknown> {
  return {
    federation_entity: {
      organization_name: "letsfederate TMI",
      contacts: ["ops@letsfederate.org"],
      jwks_uri: jwksUri,
      federation_trust_mark_issuer_endpoint: jwksUri.replace(
        "/.well-known/jwks.json",
        "/trustmarks/issue"
      ),
    },
  };
}

/**
 * Build the metadata block for a Trust Anchor federation entity.
 */
export function trustAnchorMetadata(opts: {
  organizationName: string;
  federationFetchEndpoint: string;
  federationListEndpoint: string;
  trustMarkStatusEndpoint: string;
}): Record<string, unknown> {
  return {
    federation_entity: {
      organization_name: opts.organizationName,
      contacts: ["ops@letsfederate.org"],
      federation_fetch_endpoint: opts.federationFetchEndpoint,
      federation_list_endpoint: opts.federationListEndpoint,
      federation_trust_mark_status_endpoint: opts.trustMarkStatusEndpoint,
    },
  };
}
