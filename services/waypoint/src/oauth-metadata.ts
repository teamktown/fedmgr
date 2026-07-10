/**
 * OAuth Protected Resource Metadata (RFC 9728) for waypoint.
 *
 * This is how a remote MCP client (claude.ai) discovers WHERE to authenticate:
 * on a 401, waypoint points at this document via
 * `WWW-Authenticate: Bearer resource_metadata="…"`; the client fetches it, reads
 * `authorization_servers`, and runs the OAuth flow against that external IdP.
 * waypoint stays a resource server — it does not implement the AS. See
 * docs/dev/waypoint-oauth-discovery.md.
 */

export interface ProtectedResourceMetadataConfig {
  /** Canonical URL of this resource server (RFC 8707 audience). */
  resource: string;
  /** ≥1 authorization server (issuer) URL — the external IdP. */
  authorizationServers: string[];
  scopesSupported?: string[];
  bearerMethodsSupported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported?: string[];
}

/** Build the RFC 9728 document. Fail-closed on missing resource / no AS. */
export function buildProtectedResourceMetadata(
  cfg: ProtectedResourceMetadataConfig,
): ProtectedResourceMetadata {
  if (!cfg.resource) {
    throw new Error("[TRUST:FAIL] protected-resource-metadata requires a canonical resource URL");
  }
  if (!Array.isArray(cfg.authorizationServers) || cfg.authorizationServers.length === 0) {
    throw new Error("[TRUST:FAIL] protected-resource-metadata requires >=1 authorization_servers");
  }
  return {
    resource: cfg.resource,
    authorization_servers: cfg.authorizationServers,
    bearer_methods_supported: cfg.bearerMethodsSupported ?? ["header"],
    ...(cfg.scopesSupported ? { scopes_supported: cfg.scopesSupported } : {}),
  };
}
