/**
 * OIDF Subordinate Statement signing
 *
 * A subordinate statement is a JWT where:
 *   iss = issuing entity (the Trust Anchor or intermediate that vouches)
 *   sub = subject entity (the entity being vouched for)
 *
 * Per OpenID Federation 1.0 draft-43 §8.1:
 *   - Returned by the federation_fetch endpoint
 *   - Content-Type: application/entity-statement+jwt
 *   - Contains the subject's jwks and optional metadata/trust_marks
 *
 * The TA signs subordinate statements using its own private key. Verifiers
 * fetch the TA's JWKS to check the signature.
 */

import { type KeyProvider } from "@letsfederate/kms";
import { type JWK } from "jose";

export type SubordinateConfig = {
  /** Entity ID of the Trust Anchor (issuer of this statement). */
  issuerEntityId: string;
  /** Entity ID of the subordinate (TMI, MCP server, OP, etc.). */
  subjectEntityId: string;
  /** The subject's public JWKS. */
  subjectJwks: { keys: JWK[] };
  /** Optional role-specific metadata for the subject. */
  subjectMetadata?: Record<string, unknown>;
  /** Token lifetime in seconds (default 86400 = 24h). */
  ttlSeconds?: number;
};

/** Private JWK fields that must never appear in a signed subordinate statement. */
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;

/**
 * Strip private key material from a JWK before embedding it in a signed statement.
 * Prevents accidental private key disclosure in published federation documents.
 */
function stripPrivateFields(jwk: JWK): JWK {
  const pub = { ...jwk };
  for (const field of PRIVATE_JWK_FIELDS) {
    delete (pub as Record<string, unknown>)[field];
  }
  return pub;
}

/**
 * Signs a subordinate statement JWT.
 * `kms` must hold the TA's private key.
 */
export async function signSubordinateStatement(
  config: SubordinateConfig,
  kms: KeyProvider
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.ttlSeconds ?? 86400;

  // Strip private key material — must never appear in a signed federation document
  const publicJwks = {
    keys: config.subjectJwks.keys.map(stripPrivateFields),
  };

  const payload = {
    iss: config.issuerEntityId,
    sub: config.subjectEntityId,
    iat: now,
    exp: now + ttl,
    jwks: publicJwks,
    ...(config.subjectMetadata ? { metadata: config.subjectMetadata } : {}),
  };

  return kms.signJwt(payload, {
    typ: "entity-statement+jwt",
  });
}

/**
 * In-memory registry of subordinates the TA knows about.
 * Maps entity_id → { jwks, metadata? }
 *
 * In production this would be backed by persistent storage.
 * For the lab, it is populated at startup from environment config.
 */
export type SubordinateEntry = {
  entityId: string;
  jwks: { keys: JWK[] };
  metadata?: Record<string, unknown>;
};

/**
 * Returns true if the subordinate entry represents an intermediate entity —
 * i.e. an entity that itself has subordinates and exposes a
 * federation_fetch_endpoint.
 */
export function isIntermediate(entry: SubordinateEntry): boolean {
  const fe = (entry.metadata?.["federation_entity"] ?? {}) as Record<string, unknown>;
  return typeof fe["federation_fetch_endpoint"] === "string" &&
    (fe["federation_fetch_endpoint"] as string).length > 0;
}

export class SubordinateRegistry {
  protected readonly entries = new Map<string, SubordinateEntry>();

  register(entry: SubordinateEntry): void {
    this.entries.set(entry.entityId, entry);
  }

  get(entityId: string): SubordinateEntry | undefined {
    return this.entries.get(entityId);
  }

  listEntityIds(): string[] {
    return Array.from(this.entries.keys());
  }

  has(entityId: string): boolean {
    return this.entries.has(entityId);
  }
}
