# Exposing waypoint to a remote MCP client (tunnels)

Anthropic's Claude connects to a remote MCP server **from Anthropic's cloud**
(egress range `160.79.104.0/21`) — even Claude Desktop/Cowork broker through
your account. So for claude.ai, waypoint must be **publicly reachable over
HTTPS**. These examples do that **without opening any inbound port**: the tunnel
agent makes an *outbound* connection to an edge that publishes a public hostname.

See the full decision guide + options matrix:
`docs/analysis/waypoint-remote-access.html`.

> Prereq: run waypoint's HTTP transport first (host or container), e.g.
> `WAYPOINT_HTTP_PORT=8077 WAYPOINT_CONFIG=... node packages/waypoint/dist/bin-http.js`.
> These sidecars point at `host.docker.internal:8077`.

## Cloudflare Tunnel (recommended production edge)
Stable custom domain + an identity-aware edge (Cloudflare Access) that federates
Entra/Google/Okta/OIDC/SAML, plus service tokens for non-human callers.

```bash
# 1. In the Cloudflare Zero Trust dashboard: create a tunnel, copy its token,
#    and map a public hostname (waypoint.<your-domain>) -> http://host.docker.internal:8077
# 2. Put the token in the environment and run the sidecar:
CF_TUNNEL_TOKEN=eyJ... docker compose -f examples/tunnels/docker-compose.cloudflared.yml up -d
```
Then, in the CF Zero Trust dashboard, add an **Access** application on that
hostname with your IdP + (for the machine caller) a **service token**. No inbound
firewall change; the tunnel is outbound-only.

## zrok / OpenZiti (fully self-hostable, OSS)
Apache-2.0, public HTTPS share, custom domains, generic OIDC gating — when you
want to own the whole control plane.

```bash
# Using the hosted zrok.io (or your self-hosted controller):
ZROK_ENABLE_TOKEN=... docker compose -f examples/tunnels/docker-compose.zrok.yml up -d
# reserved/custom-domain shares + OAuth: see https://docs.zrok.io
```

## Which to pick
- **Solo dev / org-owned control plane →** zrok.
- **Enterprise blessed endpoint →** Cloudflare Tunnel + Access.
- **Quick laptop demo →** Tailscale Funnel or ngrok (fastest public URL; rely on
  waypoint's own OAuth since they add no edge auth).

## Don't forget the OAuth WAF gotcha
If your IdP sits behind a WAF, allowlist Anthropic's `160.79.104.0/21` on its
`/token`, `/register`, and `/.well-known/*` endpoints — discovery calls come from
that range and will silently fail otherwise.
