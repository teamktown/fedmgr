/**
 * @letsfederate/oidf-verify — OpenID Federation §10 trust-chain and trust-mark
 * verification. The single verifier the stack routes through (waypoint
 * admission, `fedmgr trustmark verify`, fedmgr-mcp).
 *
 * Pinned anchors (out-of-band keys), per-hop key binding, all authority_hints,
 * and trust marks verified via chain-resolved issuer keys + trust_mark_issuers
 * — never the presenter-supplied `jku`.
 */
export {
  verifyTrustChain,
  verifyTrustMark,
  fetchAnchorDescriptor,
  resolvePinnedAnchor,
} from "./verify.js";
export type {
  PinnedAnchor,
  VerifyChainOptions,
  ChainResult,
  VerifyTrustMarkOptions,
  TrustMarkResult,
  ResolveAnchorOptions,
} from "./verify.js";
