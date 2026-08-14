/**
 * OpenID Federation §10 trust-chain and trust-mark verification.
 *
 * The single, spec-correct verifier the whole stack routes through. It fixes the
 * two criticals and two highs from the 2026-07 deep re-assessment:
 *
 *   #1 (crit) trust marks are verified against the issuer's CHAIN-RESOLVED
 *             federation keys, never the presenter-supplied `jku` header.
 *   #2 (crit) every hop BINDS the subject's entity-configuration signing key to
 *             the `jwks` in its superior's subordinate statement; `iss`/`sub`/
 *             `typ`/`exp` are checked; the trust anchor key is PINNED
 *             out-of-band (never network-fetched-and-self-trusted); ALL
 *             `authority_hints` are tried, not just the first.
 *   #3 (high) trust marks require `typ: trust-mark+jwt`; `trust_mark_type` is
 *             read (with legacy `id` accepted for migration).
 *   #4 (high) a trust mark's (type, issuer) pair must be authorized by the
 *             anchor's `trust_mark_issuers`.
 *
 * All network access goes through an injectable `fetchFn`. Production callers
 * should pass an SSRF-guarding fetch (e.g. wrapping @letsfederate/kms
 * assertSafeUrl); the structural guard here only rejects non-http(s) URLs.
 */
import { jwtVerify, decodeJwt, importJWK, calculateJwkThumbprint, type JWK } from "jose";

const ENTITY_TYP = "entity-statement+jwt";
const TRUST_MARK_TYP = "trust-mark+jwt";
const WELL_KNOWN = "/.well-known/openid-federation";

export interface PinnedAnchor {
  /** Trust-anchor entity identifier. */
  entityId: string;
  /** The anchor's public keys, pinned OUT-OF-BAND (config, not the network). */
  jwks: { keys: JWK[] };
  /** Optional: `type → [authorized issuer ids]`. If absent, read from the anchor EC. */
  trustMarkIssuers?: Record<string, string[]>;
}

export interface VerifyChainOptions {
  /** Anchors trusted by out-of-band pinned keys. Empty = nothing is trusted. */
  trustAnchors: PinnedAnchor[];
  fetchFn?: typeof fetch;
  /** Clock skew tolerance in seconds (default 60). */
  clockTolerance?: number;
  /** Max hops before giving up (default 10). */
  maxDepth?: number;
  /** Optional SSRF guard applied to every fetched URL. Throws to reject. */
  assertUrl?: (url: string) => void;
}

export interface ChainResult {
  state: "VALID" | "INVALID";
  subject: string;
  trustAnchor?: string;
  chainDepth?: number;
  /** Entity ids from leaf up to and including the anchor. */
  path?: string[];
  message: string;
  /** The verified anchor (pinned jwks ∪ EC-derived trust_mark_issuers). */
  anchor?: PinnedAnchor;
  /** entityId → verified federation jwks, for each entity whose EC was verified. */
  verifiedKeys?: Record<string, { keys: JWK[] }>;
}

export interface VerifyTrustMarkOptions {
  trustAnchors: PinnedAnchor[];
  fetchFn?: typeof fetch;
  clockTolerance?: number;
  maxDepth?: number;
  assertUrl?: (url: string) => void;
  /** Relying-party policy: if set, the mark's type must be one of these. */
  requiredTypes?: string[];
}

export interface TrustMarkResult {
  state: "VALID" | "INVALID";
  subject: string;
  issuer: string;
  trustMarkType?: string;
  /** True when the type came from the legacy `id` claim, not `trust_mark_type`. */
  legacyClaim?: boolean;
  trustAnchor?: string;
  message: string;
}

const norm = (id: string): string => id.replace(/\/$/, "");

function defaultAssertUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`malformed URL: ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`unsupported URL scheme: ${u.protocol}`);
  }
  if (u.username || u.password) throw new Error("URL must not embed credentials");
}

/** jose error code for a signature that simply didn't match this key. */
function isSignatureMismatch(err: unknown): boolean {
  return (err as { code?: string })?.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
}
function isExpired(err: unknown): boolean {
  return (err as { code?: string })?.code === "ERR_JWT_EXPIRED";
}

class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyError";
  }
}

/**
 * Closed JWS alg set accepted by this verifier (EC family only — go-oidfed's
 * lighthouse signs ES512 by default, our lab historically ES256). The alg for
 * each candidate key is derived from the key itself, never from the JWS header
 * alone; the allowlist is enforced again by jose at verification time.
 * Mirrors SUPPORTED_JWS_ALGS in @letsfederate/kms — kept local so this
 * package stays dependency-free.
 */
const SUPPORTED_JWS_ALGS = ["ES256", "ES384", "ES512"];
const EC_CRV_TO_ALG: Record<string, string> = {
  "P-256": "ES256",
  "P-384": "ES384",
  "P-521": "ES512",
};

/** alg for a candidate JWK: its own `alg` if supported, else from its curve. */
function algForCandidateJwk(jwk: JWK): string | undefined {
  if (jwk.alg) return SUPPORTED_JWS_ALGS.includes(jwk.alg) ? jwk.alg : undefined;
  return jwk.kty === "EC" && jwk.crv ? EC_CRV_TO_ALG[jwk.crv] : undefined;
}

/**
 * Verify a compact JWS against a set of candidate JWKs.
 * Returns the payload and the JWK that verified it. A key that fails only on
 * SIGNATURE is skipped; a key that matches but yields an invalid claim (expiry,
 * typ, iss…) fails immediately with that reason (so we don't mask an expired but
 * correctly-signed token as "signature failed").
 */
async function verifyAgainstJwks(
  jws: string,
  jwks: { keys: JWK[] } | undefined,
  opts: { typ?: string; clockTolerance?: number },
): Promise<{ payload: Record<string, unknown>; jwk: JWK }> {
  const keys = jwks?.keys ?? [];
  if (keys.length === 0) throw new VerifyError("no candidate keys");
  let sawMismatch = false;
  for (const jwk of keys) {
    const alg = algForCandidateJwk(jwk);
    if (!alg) continue; // key outside the supported EC family — never a verifier
    let key: Awaited<ReturnType<typeof importJWK>>;
    try {
      key = await importJWK(jwk, alg);
    } catch {
      continue;
    }
    try {
      const { payload } = await jwtVerify(jws, key, {
        algorithms: SUPPORTED_JWS_ALGS,
        clockTolerance: opts.clockTolerance ?? 60,
        ...(opts.typ ? { typ: opts.typ } : {}),
      });
      return { payload: payload as Record<string, unknown>, jwk };
    } catch (err) {
      if (isSignatureMismatch(err)) {
        sawMismatch = true;
        continue;
      }
      if (isExpired(err)) throw new VerifyError("token expired");
      throw new VerifyError(
        `token rejected: ${(err as { code?: string })?.code ?? String((err as Error)?.message ?? err)}`,
      );
    }
  }
  throw new VerifyError(sawMismatch ? "signature verification failed" : "no usable key");
}

const thumb = (jwk: JWK): Promise<string> => calculateJwkThumbprint(jwk);

async function jwksContainsKey(jwks: { keys: JWK[] } | undefined, jwk: JWK): Promise<boolean> {
  if (!jwks?.keys?.length) return false;
  const target = await thumb(jwk);
  for (const k of jwks.keys) {
    try {
      if ((await thumb(k)) === target) return true;
    } catch {
      /* skip unfingerprintable key */
    }
  }
  return false;
}

interface VerifiedConfig {
  entityId: string;
  payload: Record<string, unknown>;
  jwks: { keys: JWK[] };
  /** The key that signed this entity's self-signed configuration. */
  signingJwk: JWK;
}

/**
 * Fetch and verify an entity's self-signed Entity Configuration.
 * Confirms the self-signature against the jwks in its own payload and that
 * iss == sub == entityId, plus typ/exp. Returns the verified keys + signing key.
 */
async function verifyEntityConfig(
  entityId: string,
  fetchFn: typeof fetch,
  clockTolerance: number,
  assertUrl: (u: string) => void,
): Promise<VerifiedConfig> {
  const url = `${norm(entityId)}${WELL_KNOWN}`;
  assertUrl(url);
  const r = await fetchFn(url);
  if (!r.ok) throw new VerifyError(`entity configuration fetch failed for ${entityId} (HTTP ${r.status})`);
  const jwt = await r.text();
  let unverified: Record<string, unknown>;
  try {
    unverified = decodeJwt(jwt) as Record<string, unknown>;
  } catch {
    throw new VerifyError(`entity configuration for ${entityId} is not a JWT`);
  }
  const jwks = unverified["jwks"] as { keys: JWK[] } | undefined;
  const { payload, jwk } = await verifyAgainstJwks(jwt, jwks, { typ: ENTITY_TYP, clockTolerance });
  if (payload["iss"] !== entityId || payload["sub"] !== entityId) {
    throw new VerifyError(
      `entity configuration for ${entityId} has iss/sub mismatch (iss=${String(payload["iss"])}, sub=${String(payload["sub"])})`,
    );
  }
  return { entityId, payload, jwks: jwks as { keys: JWK[] }, signingJwk: jwk };
}

async function fetchSubordinateStatement(
  authorityId: string,
  subId: string,
  fetchFn: typeof fetch,
  assertUrl: (u: string) => void,
): Promise<string> {
  const url = `${norm(authorityId)}/federation_fetch?sub=${encodeURIComponent(subId)}`;
  assertUrl(url);
  const r = await fetchFn(url);
  if (r.status === 403) throw new VerifyError(`subordinate ${subId} is revoked at ${authorityId} (403)`);
  if (!r.ok) throw new VerifyError(`no subordinate statement for ${subId} at ${authorityId} (HTTP ${r.status})`);
  return r.text();
}

/**
 * Verify a trust chain from `entityId` up to any pinned trust anchor, applying
 * §10 binding at every hop.
 */
export async function verifyTrustChain(
  entityId: string,
  opts: VerifyChainOptions,
): Promise<ChainResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const clockTolerance = opts.clockTolerance ?? 60;
  const maxDepth = opts.maxDepth ?? 10;
  const assertUrl = opts.assertUrl ?? defaultAssertUrl;
  const pinned = new Map<string, PinnedAnchor>(opts.trustAnchors.map((a) => [norm(a.entityId), a]));
  const verifiedKeys: Record<string, { keys: JWK[] }> = {};

  const invalid = (message: string, chainDepth?: number): ChainResult => ({
    state: "INVALID",
    subject: entityId,
    message: `[TRUST:FAIL] ${message}`,
    ...(chainDepth !== undefined ? { chainDepth } : {}),
  });

  let current: VerifiedConfig;
  try {
    current = await verifyEntityConfig(entityId, fetchFn, clockTolerance, assertUrl);
  } catch (err) {
    return invalid((err as Error).message);
  }
  verifiedKeys[norm(entityId)] = current.jwks;

  const path: string[] = [entityId];
  const visited = new Set<string>([norm(entityId)]);
  let depth = 0;

  while (depth <= maxDepth) {
    if (pinned.has(norm(current.entityId))) {
      // The subject itself is a pinned anchor.
      return finishAtAnchor(pinned.get(norm(current.entityId))!, current, path, depth, verifiedKeys, entityId, fetchFn, clockTolerance, assertUrl);
    }
    const hints = (current.payload["authority_hints"] as string[] | undefined) ?? [];
    if (hints.length === 0) {
      return invalid(`${current.entityId} has no authority_hints — no path to a pinned anchor`, depth);
    }

    let advanced: { authorityId: string; authEC?: VerifiedConfig; pinnedAnchor?: PinnedAnchor } | null = null;
    let lastErr = "no authority_hint produced a valid binding";
    for (const authorityId of hints) {
      try {
        const anchor = pinned.get(norm(authorityId));
        let authorityKeys: { keys: JWK[] };
        let authEC: VerifiedConfig | undefined;
        if (anchor) {
          authorityKeys = anchor.jwks; // pinned out-of-band
        } else {
          authEC = await verifyEntityConfig(authorityId, fetchFn, clockTolerance, assertUrl);
          authorityKeys = authEC.jwks;
        }
        const subJwt = await fetchSubordinateStatement(authorityId, current.entityId, fetchFn, assertUrl);
        const { payload: subPayload } = await verifyAgainstJwks(subJwt, authorityKeys, {
          typ: ENTITY_TYP,
          clockTolerance,
        });
        if (subPayload["iss"] !== authorityId) throw new VerifyError("subordinate statement iss mismatch");
        if (subPayload["sub"] !== current.entityId) throw new VerifyError("subordinate statement sub mismatch");
        // §10 KEY BINDING: the subject's EC signing key must be vouched for.
        const subJwks = subPayload["jwks"] as { keys: JWK[] } | undefined;
        if (!(await jwksContainsKey(subJwks, current.signingJwk))) {
          throw new VerifyError(`key binding failed: ${current.entityId} signing key not in ${authorityId}'s subordinate statement`);
        }
        advanced = anchor ? { authorityId, pinnedAnchor: anchor } : { authorityId, authEC };
        break;
      } catch (err) {
        lastErr = (err as Error).message;
      }
    }

    if (!advanced) return invalid(lastErr, depth);
    path.push(advanced.authorityId);
    depth++;

    if (advanced.pinnedAnchor) {
      return finishAtAnchor(advanced.pinnedAnchor, current, path, depth, verifiedKeys, entityId, fetchFn, clockTolerance, assertUrl);
    }
    if (visited.has(norm(advanced.authorityId))) return invalid("authority_hints cycle detected", depth);
    visited.add(norm(advanced.authorityId));
    current = advanced.authEC!;
    verifiedKeys[norm(current.entityId)] = current.jwks;
  }

  return invalid(`chain exceeded max depth (${maxDepth}) without reaching a pinned anchor`, depth);
}

