# @letsfederate/waypoint

**A trust-enforcing MCP multiplexer.** Your client (e.g. Claude Code) points at
*one* MCP server — waypoint — and waypoint connects to N downstream MCP servers,
admits only the ones that satisfy your **accepted-anchor policy**, and re-exposes
only their tools (namespaced `<name>__<tool>`). The client never gets a path to an
untrusted MCP. This is "trusted connection" as the default.

```
Claude Code ──MCP──▶ waypoint ──▶ fedmgr   (anchor accepted → fedmgr__* tools exposed)
 (points at ONE       (the only   ──▶ weather  (anchor accepted → weather__* exposed)
  server)              edge; PEP)  ──▶ sketchy  (anchor NOT accepted → BLOCKED, 0 tools)
```

## Run it

1. Build: `npm run build -w @letsfederate/waypoint`
2. Write a config (`waypoint.json`):

```json
{
  "downstreams": [
    { "name": "fedmgr", "command": "node",
      "args": ["/abs/path/packages/fedmgr-mcp/dist/bin.js"],
      "env": { "NODE_ENV": "development" },
      "entityId": "https://trust.letsfederate.org/mcp/fedmgr-mcp",
      "trustAnchor": "https://trust.letsfederate.org" }
  ],
  "policy": { "acceptedAnchors": ["https://trust.letsfederate.org"] }
}
```

3. Point Claude Code at waypoint (not the individual MCPs):

```bash
WAYPOINT_CONFIG=$(pwd)/waypoint.json \
  claude mcp add trusted -- node "$(pwd)/packages/waypoint/dist/bin.js"
# /mcp → "trusted" exposes only tools from downstreams that pass the policy
```

Change `acceptedAnchors` and the same downstream flips from exposed to blocked —
that is the gate.

## Run it remotely (cloud / web — HTTP + OAuth edge)

For cloud assistants (Claude.ai, OpenAI) that connect to a **remote** MCP, run waypoint
over **Streamable HTTP** behind an **OAuth edge** (the identity plane). Inbound is plain
OAuth/OIDC — sign in with your IdP (GitHub/Google/Okta/Entra); it is **not** OpenID
Federation. Downstream, waypoint is still OIDF.

```bash
npm run build -w @letsfederate/waypoint
WAYPOINT_CONFIG=$(pwd)/waypoint.json \
WAYPOINT_OIDC_ISSUER=https://accounts.google.com \
WAYPOINT_OIDC_AUDIENCE=https://waypoint.example \
WAYPOINT_OIDC_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs \
WAYPOINT_HTTP_PORT=8077 \
  node packages/waypoint/dist/bin-http.js
```

- `GET /health` — open (probes/load balancers).
- `POST|GET|DELETE /mcp` — the MCP endpoint; **requires a valid `Authorization: Bearer <token>`**
  (verified for issuer/audience/signature/expiry against the IdP JWKS). No/invalid token → `401`,
  fail-closed. Each session gets its own transport sharing the one waypoint.

A cloud assistant adds this URL as a remote MCP connector with OAuth; waypoint enforces trust
on every downstream regardless of whether the client understands our extension.

## How trust is decided (and an honest constraint)

The MCP SDK **client strips unknown `extensions`** from a server's advertised
capabilities, so a multiplexer can't read a downstream's in-band `oidf-trust`
advertisement via the standard client. Waypoint therefore decides trust from
**operator config + the accepted-anchor policy** (`evaluateOidfTrust`, reused from
`@letsfederate/fedmgr-mcp`) — config-declared identity the operator vets, which is
more trustworthy than an unauthenticated handshake hint anyway.

**Cryptographic admission** (`policy.requireValidChain: true`): in addition to the
config gate, each downstream's OIDF trust chain must cryptographically resolve to
its `trustAnchorUrl` as **VALID** (via `validateTrustChain` from `@letsfederate/kms`).
A `WARN`/`INVALID`/unreachable/no-validator result is a denial — fail-closed. Add a
reachable anchor to each downstream:

```json
{ "name": "x", "command": "node", "args": ["..."],
  "entityId": "https://…/x", "trustAnchor": "https://trust.letsfederate.org",
  "trustAnchorUrl": "https://trust.letsfederate.org" }
```

Proven against the live lab: a downstream whose declared identity chains to the TA is
admitted (tools exposed); one that doesn't is denied and never connected — even though
the accepted-anchor config would have accepted it. See
[`docs/evidence/phase-6.4-waypoint-crypto-admission.md`](../../docs/evidence/phase-6.4-waypoint-crypto-admission.md).

**Fail-closed everywhere:** a downstream that fails the policy or chain, is malformed,
or can't be reached is never connected and its tools are never exposed; a call to an
unknown/untrusted tool throws.

**Still ahead:** continuous revocation re-checks (live `/trust-mark-status`) and the
E9 catalogue feeding the config. See
[docs/proposed-workplan.md](../../docs/proposed-workplan.md), Phase 6.4.
