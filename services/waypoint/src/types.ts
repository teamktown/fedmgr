/**
 * Waypoint configuration types.
 *
 * Trust is sourced from OPERATOR CONFIG + the accepted-anchor policy — NOT from
 * the downstream's in-band `oidf-trust` extension. WHY: the MCP SDK client strips
 * unknown `extensions` from a server's advertised capabilities, so a multiplexer
 * cannot read the self-asserted hint via the standard client. Config-declared
 * identity that the operator vets (and, as a follow-on, cryptographic chain
 * validation to an accepted anchor) is both readable and more trustworthy than an
 * unauthenticated handshake hint.
 */

/** A downstream MCP server the waypoint may multiplex, with its claimed identity. */
export interface DownstreamConfig {
  /** Local name; also the tool namespace prefix (e.g. `weather` → `weather__get`). */
  name: string;
  /** Executable to spawn (stdio transport), e.g. "node" or "npx". */
  command: string;
  /** Arguments for the executable. */
  args?: string[];
  /**
   * Extra environment for the spawned downstream, merged over the MCP SDK's
   * safe default set (HOME, PATH, …). The SDK strips the parent env by design,
   * so anything a downstream needs (e.g. NODE_ENV=development for lab http:
   * endpoints) must be declared here — explicit beats inherited for a PEP.
   */
  env?: Record<string, string>;
  /** The downstream's OIDF entity id (HTTPS URL). */
  entityId: string;
  /** The trust anchor this downstream chains to (entity id, HTTPS URL). */
  trustAnchor: string;
  /**
   * Reachable URL of the trust anchor for cryptographic chain resolution (used
   * when policy.requireValidChain is set). In the lab this equals the anchor
   * entity id (e.g. http://localhost:8090).
   */
  trustAnchorUrl?: string;
  /** Trust marks the downstream is asserted to hold. */
  trustMarks?: string[];
}

/** The relying party's admission policy. */
export interface WaypointPolicy {
  /** Trust anchors the waypoint will accept (E5a accepted-anchor / E5b root). */
  acceptedAnchors: string[];
  /** A trust mark every admitted downstream must carry. */
  requiredTrustMark?: string;
  /**
   * When true, in addition to the accepted-anchor config check, each downstream's
   * trust chain must cryptographically resolve to its trustAnchorUrl as VALID.
   * Fail-closed: WARN/INVALID/unreachable/no-validator ⇒ denied.
   */
  requireValidChain?: boolean;
}

export interface WaypointConfig {
  downstreams: DownstreamConfig[];
  policy: WaypointPolicy;
}
