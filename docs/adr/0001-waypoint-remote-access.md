# ADR 0001 — Secure remote access to a waypoint MCP endpoint

- **Status:** Proposed (pending the key questions in §Decision drivers)
- **Date:** 2026-07-05
- **Context owner:** Chris Phillips

## Context

Waypoint is a trust-enforcing MCP multiplexer. To be useful beyond a single
machine, a *client* — Claude (claude.ai / Cowork / API), another team's tooling,
or a developer's own agent — must reach a running waypoint. Today waypoint
serves Streamable HTTP on `:8077` behind a bearer-token OAuth edge, but it is on
a private VM with no public reachability and no OAuth *discovery* metadata, so no
cloud client can connect (see `docs/analysis/waypoint-cloud-connector.html`).

This ADR frames *how* we expose waypoint securely, for whom, and where it runs —
without committing to code until the product questions below are answered.

## The one question that forks everything: **where does the MCP client run?**

- **Path A — client runs on infra you control** (your own cloud pod / dev box
  running Claude Code, or another local agent). Then the clean answer is a
  **private overlay** (Tailscale / WireGuard): waypoint is never exposed to the
  public internet; only admitted devices reach it. Least attack surface, least
  ceremony, best compliance story.
- **Path B — client runs in Anthropic's cloud** (claude.ai custom connectors,
  Cowork, the API MCP connector). The connection originates from Anthropic's
  cloud even for the desktop apps, so a private overlay does **not** help — the
  endpoint must be **publicly reachable over HTTPS** and gated by **auth**. That
  means a **tunnel** (outbound-only, no inbound firewall holes) plus two auth
  layers: network-layer (e.g. Cloudflare Access / mTLS / service token) and/or
  MCP-layer **OAuth 2.1 + PKCE** with the spec's discovery metadata.

Most real deployments need BOTH paths depending on the audience.

## Decision drivers (the key questions to clarify)

1. **Client location** — Path A, Path B, or both? (Determines everything.)
2. **Naming/DNS** — do we standardize on `waypoint.<domain>` (a stable custom
   hostname)? Whose domain — the user's, or a `letsfederate.com`-hosted one?
3. **Who signs in, and against what IdP** — the human/agent authenticates to
   *what*? Entra ID, Google Workspace, AWS/Cognito, Okta, or a
   letsfederate-hosted AS? This sets the OAuth **audience** and the
   protected-resource metadata waypoint must advertise.
4. **Client registration mode** — Dynamic Client Registration, Client ID
   Metadata Documents, or Anthropic-held credentials? (Affects what waypoint's
   authorization-server side must implement.)
5. **Self-host vs hosted** — do users run their own tunnel + AS, or do we offer
   `letsfederate.com` as the hosted identity/exposure edge to remove the
   bootstrapping burden?
6. **CA trust model (enterprise)** — corp CA for the org's own trust + the
   letsfederate CA as the federation base of trust. How do the two compose?
7. **Local MCPs reaching waypoint** — when a dev's *local* MCP servers must
   themselves reach a central waypoint, is that in-cluster (docker network),
   over the overlay (Path A), or over the tunnel (Path B)?

## Options (to be compared in the workbench research page)

Exposure: Cloudflare Tunnel (+ Access), Tailscale (+ Funnel) / WireGuard,
zrok / OpenZiti (self-hostable), ngrok, SSH reverse tunnel, raw public + IP
allowlist. Auth: network-layer (Access / service token / mTLS / IP allowlist)
vs MCP-layer OAuth 2.1 + PKCE + Protected Resource Metadata.

## Decision

*Deferred* until the drivers above are answered. The workbench page
(`docs/analysis/waypoint-remote-access.html`) lays out the full comparison,
grounded in MCP spec `2025-11-25` and the providers' docs. Researched
recommendation per persona:

- **Path A (own pods/laptops):** Tailscale/WireGuard private overlay — no public
  exposure.
- **Solo dev, Path B:** zrok/OpenZiti public share (self-hostable, OSS) or
  Cloudflare Tunnel if a CF domain already exists.
- **Laptop → claude.ai demo:** Tailscale Funnel or ngrok (fastest public URL;
  lean on waypoint's own OAuth).
- **Enterprise blessed endpoint:** Cloudflare Tunnel + **Access** (identity-aware
  edge federating Entra/Google/Okta/OIDC/SAML + service tokens + mTLS) on a
  stable `waypoint.corp.example`; zrok if a fully org-owned control plane is
  mandatory.

Ship a **docker-compose tunnel sidecar** (`deploy/tunnels/`, Cloudflare + zrok)
as the "keep it clean and easy" bootstrap.

**Prerequisite regardless of exposure choice:** implement the MCP OAuth
*discovery* layer in waypoint — Protected Resource Metadata (RFC 9728) at
`/.well-known/oauth-protected-resource` listing ≥1 `authorization_servers`, the
`WWW-Authenticate: Bearer resource_metadata="…"` pointer on 401, RFC 8707
audience validation, and support for an **external authorization server** (an
IdP: Entra/Google/Okta/Auth0/Cognito). Prefer **CIMD** for client registration
(DCR is deprecated; Entra requires pre-registration). Allowlist Anthropic's
egress `160.79.104.0/21` on the IdP's `/token`, `/register`, `/.well-known/*`.

## Consequences

- We will build the MCP OAuth *discovery* layer in waypoint (PRM metadata +
  `WWW-Authenticate` pointer + AS discovery) regardless of exposure choice —
  it's the prerequisite for any cloud MCP client.
- A hosted `letsfederate.com` edge is a distinct product decision that trades
  user setup burden for our operational responsibility.
