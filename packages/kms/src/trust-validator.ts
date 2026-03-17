/**
 * Trust Validator
 *
 * Validates trustmark JWS tokens and optionally walks the full OIDF trust
 * chain from a subject entity up to a named trust anchor.
 *
 * Three trust states:
 *   VALID   — signature verified, not expired, chain rooted in expected TA
 *   WARN    — structurally valid but something is advisory (expiring soon,
 *              chain not fully verified, TA not confirmed)
 *   INVALID — signature bad, expired, chain broken, or fetch error
 *
 * Three trust policies (set via TRUST_POLICY env or TrustPolicyConfig):
 *   strict      — INVALID causes immediate process exit with code 78 (EX_CONFIG)
 *   permissive  — INVALID emits [TRUST:WARN] but execution continues
 *   audit       — everything is logged; never blocks
 */

import {
  jwtVerify,
  decodeProtectedHeader,
  decodeJwt,
  importJWK,
  type JWK,
} from "jose";
import { assertSafeUrl, UrlSafetyError } from "./validate-url.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrustState = "VALID" | "WARN" | "INVALID";

export type TrustPolicy = "strict" | "permissive" | "audit";

export interface TrustResult {
  /** Overall trust state. */
  state: TrustState;
  /** Entity ID of the subject being checked. */
  subject: string;
  /** Trustmark type URI (`id` claim). */
  trustmarkId?: string;
  /** Entity ID of the TMI that issued this trustmark. */
  issuer?: string;
  /** Expiry timestamp. */
  expiresAt?: Date;
  /** Trust Anchor entity ID (if chain was verified). */
  trustAnchor?: string;
  /** Number of hops in the verified chain (0 = JWS only, not chain-verified). */
  chainDepth?: number;
  /** Whether the trustmark was adopted from another issuer. */
  adoptedFrom?: { issuer: string; trustmarkId: string };
  /** Human-readable explanation of the trust state. */
  message: string;
  /** Concrete action the operator should take (only for WARN/INVALID). */
  recommendedAction?: string;
}

export interface ValidateTrustmarkOptions {
  /** Override the JWKS URL from the JWS `jku` header. */
  jwksUrl?: string;
  /** Seconds before expiry that triggers a WARN (default: 3600 = 1h). */
  expiryWarnThresholdSecs?: number;
  /** Injectable fetch (for testing). */
  fetchFn?: typeof fetch;
}

export interface ValidateChainOptions {
  /** Maximum hops before giving up (default: 10). */
  maxDepth?: number;
  /** Clock tolerance in seconds (default: 60). */
  clockTolerance?: number;
  /** Injectable fetch (for testing). */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Core: validate a trustmark JWS
// ---------------------------------------------------------------------------

/**
 * Validate a compact JWS trustmark token.
 *
 * 1. Decodes the protected header to find `jku` (JWKS URL).
 * 2. Fetches the JWKS and verifies the signature.
 * 3. Checks `exp` and warns if expiring within `expiryWarnThresholdSecs`.
 * 4. Returns a structured TrustResult.
 */
export async function validateTrustmark(
  jws: string,
  opts: ValidateTrustmarkOptions = {}
): Promise<TrustResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const warnThreshold = opts.expiryWarnThresholdSecs ?? 3600;

  // ── 1. Decode header ───────────────────────────────────────────────────
  let header: Record<string, unknown>;
  let jwksUrl: string;

  try {
    header = decodeProtectedHeader(jws) as Record<string, unknown>;
  } catch (err) {
    return {
      state: "INVALID",
      subject: "(unknown)",
      message: `[TRUST:FAIL] JWS header decode failed: ${String(err)}`,
      recommendedAction:
        "Check that the trustmark token is a valid compact JWS. " +
        "Re-issue with: fedmgr trustmark issue --sub <url>",
    };
  }

