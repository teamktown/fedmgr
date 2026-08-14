/**
 * OCI trustmark-attestation verification helpers (deep-reassessment supply-chain
 * finding: `oci verify-trustmark` accepted ANY signer and never checked the
 * embedded trustmark).
 *
 * Two trust-critical checks, both pure and testable without cosign/a registry:
 *   1. assertPinnedSigner — refuse a wildcard/empty signer identity so cosign is
 *      never asked to accept "any signer from any issuer".
 *   2. verifyEmbeddedTrustmark — extract the trustmark JWS from the attestation
 *      predicate, verify it chain-rooted via @letsfederate/oidf-verify (pinned
 *      anchor, no jku), and bind it to the image digest.
 */
import { decodeJwt } from "jose";
import { verifyTrustMark, type PinnedAnchor } from "@letsfederate/oidf-verify";

const WILDCARDS = new Set([".+", ".*", "*", "", ".+?", "^.*$", "^.+$"]);

/**
 * Reject an unpinned cosign signer identity/issuer. A specific string or a
 * bounded regexp is fine; a catch-all wildcard means "trust anyone" — theater.
 */
export function assertPinnedSigner(identity: string | undefined, issuer: string | undefined): void {
  const bad = (v: string | undefined): boolean => v === undefined || WILDCARDS.has(v.trim());
  if (bad(identity)) {
    throw new Error(
      "[TRUST:FAIL] --certificate-identity(-regexp) must name a specific signer (or a bounded regexp), not a wildcard like '.+'. " +
      "Verifying a signature while accepting ANY signer proves nothing."
    );
  }
  if (bad(issuer)) {
    throw new Error(
      "[TRUST:FAIL] --certificate-oidc-issuer(-regexp) must name a specific OIDC issuer, not a wildcard like '.+'."
    );
  }
}

/** Pull the trustmark JWS out of an attestation predicate of various shapes. */
export function extractTrustmarkJws(predicate: unknown): string | undefined {
  if (typeof predicate === "string") return predicate.includes(".") ? predicate : undefined;
  if (predicate && typeof predicate === "object") {
    const p = predicate as Record<string, unknown>;
    for (const k of ["trustmark_jws", "jws", "trustMark", "trust_mark"]) {
      if (typeof p[k] === "string") return p[k] as string;
    }
    // in-toto style { predicate: {...} }
    if (p["predicate"] && typeof p["predicate"] === "object") return extractTrustmarkJws(p["predicate"]);
  }
  return undefined;
}

/** Normalize an image ref or digest string to a bare sha256:... digest, if present. */
export function digestFromImageRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const m = ref.match(/@(sha256:[0-9a-f]{64})/i);
  if (m) return m[1]!.toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/i.test(ref)) return ref.toLowerCase();
  return undefined;
}

export interface EmbeddedVerifyResult {
  ok: boolean;
  reasons: string[];
  trustMarkType?: string;
  issuer?: string;
}

/**
 * Verify the trustmark embedded in a cosign attestation predicate: chain-rooted
 * signature (pinned anchor, no jku) AND — when an expected digest is supplied —
 * that the mark actually attests THIS image.
 */
export async function verifyEmbeddedTrustmark(opts: {
  predicate: unknown;
  trustAnchors: PinnedAnchor[];
  expectedDigest?: string;
  fetchFn?: typeof fetch;
  requiredTypes?: string[];
}): Promise<EmbeddedVerifyResult> {
  const jws = extractTrustmarkJws(opts.predicate);
  if (!jws) {
    return { ok: false, reasons: ["no trustmark JWS found in the attestation predicate"] };
  }
  const reasons: string[] = [];
  const r = await verifyTrustMark(jws, {
    trustAnchors: opts.trustAnchors,
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.requiredTypes ? { requiredTypes: opts.requiredTypes } : {}),
  });
  if (r.state !== "VALID") reasons.push(r.message);

  if (opts.expectedDigest) {
    let claimed: string | undefined;
    try {
      claimed = (decodeJwt(jws) as Record<string, unknown>)["image_digest"] as string | undefined;
    } catch {
      claimed = undefined;
    }
    const want = opts.expectedDigest.toLowerCase();
    if (!claimed) {
      reasons.push(`trustmark has no image_digest claim — cannot bind it to image ${want}`);
    } else if (claimed.toLowerCase() !== want) {
      reasons.push(`image_digest mismatch: trustmark attests ${claimed}, image is ${want}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    ...(r.trustMarkType ? { trustMarkType: r.trustMarkType } : {}),
    ...(r.issuer ? { issuer: r.issuer } : {}),
  };
}
