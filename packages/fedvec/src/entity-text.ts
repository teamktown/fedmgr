/**
 * entity-text — deterministic serialization of a federation entity into the
 * text that gets embedded.
 *
 * The searchable signal for an OpenID-Federation entity lives in its id and its
 * metadata (display name, description, organization, contacts, and the
 * per-role blocks like `federation_entity` / `openid_relying_party`). We flatten
 * those human-meaningful strings into one document. Order is stable so the same
 * entity always produces the same text (and therefore the same content hash).
 */

export interface FederationEntity {
  /** OIDF entity identifier (a URL). */
  entityId: string;
  /** Lifecycle status, e.g. "active" | "revoked". Carried through to results. */
  status?: string;
  /** Arbitrary OIDF metadata (federation_entity, openid_relying_party, ...). */
  metadata?: Record<string, unknown> | null;
}

// Metadata keys whose string values are meaningful to a human searcher.
const MEANINGFUL_KEYS = new Set([
  "display_name",
  "description",
  "organization_name",
  "organization",
  "name",
  "keywords",
  "tags",
  "policy_uri",
  "homepage_uri",
  "contacts",
  "federation_fetch_endpoint",
  "client_name",
  "scope",
  "grant_types",
  "trust_marks",
  "trust_mark_types",
]);

/** Recursively collect meaningful string fragments from a metadata value. */
function collectStrings(value: unknown, keyHint: string, out: string[]): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (MEANINGFUL_KEYS.has(keyHint) || keyHint === "") out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keyHint, out);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Descend into nested role blocks, carrying the key as the hint so a
      // string sitting directly under a meaningful key gets captured.
      collectStrings(v, k, out);
    }
  }
}

/**
 * Flatten an entity into a single embeddable document string.
 * The entityId is always included (its host/path often carries meaning, e.g.
 * "tmi.example.com" → trust mark issuer).
 */
export function entityToText(entity: FederationEntity): string {
  const parts: string[] = [];

  // Entity id, plus a de-slugged variant so "trust-anchor" also reads as words.
  parts.push(entity.entityId);
  const humanized = entity.entityId
    .replace(/^https?:\/\//, "")
    .replace(/[/_.\-:]+/g, " ")
    .trim();
  if (humanized) parts.push(humanized);

  if (entity.metadata) {
    const collected: string[] = [];
    collectStrings(entity.metadata, "", collected);
    // Also always surface the top-level role names (federation_entity, etc.)
    for (const k of Object.keys(entity.metadata)) {
      collected.push(k.replace(/_/g, " "));
    }
    parts.push(...collected);
  }

  return parts.join(" — ");
}