  try {
    const rawJkuUrl = opts.jwksUrl ?? (header["jku"] as string);
    if (!rawJkuUrl || typeof rawJkuUrl !== "string") {
      throw new Error("No `jku` in JWS header and no --jwks override supplied");
    }
    // assertSafeUrl blocks SSRF via jku: private IPs, loopback, non-HTTPS
    assertSafeUrl(rawJkuUrl, "jku");
    jwksUrl = rawJkuUrl;
  } catch (err) {
    const isSsrf = err instanceof UrlSafetyError;
    return {
      state: "INVALID",
      subject: "(unknown)",
      message: `[TRUST:FAIL] ${isSsrf ? "SSRF-unsafe jku URL" : "Cannot determine JWKS URL"}: ${String(err)}`,
      recommendedAction:
        isSsrf
          ? "The trustmark jku header must point to a public HTTPS URL. Re-issue from a publicly reachable TMI."
          : "The trustmark must contain a `jku` header claim pointing to the TMI JWKS. " +
            "Verify the TMI server is serving GET /.well-known/jwks.json and re-issue.",
    };
  }

  // ── 2. Fetch JWKS ─────────────────────────────────────────────────────
  let keys: JWK[];

  try {
    const r = await fetchFn(jwksUrl);
    if (!r.ok) {
      throw new Error(`HTTP ${r.status} ${r.statusText}`);
    }
    const body = (await r.json()) as { keys?: unknown[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error("JWKS response has no keys array");
    }
    keys = body.keys as JWK[];
  } catch (err) {
    return {
      state: "INVALID",
      subject: "(unknown)",
      message: `[TRUST:FAIL] JWKS fetch failed (${jwksUrl}): ${String(err)}`,
      recommendedAction:
        `The TMI JWKS endpoint is unreachable. Verify the TMI server is running at ${jwksUrl}. ` +
        "If the TMI URL has changed, re-issue the trustmark with the correct --tmi.",
    };
  }

  // ── 3. Verify JWS signature ───────────────────────────────────────────
  let payload: Record<string, unknown>;
  let verified = false;

  for (const jwk of keys) {
    try {
      const cryptoKey = await importJWK(jwk, "ES256");
      const result = await jwtVerify(jws, cryptoKey, { clockTolerance: 60 });
      payload = result.payload as Record<string, unknown>;
      verified = true;
      break;
    } catch {
      // Try next key
    }
  }

  if (!verified) {
    // Attempt to extract subject from unverified payload for better error msg
    let subject = "(unknown)";
    try {
      subject = (decodeJwt(jws).sub as string | undefined) ?? "(unknown)";
    } catch {
      // ignore
    }
    return {
      state: "INVALID",
      subject,
      message:
        "[TRUST:FAIL] Trustmark JWS signature verification FAILED — " +
        `no key in JWKS at ${jwksUrl} produced a valid signature`,
      recommendedAction:
        "The signing key has either been rotated or the trustmark was tampered with. " +
        "Re-issue the trustmark: fedmgr trustmark issue --sub <url>. " +
        "If keys were rotated, ensure the new public JWK is published to the JWKS endpoint before re-issuing.",
    };
  }

  // ── 4. Extract claims ─────────────────────────────────────────────────
  const subject = (payload!["sub"] as string | undefined) ?? "(unknown)";
  const issuer = (payload!["iss"] as string | undefined) ?? "(unknown)";
  const trustmarkId = payload!["id"] as string | undefined;
  const exp = payload!["exp"] as number | undefined;
  const expiresAt = exp ? new Date(exp * 1000) : undefined;
  const adoptedFromIssuer = payload!["adopted_from_iss"] as string | undefined;
  const adoptedFromId = payload!["adopted_from_id"] as string | undefined;

  // ── 5. Expiry checks ──────────────────────────────────────────────────
  if (expiresAt && expiresAt < new Date()) {
    return {
      state: "INVALID",
      subject,
      issuer,
      trustmarkId,
      expiresAt,
      message: `[TRUST:FAIL] Trustmark expired at ${expiresAt.toISOString()} — this trustmark is no longer valid`,
      recommendedAction:
        "Re-issue the trustmark: fedmgr trustmark issue --sub <url> --tmi <tmi-url>. " +
        "Consider reducing TTL and automating re-issuance before expiry.",
    };
  }

  const warnAtMs = expiresAt
    ? expiresAt.getTime() - warnThreshold * 1000
    : null;
  if (warnAtMs !== null && Date.now() > warnAtMs) {
    const remaining = Math.round(
      ((expiresAt?.getTime() ?? 0) - Date.now()) / 1000
    );
    return {
      state: "WARN",
      subject,
      issuer,
      trustmarkId,
      expiresAt,
      adoptedFrom:
        adoptedFromIssuer && adoptedFromId
          ? { issuer: adoptedFromIssuer, trustmarkId: adoptedFromId }
          : undefined,
      message:
        `[TRUST:WARN] Trustmark for ${subject} expires in ${remaining}s ` +
        `(${expiresAt?.toISOString()}) — signature valid but renewal is due`,
      recommendedAction:
        "Re-issue the trustmark before it expires to avoid a gap in trust coverage: " +
        "fedmgr trustmark issue --sub <url>",
    };
  }

  return {
    state: "VALID",
    subject,
    issuer,
    trustmarkId,
    expiresAt,
    chainDepth: 0, // JWS-only, chain not verified by this call
    adoptedFrom:
      adoptedFromIssuer && adoptedFromId
        ? { issuer: adoptedFromIssuer, trustmarkId: adoptedFromId }
        : undefined,
    message:
      `[TRUST:VALID] Trustmark verified — ` +
      `issuer=${issuer} sub=${subject}` +
      (expiresAt ? ` exp=${expiresAt.toISOString()}` : "") +
      (adoptedFromIssuer ? ` (adopted from ${adoptedFromIssuer})` : ""),
  };
}

// ---------------------------------------------------------------------------
// Chain: walk from entity up to trust anchor
// ---------------------------------------------------------------------------

/**
 * Validate that a TMI's entity statement is signed by the expected trust anchor.
 *
 * Walks authority_hints from the TMI entity statement up to the trust anchor,
 * verifying each signed subordinate statement.
 */
export async function validateTrustChain(
  entityId: string,
  expectedTrustAnchor: string,
  opts: ValidateChainOptions = {}
): Promise<TrustResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxDepth = opts.maxDepth ?? 10;
  const clockTolerance = opts.clockTolerance ?? 60;

