/**
 * Trust policy + result formatting.
 *
 * The trust-DECISION engine (chain walking, trust-mark verification) moved to
 * @letsfederate/oidf-verify, which does proper OIDF §10 key binding, pins the
 * trust-anchor key out-of-band, and never trusts a mark's `jku`. The old
 * validateTrustmark/validateTrustChain that lived here were REMOVED (they were
 * the source of the deep-reassessment findings #1/#2) so no weak trust-decision
 * path remains reachable.
 *
 * What stays here is verifier-agnostic:
 *   - TrustResult / TrustState — the shape consumers format and act on.
 *   - applyPolicy — strict | permissive | audit enforcement of a result.
 *   - formatTrustMessage — single-line rendering.
 *
 * Two trust states (the §10 engine is binary and fail-closed; WARN is retained
 * only as a legacy value some callers may still branch on):
 *   VALID   — verified and rooted in the expected, pinned trust anchor
 *   INVALID — anything else (bad signature, expiry, broken binding, fetch error)
 */

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
