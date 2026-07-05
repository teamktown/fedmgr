/**
 * Cryptographic trust validation for waypoint admission.
 *
 * The accepted-anchor policy (policy.ts) gates on a downstream's CONFIGURED
 * identity. This layer adds the cryptographic proof: resolve the downstream's
 * OIDF trust chain from its entity id up to the expected anchor and require it to
 * be VALID. Anything else is a denial — fail-closed.
 *
 * Verification uses @letsfederate/oidf-verify (the shared §10 engine): per-hop
 * key binding, iss/sub/typ/exp checks, and — critically — the trust-anchor key
 * is PINNED, never network-fetched-and-self-trusted. Anchor keys come from
 * WAYPOINT_ANCHOR_JWKS (a JSON map of anchor entity id → JWKS) when set; if an
 * anchor is not hard-pinned, we fall back to trust-on-first-use (fetch the
 * anchor's entity configuration once and cache it) and log a warning — hard
 * pinning is strongly recommended for production.
 */
import {
  verifyTrustChain,
  fetchAnchorDescriptor,
  type PinnedAnchor,
} from "@letsfederate/oidf-verify";
import { log } from "./telemetry.js";

export interface ChainVerdict {
  valid: boolean;
  /** VALID | INVALID (from the shared verifier). */
  state: string;
  message: string;
}

export interface TrustValidator {
  /** Resolve entityId's trust chain to anchorUrl; valid only when fully VALID. */
  validateChain(entityId: string, anchorUrl: string): Promise<ChainVerdict>;
}

/** Parse WAYPOINT_ANCHOR_JWKS: `{ "<anchor entity id>": { "keys": [...] } }`. */
function hardPinnedAnchors(): Map<string, PinnedAnchor> {
  const raw = process.env["WAYPOINT_ANCHOR_JWKS"];
  const out = new Map<string, PinnedAnchor>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, { keys: unknown[] }>;
    for (const [entityId, jwks] of Object.entries(parsed)) {
      out.set(entityId.replace(/\/$/, ""), { entityId, jwks: jwks as PinnedAnchor["jwks"] });
    }
  } catch (err) {
    throw new Error(`[TRUST:FAIL] WAYPOINT_ANCHOR_JWKS is not valid JSON: ${String(err)}`);
  }
  return out;
}

/** Build a validator. Anchor descriptors are resolved once and cached. */
export function makeKmsTrustValidator(): TrustValidator {
  const pinned = hardPinnedAnchors();
  const cache = new Map<string, Promise<PinnedAnchor>>();

  const anchorFor = (anchorUrl: string): Promise<PinnedAnchor> => {
    const key = anchorUrl.replace(/\/$/, "");
    const hard = pinned.get(key);
    if (hard) return Promise.resolve(hard);
    let p = cache.get(key);
    if (!p) {
      log.warn("anchor not hard-pinned — trusting on first use", { anchor: anchorUrl });
      p = fetchAnchorDescriptor(anchorUrl).catch((err) => {
        cache.delete(key); // don't cache a failed bootstrap
        throw err;
      });
      cache.set(key, p);
    }
    return p;
  };

  return {
    async validateChain(entityId: string, anchorUrl: string): Promise<ChainVerdict> {
      const anchor = await anchorFor(anchorUrl);
      const r = await verifyTrustChain(entityId, { trustAnchors: [anchor] });
      return { valid: r.state === "VALID", state: r.state, message: r.message };
    },
  };
}

/** Default validator instance (reads WAYPOINT_ANCHOR_JWKS from the environment). */
export const kmsTrustValidator: TrustValidator = makeKmsTrustValidator();
