# Phase 6.4 — waypoint HTTP/SSE transport + OAuth edge (identity plane)

Run date 2026-06-15. Node v22.22.3. Raw runner output. Unlocks the cloud/web journey:
remote MCP over Streamable HTTP, gated by an OAuth/OIDC bearer edge (inbound identity).
Downstream the gate remains OpenID Federation.

## OAuth edge — verify inbound OIDC bearer (`test/oauth-edge.test.mjs`)
```
ok 1 - valid token → AuthInfo with clientId, scopes, expiresAt
ok 2 - wrong issuer → reject
ok 3 - wrong audience → reject
ok 4 - expired token → reject
ok 5 - tampered signature → reject
ok 6 - config without key or jwksUri throws (fail-closed)
# tests 6
# pass 6
# fail 0
```

## HTTP/SSE end-to-end over loopback (`test/http-integration.test.mjs`)

Starts the real HTTP server; a real MCP client connects over Streamable HTTP:
```
ok 1 - GET /health is open and reports tool count
ok 2 - POST /mcp without a bearer token → 401 (OAuth edge, fail-closed)
ok 3 - MCP client over Streamable HTTP with a valid bearer → initialize + namespaced tools
# tests 3
# pass 3
# fail 0
```

Proven: `/health` is open; `POST /mcp` without a bearer → **401** (fail-closed);
a valid bearer → MCP `initialize` + `tools/list` returns the namespaced trusted tools.

## Notes
- Transport: `StreamableHTTPServerTransport` (modern remote transport), one session/
  transport per client, all sharing one Waypoint (downstream connections).
- Auth: SDK `requireBearerAuth({ verifier })` + a jose JWKS verifier (issuer/audience/
  signature/expiry). Inbound OAuth/OIDC — NOT OpenID Federation.
- `waypoint-http` bin; env WAYPOINT_CONFIG + WAYPOINT_OIDC_ISSUER/AUDIENCE/JWKS_URI.