/** Terminal step: record the anchor, enrich trust_mark_issuers from its EC. */
async function finishAtAnchor(
  anchor: PinnedAnchor,
  _current: VerifiedConfig,
  path: string[],
  depth: number,
  verifiedKeys: Record<string, { keys: JWK[] }>,
  subject: string,
  fetchFn: typeof fetch,
  clockTolerance: number,
  assertUrl: (u: string) => void,
): Promise<ChainResult> {
  verifiedKeys[norm(anchor.entityId)] = anchor.jwks;
  let trustMarkIssuers = anchor.trustMarkIssuers;
  if (!trustMarkIssuers) {
    // Read trust_mark_issuers from the anchor's EC, verified against PINNED keys.
    try {
      const url = `${norm(anchor.entityId)}${WELL_KNOWN}`;
      assertUrl(url);
      const r = await fetchFn(url);
      if (r.ok) {
        const jwt = await r.text();
        const { payload } = await verifyAgainstJwks(jwt, anchor.jwks, { typ: ENTITY_TYP, clockTolerance });
        const tmi = payload["trust_mark_issuers"] as Record<string, string[]> | undefined;
        if (tmi) trustMarkIssuers = tmi;
      }
    } catch {
      /* anchor EC optional; pinned descriptor is authoritative */
    }
  }
  return {
    state: "VALID",
    subject,
    trustAnchor: anchor.entityId,
    chainDepth: depth,
    path,
    message: `[TRUST:VALID] ${subject} → ${anchor.entityId} (${depth} hop${depth === 1 ? "" : "s"})`,
    anchor: { ...anchor, ...(trustMarkIssuers ? { trustMarkIssuers } : {}) },
    verifiedKeys,
  };
}