  const fetchEntityStatement = async (entityUrl: string): Promise<string> => {
    const url = `${entityUrl.replace(/\/$/, "")}/.well-known/openid-federation`;
    const r = await fetchFn(url);
    if (!r.ok) {
      throw new Error(`GET ${url} returned HTTP ${r.status}`);
    }
    return r.text();
  };

  const fetchSubordinateStatement = async (
    taUrl: string,
    subEntityId: string
  ): Promise<string> => {
    const url = `${taUrl.replace(/\/$/, "")}/federation_fetch?sub=${encodeURIComponent(subEntityId)}`;
    const r = await fetchFn(url);
    if (!r.ok) {
      throw new Error(`federation_fetch returned HTTP ${r.status} (sub=${subEntityId})`);
    }
    return r.text();
  };

  // ── Fetch leaf entity statement ───────────────────────────────────────
  let leafJwt: string;
  try {
    leafJwt = await fetchEntityStatement(entityId);
  } catch (err) {
    return {
      state: "INVALID",
      subject: entityId,
      message: `[TRUST:FAIL] Cannot fetch entity statement for ${entityId}: ${String(err)}`,
      recommendedAction:
        `Verify that ${entityId}/.well-known/openid-federation is accessible and returns a valid JWT. ` +
        "Check network connectivity and TLS certificate validity.",
    };
  }

  let leafPayload: Record<string, unknown>;
  try {
    leafPayload = decodeJwt(leafJwt) as Record<string, unknown>;
  } catch {
    return {
      state: "INVALID",
      subject: entityId,
      message: `[TRUST:FAIL] Entity statement for ${entityId} is not a valid JWT`,
      recommendedAction: "Check the TMI server entity statement endpoint is returning a valid signed JWT.",
    };
  }

