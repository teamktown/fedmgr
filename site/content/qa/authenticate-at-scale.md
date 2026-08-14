---
question: How does authentication work when I connect a cloud AI to my waypoint?
arc: deploy-oidf-with-ai
audience: [enterprise, operator]
tags: [oauth, oidc, identity, waypoint, discovery, rfc9728]
---
There are two distinct planes, and keeping them separate is what makes this scale:

- **Identity plane (inbound):** who is calling waypoint. This is OAuth 2.1 / OIDC. Waypoint is a
  *resource server* — it validates a bearer token from your existing identity provider (Entra, Google,
  Okta, AWS), checking audience, issuer, expiry, and algorithm. It does **not** run its own login; it
  delegates to the IdP you already operate.
- **Trust plane (downstream):** what waypoint connects to. This is OpenID Federation — the chain
  verification and trust marks described elsewhere.

For a cloud assistant (like claude.ai) to connect, waypoint advertises where to authenticate using
Protected Resource Metadata (RFC 9728): an unauthenticated request gets a `401` whose
`WWW-Authenticate` header points at a metadata document listing the authorization server. The client
reads it, runs the OAuth flow against **your** IdP, and returns with a valid token. You authenticate
once, against your own tenant; downstream trust decisions ride the federation, not a second login.
