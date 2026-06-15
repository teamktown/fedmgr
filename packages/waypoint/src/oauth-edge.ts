/**
 * OAuth edge — the identity plane (inbound auth to waypoint).
 *
 * IMPORTANT framing: signing *into* waypoint is plain **OAuth/OIDC** (e.g. sign in
 * with GitHub / Google / Okta / Entra). This is **NOT** OpenID Federation — it
 * authenticates the human/agent that may reach waypoint over HTTP/SSE. (waypoint
 * becomes OpenID Federation only when it turns *downstream*; see policy.ts.)
 *
 * This verifies a bearer JWT against the IdP's JWKS — issuer + audience + signature
 * + expiry — and returns the MCP SDK `AuthInfo`. Fail-closed: any problem throws,
 * and `requireBearerAuth` turns that into a 401. Local stdio needs none of this.
 */
import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";

export interface OAuthEdgeConfig {
  /** Expected token issuer (the IdP), e.g. https://accounts.google.com. */
  issuer: string;
  /** Expected audience — this waypoint's identifier. */
  audience: string;
  /** The IdP's JWKS URI (production). */
  jwksUri?: string;
  /**
   * Pre-resolved verification key — for tests or a pinned key. Takes precedence
   * over jwksUri. Either a key or a jose key-resolver function.
   */
  key?: KeyLike | Uint8Array | JWTVerifyGetKey;
}

/**
 * Build an OAuthTokenVerifier for the bearer-auth middleware. The verifier checks
 * issuer/audience/signature/expiry and maps OIDC claims to AuthInfo.
 */
export function makeOAuthEdge(cfg: OAuthEdgeConfig): OAuthTokenVerifier {
  const key: KeyLike | Uint8Array | JWTVerifyGetKey | undefined =
    cfg.key ?? (cfg.jwksUri ? createRemoteJWKSet(new URL(cfg.jwksUri)) : undefined);
  if (!key) {
    throw new Error("[TRUST:FAIL] OAuth edge requires a jwksUri or a key");
  }
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      // jose checks signature, issuer, audience, exp/nbf. Throws on any failure.
      // The key is either a resolver function (createRemoteJWKSet) or a pinned key.
      const opts = { issuer: cfg.issuer, audience: cfg.audience };
      const { payload } =
        typeof key === "function"
          ? await jwtVerify(token, key as JWTVerifyGetKey, opts)
          : await jwtVerify(token, key as KeyLike | Uint8Array, opts);
      const scopes =
        typeof payload["scope"] === "string"
          ? (payload["scope"] as string).split(" ").filter(Boolean)
          : [];
      return {
        token,
        clientId: String(payload["azp"] ?? payload["client_id"] ?? payload.sub ?? "unknown"),
        scopes,
        // requireBearerAuth requires a numeric expiresAt and re-checks expiry —
        // a token with no `exp` is rejected (fail-closed).
        ...(typeof payload.exp === "number" ? { expiresAt: payload.exp } : {}),
        extra: { sub: payload.sub, iss: payload.iss },
      } as AuthInfo;
    },
  };
}