/**
 * Verify a trust mark: its issuer must chain to a pinned anchor, the mark must
 * be signed by the issuer's chain-resolved keys (never `jku`), and the
 * (type, issuer) pair must be authorized by the anchor's trust_mark_issuers.
 */
export async function verifyTrustMark(
  markJws: string,
  opts: VerifyTrustMarkOptions,
): Promise<TrustMarkResult> {
  let unverified: Record<string, unknown>;
  try {
    unverified = decodeJwt(markJws) as Record<string, unknown>;
  } catch {
    return { state: "INVALID", subject: "(unknown)", issuer: "(unknown)", message: "[TRUST:FAIL] trust mark is not a JWT" };
  }
  const issuer = unverified["iss"] as string | undefined;
  const subject = (unverified["sub"] as string | undefined) ?? "(unknown)";
  const typedType = unverified["trust_mark_type"] as string | undefined;
  const legacyType = unverified["id"] as string | undefined;
  const markType = typedType ?? legacyType;
  const legacyClaim = !typedType && !!legacyType;

  const fail = (message: string): TrustMarkResult => ({
    state: "INVALID",
    subject,
    issuer: issuer ?? "(unknown)",
    ...(markType ? { trustMarkType: markType } : {}),
    message: `[TRUST:FAIL] ${message}`,
  });

  if (!issuer) return fail("trust mark has no iss");
  if (!markType) return fail("trust mark has neither trust_mark_type nor legacy id");

  // 1. Resolve the ISSUER's chain to a pinned anchor.
  const chain = await verifyTrustChain(issuer, {
    trustAnchors: opts.trustAnchors,
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.clockTolerance !== undefined ? { clockTolerance: opts.clockTolerance } : {}),
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.assertUrl ? { assertUrl: opts.assertUrl } : {}),
  });
  if (chain.state !== "VALID") return fail(`trust mark issuer ${issuer} does not chain to a trusted anchor`);

  // 2. Verify the mark with the issuer's CHAIN-RESOLVED keys (never jku).
  const issuerKeys = chain.verifiedKeys?.[norm(issuer)];
  try {
    await verifyAgainstJwks(markJws, issuerKeys, { typ: TRUST_MARK_TYP, clockTolerance: opts.clockTolerance ?? 60 });
  } catch (err) {
    const m = (err as Error).message;
    return fail(m.includes("expired") ? "trust mark expired" : `trust mark signature/typ invalid: ${m}`);
  }

  // 3. Authorization: anchor.trust_mark_issuers[type] must include the issuer.
  const tmIssuers = chain.anchor?.trustMarkIssuers;
  const authorized = tmIssuers?.[markType]?.some((i) => norm(i) === norm(issuer)) ?? false;
  if (!authorized) {
    return fail(`issuer ${issuer} is not authorized for ${markType} in the anchor's trust_mark_issuers`);
  }

  // 4. Relying-party policy.
  if (opts.requiredTypes && !opts.requiredTypes.includes(markType)) {
    return fail(`trust mark type ${markType} is not among the required types`);
  }

  return {
    state: "VALID",
    subject,
    issuer,
    trustMarkType: markType,
    ...(legacyClaim ? { legacyClaim: true } : {}),
    trustAnchor: chain.trustAnchor!,
    message: `[TRUST:VALID] trust mark ${markType} for ${subject} issued by ${issuer} (chain → ${chain.trustAnchor})`,
  };
}

