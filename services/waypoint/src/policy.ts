/**
 * Waypoint admission policy — decide whether a downstream may be multiplexed.
 *
 * Reuses the OIDF accepted-anchor policy from @letsfederate/fedmgr-mcp
 * (`evaluateOidfTrust`) over the downstream's CONFIGURED identity. Fail-closed.
 *
 * Scope (be honest): this is the accepted-anchor gate. Full cryptographic
 * admission — resolving the downstream's trust chain to the anchor and verifying
 * its trust mark — is the next layer and plugs in via `check_trust_chain` /
 * `validate_mcp_invocation` (already built); it needs the TA/TMI reachable.
 */
import {
  buildOidfTrustExtension,
  evaluateOidfTrust,
  type OidfTrustDecision,
} from "@letsfederate/fedmgr-mcp";
import type { DownstreamConfig, WaypointPolicy } from "./types.js";

export function evaluateDownstream(
  d: DownstreamConfig,
  policy: WaypointPolicy
): OidfTrustDecision {
  const ext = buildOidfTrustExtension({
    entityId: d.entityId,
    trustAnchor: d.trustAnchor,
    trustMarks: d.trustMarks ?? [],
  });
  return evaluateOidfTrust(ext, {
    acceptedAnchors: policy.acceptedAnchors,
    ...(policy.requiredTrustMark ? { requiredTrustMark: policy.requiredTrustMark } : {}),
  });
}