  const authorityHints = (leafPayload["authority_hints"] as string[] | undefined) ?? [];
  if (authorityHints.length === 0) {
    return {
      state: "WARN",
      subject: entityId,
      message:
        `[TRUST:WARN] Entity ${entityId} has no authority_hints — cannot verify chain to trust anchor`,
      recommendedAction:
        "Add authority_hints pointing to your trust anchor when deploying the TMI server. " +
        "Set TMI_AUTHORITY_HINTS=[\"https://letsfederate.org\"] in the TMI environment.",
    };
  }

  // ── Walk up to the trust anchor ───────────────────────────────────────
  let currentEntityId = entityId;
  let depth = 0;

  while (depth < maxDepth) {
    // Refresh authority hints from the current entity's entity statement
    let entityJwt: string;
    try {
      entityJwt = await fetchEntityStatement(currentEntityId);
    } catch (err) {
      return {
        state: "INVALID",
        subject: entityId,
        message: `[TRUST:FAIL] Cannot fetch entity statement for ${currentEntityId} during chain walk: ${String(err)}`,
        chainDepth: depth,
        recommendedAction: `Check that ${currentEntityId} is reachable.`,
      };
    }

    const entityPayload = decodeJwt(entityJwt) as Record<string, unknown>;
    const hints = (entityPayload["authority_hints"] as string[] | undefined) ?? [];
    if (hints.length === 0) {
      return {
        state: "WARN",
        subject: entityId,
        message:
          `[TRUST:WARN] Chain walk stalled at ${currentEntityId} — no authority_hints at depth ${depth}`,
        chainDepth: depth,
        recommendedAction: "Verify the intermediate entity has authority_hints configured.",
      };
    }

    const authorityId = hints[0]!;

    // ── Fetch authority entity statement (to get their JWKS) ──────────
    let authorityJwt: string;
    try {
      authorityJwt = await fetchEntityStatement(authorityId);
    } catch (err) {
      return {
        state: "INVALID",
        subject: entityId,
        message: `[TRUST:FAIL] Cannot fetch authority entity statement at ${authorityId}: ${String(err)}`,
        chainDepth: depth,
        recommendedAction: `Verify that ${authorityId} is deployed and serving /.well-known/openid-federation.`,
      };
    }

    const authorityPayload = decodeJwt(authorityJwt) as Record<string, unknown>;
    const authorityJwks = authorityPayload["jwks"] as { keys: JWK[] } | undefined;
    if (!authorityJwks?.keys?.length) {
      return {
        state: "INVALID",
        subject: entityId,
        message: `[TRUST:FAIL] Authority ${authorityId} entity statement missing jwks claim`,
        chainDepth: depth,
        recommendedAction: "The authority's entity statement must include a jwks claim. Check the TA server configuration.",
      };
    }

    // ── Fetch and verify subordinate statement ────────────────────────
    let subordJwt: string;
    try {
      subordJwt = await fetchSubordinateStatement(authorityId, currentEntityId);
    } catch (err) {
      return {
        state: "INVALID",
        subject: entityId,
        message:
          `[TRUST:FAIL] Authority ${authorityId} has no subordinate statement for ${currentEntityId}: ${String(err)}`,
        chainDepth: depth,
        recommendedAction:
          `Register ${currentEntityId} as a subordinate of ${authorityId}. ` +
          "For the TA, set TA_SUBORDINATES or use TA_REGISTRY_PATH to add the TMI.",
      };
    }

    // Verify the subordinate statement with the authority's JWKS
    let subordVerified = false;
    for (const jwk of authorityJwks.keys) {
      try {
        const cryptoKey = await importJWK(jwk, "ES256");
        await jwtVerify(subordJwt, cryptoKey, { clockTolerance });
        subordVerified = true;
        break;
      } catch {
        // Try next key
      }
    }

    if (!subordVerified) {
      return {
        state: "INVALID",
        subject: entityId,
        message:
          `[TRUST:FAIL] Subordinate statement from ${authorityId} for ${currentEntityId} ` +
          `failed signature verification — key mismatch or tampered JWT`,
        chainDepth: depth,
        recommendedAction:
          "The authority's signing key may have been rotated without re-issuing the subordinate statement. " +
          "Re-register the subordinate with the authority: ensure TA has the correct JWKS for the TMI.",
      };
    }

    depth++;

    // ── Reached the trust anchor? ─────────────────────────────────────
    if (authorityId === expectedTrustAnchor) {
      return {
        state: "VALID",
        subject: entityId,
        trustAnchor: expectedTrustAnchor,
        chainDepth: depth,
        message:
          `[TRUST:VALID] Full chain verified — ${entityId} ` +
          `→ ${expectedTrustAnchor} (${depth} hop${depth === 1 ? "" : "s"})`,
      };
    }

    currentEntityId = authorityId;
  }

