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
  /** The downstream's OIDF entity id (HTTPS URL). */
  entityId: string;
  /** The trust anchor this downstream chains to (HTTPS URL). */
  trustAnchor: string;
  /** Trust marks the downstream is asserted to hold. */
  trustMarks?: string[];
}

/** The relying party's admission policy. */
export interface WaypointPolicy {
  /** Trust anchors the waypoint will accept (E5a accepted-anchor / E5b root). */
  acceptedAnchors: string[];
  /** A trust mark every admitted downstream must carry. */
  requiredTrustMark?: string;
}

export interface WaypointConfig {
  downstreams: DownstreamConfig[];
  policy: WaypointPolicy;
}
