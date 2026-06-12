/**
 * Cryptographic trust validation for waypoint admission.
 *
 * The accepted-anchor policy (policy.ts) gates on a downstream's CONFIGURED
 * identity. This layer adds the cryptographic proof: resolve the downstream's
 * OIDF trust chain from its entity id up to the expected anchor and require it to
 * be VALID. A WARN (couldn't fully verify) or INVALID result is a denial —
 * fail-closed. Reuses `validateTrustChain` from @letsfederate/kms, so it needs
 * the entity + trust anchor to be reachable (the lab, or production endpoints).
 */
import { validateTrustChain } from "@letsfederate/kms";

export interface ChainVerdict {
  valid: boolean;
  /** VALID | WARN | INVALID (from the kms resolver). */
  state: string;
  message: string;
}

export interface TrustValidator {
  /** Resolve entityId's trust chain to anchorUrl; valid only when fully VALID. */
  validateChain(entityId: string, anchorUrl: string): Promise<ChainVerdict>;
}

/** Real validator backed by the OIDF trust-chain resolver. */
export const kmsTrustValidator: TrustValidator = {
  async validateChain(entityId: string, anchorUrl: string): Promise<ChainVerdict> {
    const r = await validateTrustChain(entityId, anchorUrl);
    return { valid: r.state === "VALID", state: r.state, message: r.message };
  },
};