export interface ResolveAnchorOptions {
  /** The trust anchor's entity id (its base URL). */
  entityId: string;
  /** Hard-pinned keys (from config/env/inline). When present, no network fetch. */
  pinnedJwks?: { keys: JWK[] };
  /** Optional pinned type → issuer-id authorization. */
  trustMarkIssuers?: Record<string, string[]>;
  fetchFn?: typeof fetch;
  assertUrl?: (u: string) => void;
  /** Invoked when falling back to trust-on-first-use (so the caller can warn). */
  onTofu?: (entityId: string) => void;
}

/**
 * Resolve a PinnedAnchor for a consumer: prefer hard-pinned keys; otherwise fall
 * back to trust-on-first-use (fetch + verify the anchor EC once) and invoke
 * `onTofu` so the caller can log the weaker posture. Every trust-deciding
 * surface should route anchor resolution through this so pinning is consistent.
 */
export async function resolvePinnedAnchor(opts: ResolveAnchorOptions): Promise<PinnedAnchor> {
  if (opts.pinnedJwks?.keys?.length) {
    return {
      entityId: opts.entityId,
      jwks: opts.pinnedJwks,
      ...(opts.trustMarkIssuers ? { trustMarkIssuers: opts.trustMarkIssuers } : {}),
    };
  }
  opts.onTofu?.(opts.entityId);
  const descriptor = await fetchAnchorDescriptor(opts.entityId, {
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.assertUrl ? { assertUrl: opts.assertUrl } : {}),
  });
  return opts.trustMarkIssuers
    ? { ...descriptor, trustMarkIssuers: opts.trustMarkIssuers }
    : descriptor;
}

/**
 * Helper for consumers: fetch an anchor's Entity Configuration and derive a
 * PinnedAnchor from it. This is TRUST-ON-FIRST-USE — the caller SHOULD prefer a
 * hard-pinned jwks from config; use this only when bootstrapping, and log it.
 */
export async function fetchAnchorDescriptor(
  entityId: string,
  opts: { fetchFn?: typeof fetch; assertUrl?: (u: string) => void } = {},
): Promise<PinnedAnchor> {
  const fetchFn = opts.fetchFn ?? fetch;
  const assertUrl = opts.assertUrl ?? defaultAssertUrl;
  const url = `${norm(entityId)}${WELL_KNOWN}`;
  assertUrl(url);
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`anchor EC fetch failed for ${entityId} (HTTP ${r.status})`);
  const jwt = await r.text();
  const payload = decodeJwt(jwt) as Record<string, unknown>;
  const jwks = payload["jwks"] as { keys: JWK[] } | undefined;
  if (!jwks?.keys?.length) throw new Error(`anchor ${entityId} EC has no jwks`);
  // Confirm the EC is self-consistent (self-signed by a listed key).
  await verifyAgainstJwks(jwt, jwks, { typ: ENTITY_TYP });
  const trustMarkIssuers = payload["trust_mark_issuers"] as Record<string, string[]> | undefined;
  return { entityId, jwks, ...(trustMarkIssuers ? { trustMarkIssuers } : {}) };
}
