/**
 * `org.letsfederate/oidf-trust` — an MCP extension for in-band trust advertisement.
 *
 * For the newcomer: MCP "extensions" are optional capabilities negotiated during
 * the `initialize` handshake (https://modelcontextprotocol.io/extensions/overview).
 * A server advertises an extension by putting a settings object under
 * `capabilities.extensions["{vendor}/{name}"]`. This extension lets a trust-aware
 * MCP server tell the client, up front, *who it is* and *which trust anchor vouches
 * for it* — so the client can decide whether to talk to it at all.
 *
 * TWO LAYERS, don't confuse them:
 *   - THIS module is the **handshake admission policy** over *advertised claims*
 *     (cheap, structural, accepted-anchor). It answers "should I even start?".
 *   - `validate_mcp_invocation` (openid-ops) is the **cryptographic verdict** over
 *     *signed JWTs* at call time. It answers "is this specific call authorized?".
 * Both are needed; this one is the fast Tier-1 gate, that one is the proof.
 *
 * SPEC: OIDF §"Entity Identifiers", §"Trust Marks". Advertised claims are NOT a
 * substitute for verifying the trust chain — they tell you where/how to verify.
 */

export const OIDF_TRUST_EXTENSION_ID = "org.letsfederate/oidf-trust";

/** What a server advertises at `initialize`. All ids are HTTPS entity URLs. */
export interface OidfTrustExtension {
  /** The server's own OIDF entity identifier. */
  entityId: string;
  /** The trust anchor this server claims to chain up to. */
  trustAnchor: string;
  /** Where to fetch the server's signed entity configuration for verification. */
  federationConfigUrl: string;
  /** Trust marks the server claims to hold (advisory until cryptographically verified). */
  trustMarks: string[];
  /** Optional OCI image digest this server runs as (for container-bound trust). */
  imageDigest?: string;
}

/** The relying party's policy for accepting a server at handshake time. */
export interface OidfTrustPolicy {
  /** Trust anchors we are willing to chain to (E5a accepted-anchor / E5b root). */
  acceptedAnchors: string[];
  /** A mark the server must advertise (cryptographically enforced later). */
  requiredTrustMark?: string;
  /** If set, the advertised imageDigest must match exactly (E3/E4 container binding). */
  expectedImageDigest?: string;
}

export interface OidfTrustDecision {
  admit: boolean;
  checks: Record<string, boolean>;
  reasons: string[];
}

/** Build the extension settings object a server advertises at `initialize`. */
export function buildOidfTrustExtension(opts: {
  entityId: string;
  trustAnchor: string;
  federationConfigUrl?: string;
  trustMarks?: string[];
  imageDigest?: string;
}): OidfTrustExtension {
  const base = opts.entityId.replace(/\/+$/, "");
  return {
    entityId: opts.entityId,
    trustAnchor: opts.trustAnchor,
    federationConfigUrl:
      opts.federationConfigUrl ?? `${base}/.well-known/openid-federation`,
    trustMarks: opts.trustMarks ?? [],
    ...(opts.imageDigest ? { imageDigest: opts.imageDigest } : {}),
  };
}

function isHttpsUrl(s: unknown): boolean {
  if (typeof s !== "string" || s.length === 0) return false;
  try {
    const proto = new URL(s).protocol;
    if (proto === "https:") return true;
    // http is permitted ONLY in development/lab (NODE_ENV=development), mirroring
    // the SSRF guard's policy — production entity ids must be https.
    return proto === "http:" && process.env["NODE_ENV"] === "development";
  } catch {
    return false;
  }
}

/**
 * Decide whether to admit a server based on its advertised oidf-trust extension
 * and the relying party's policy. FAIL-CLOSED: anything malformed, an unaccepted
 * anchor, a missing advertised mark, or a digest mismatch ⇒ `admit:false`.
 *
 * This intentionally does NOT verify signatures — it is the handshake gate.
 * Cryptographic admission is `validate_mcp_invocation` over the issued JWTs.
 */
export function evaluateOidfTrust(
  ext: unknown,
  policy: OidfTrustPolicy
): OidfTrustDecision {
  const reasons: string[] = [];
  const checks: Record<string, boolean> = {
    wellFormed: false,
    anchorAccepted: false,
    requiredTrustMarkAdvertised: false,
    imageDigestBound: false,
  };

  const e = ext as Partial<OidfTrustExtension> | null | undefined;
  checks.wellFormed =
    !!e && isHttpsUrl(e.entityId) && isHttpsUrl(e.trustAnchor) && Array.isArray(e.trustMarks);
  if (!checks.wellFormed) {
    reasons.push("oidf-trust extension is malformed or missing an https entityId/trustAnchor");
    return { admit: false, checks, reasons };
  }

  checks.anchorAccepted = policy.acceptedAnchors.includes(e!.trustAnchor!);
  if (!checks.anchorAccepted) {
    reasons.push(`trust anchor ${e!.trustAnchor} is not in the accepted-anchor list`);
  }

  if (policy.requiredTrustMark) {
    checks.requiredTrustMarkAdvertised = (e!.trustMarks ?? []).includes(policy.requiredTrustMark);
    if (!checks.requiredTrustMarkAdvertised) {
      reasons.push(`required trust mark ${policy.requiredTrustMark} is not advertised`);
    }
  } else {
    checks.requiredTrustMarkAdvertised = true;
  }

  if (policy.expectedImageDigest) {
    checks.imageDigestBound = e!.imageDigest === policy.expectedImageDigest;
    if (!checks.imageDigestBound) {
      reasons.push(
        `image digest mismatch (expected ${policy.expectedImageDigest}, advertised ${e!.imageDigest ?? "none"})`
      );
    }
  } else {
    checks.imageDigestBound = true;
  }

  const admit =
    checks.wellFormed &&
    checks.anchorAccepted &&
    checks.requiredTrustMarkAdvertised &&
    checks.imageDigestBound;
  return { admit, checks, reasons };
}
