# waypoint MCP OAuth discovery layer (spec)

**Why.** Today waypoint verifies bearer tokens but a remote MCP client (claude.ai)
can't **discover where to authenticate** — the 401 has no pointer and there's no
Protected Resource Metadata. This is the one prerequisite for *any* cloud MCP
client, and it's the same regardless of exposure tool or IdP. Grounded in MCP
`2025-11-25` (and forward to the `2026-07-28` RC, which keeps the resource-server
model). See `docs/analysis/waypoint-cloud-connector.html`.

Spec-first → test-first → code.

## What the spec requires of us (the resource server)
1. **Protected Resource Metadata (RFC 9728)** at
   `/.well-known/oauth-protected-resource` — a JSON doc that MUST list ≥1
   `authorization_servers` and echo the `resource` (our canonical URL). Open
   (no auth).
2. **401 discovery pointer:** the `WWW-Authenticate: Bearer` header MUST carry
   `resource_metadata="<PRM URL>"` so the client can find (1).
3. The **authorization server is external** (an IdP: Entra/Google/Okta…). We
   don't implement `/authorize`/`/token`/AS-metadata — the IdP does. We only
   point at it. This is the resource-server-delegates-to-external-AS model
   (spec ≥ 2025-06-18).

## Config (all already partly present)
- `WAYPOINT_OIDC_ISSUER` — the external AS (→ `authorization_servers: [issuer]`).
- `WAYPOINT_OIDC_AUDIENCE` — our canonical resource URL (→ PRM `resource`, and
  the RFC 8707 audience we already validate).
- `WAYPOINT_RESOURCE_METADATA_URL` (optional) — override the PRM URL advertised
  in the 401 (needed when behind a tunnel: the public URL differs from the bind
  address). Defaults to `${audience}/.well-known/oauth-protected-resource`.

## PRM document shape
```json
{
  "resource": "https://waypoint.example",
  "authorization_servers": ["https://accounts.google.com"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp"]
}
```

## API
- `buildProtectedResourceMetadata(cfg)` → the PRM object (pure, testable).
- `createHttpApp` serves `GET /.well-known/oauth-protected-resource` (open) and
  passes `resourceMetadataUrl` to the bearer-auth middleware so the 401 carries
  `resource_metadata=…` (fall back to a manual header if the SDK version lacks
  the option).

## Stateless-ready
Discovery is inherently stateless (no session, no handshake) — it's already
`2026-07-28`-RC-forward. This slice doesn't touch the per-session transport; the
stateless transport migration is tracked separately.

## Test plan (before the code)
1. `buildProtectedResourceMetadata({resource, issuer})` → `resource` echoed,
   `authorization_servers` = `[issuer]` (non-empty). Throws if issuer missing
   (fail-closed).
2. `GET /.well-known/oauth-protected-resource` → 200, valid PRM JSON, **no auth
   required**.
3. `POST /mcp` with no token → 401 **and** `WWW-Authenticate` contains
   `resource_metadata="…/.well-known/oauth-protected-resource"`. (Regression
   guard: today it's missing — that's the bug this closes.)
4. `/health` stays open; a bogus token still 401 (unchanged).

## Why it matters
With (1)+(2) in place, a claude.ai connector can run the full discovery →
external-IdP OAuth → PKCE → call flow. Combined with the T0 tunnel, that's the
end-to-end "Claude cloud reaches our waypoint" path — the bedrock external-use
milestone.