  return {
    state: "INVALID",
    subject: entityId,
    message: `[TRUST:FAIL] Chain exceeded max depth (${maxDepth}) without reaching trust anchor ${expectedTrustAnchor}`,
    chainDepth: depth,
    recommendedAction:
      "Check for misconfigured authority_hints creating a loop, or increase maxDepth if the chain is legitimately deep.",
  };
}

// ---------------------------------------------------------------------------
// Policy enforcement
// ---------------------------------------------------------------------------

/**
 * Apply a trust policy to a TrustResult.
 *
 * - strict:      INVALID → throw TrustPolicyError (caller must halt)
 * - permissive:  INVALID → log warning to stderr, continue
 * - audit:       all states → log to stderr, never throw
 */
export function applyPolicy(result: TrustResult, policy: TrustPolicy): void {
  const line = formatTrustMessage(result);

  if (result.state === "VALID" && policy !== "audit") {
    process.stderr.write(`${line}\n`);
    return;
  }

  if (result.state === "WARN") {
    process.stderr.write(`${line}\n`);
    if (result.recommendedAction) {
      process.stderr.write(
        `  Recommended: ${result.recommendedAction}\n`
      );
    }
    return;
  }

  if (result.state === "INVALID") {
    process.stderr.write(`${line}\n`);
    if (result.recommendedAction) {
      process.stderr.write(
        `  Recommended: ${result.recommendedAction}\n`
      );
    }

    if (policy === "strict") {
      throw new TrustPolicyError(result);
    }
    // permissive / audit: log only, do not throw
    if (policy === "permissive") {
      process.stderr.write(
        "  [TRUST:POLICY] Operating in permissive mode — proceeding despite trust failure.\n" +
        "  Set TRUST_POLICY=strict to enforce trust validation.\n"
      );
    }
  }
}

/** Thrown by applyPolicy when policy=strict and state=INVALID. */
export class TrustPolicyError extends Error {
  constructor(public readonly result: TrustResult) {
    super(result.message);
    this.name = "TrustPolicyError";
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a TrustResult as a single-line log message. */
export function formatTrustMessage(result: TrustResult): string {
  const parts = [result.message];
  if (result.issuer) parts.push(`issuer=${result.issuer}`);
  if (result.trustAnchor) parts.push(`ta=${result.trustAnchor}`);
  if (result.chainDepth !== undefined) parts.push(`chain=${result.chainDepth}`);
  if (result.adoptedFrom)
    parts.push(`adopted_from=${result.adoptedFrom.issuer}`);
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Convenience: read policy from environment
// ---------------------------------------------------------------------------

/** Read TRUST_POLICY env var; default to 'strict'. */
export function trustPolicyFromEnv(): TrustPolicy {
  const raw = (process.env["TRUST_POLICY"] ?? "strict").toLowerCase();
  if (raw === "permissive" || raw === "audit" || raw === "strict") {
    return raw as TrustPolicy;
  }
  process.stderr.write(
    `[TRUST:WARN] Unknown TRUST_POLICY="${raw}" — defaulting to strict. ` +
    "Valid values: strict | permissive | audit\n"
  );
  return "strict";
}
