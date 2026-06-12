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

## How trust is decided (and an honest constraint)

The MCP SDK **client strips unknown `extensions`** from a server's advertised
capabilities, so a multiplexer can't read a downstream's in-band `oidf-trust`
advertisement via the standard client. Waypoint therefore decides trust from
**operator config + the accepted-anchor policy** (`evaluateOidfTrust`, reused from
`@letsfederate/fedmgr-mcp`) — config-declared identity the operator vets, which is
more trustworthy than an unauthenticated handshake hint anyway.

**Fail-closed everywhere:** a downstream that fails the policy, is malformed, or
can't be reached is never connected and its tools are never exposed; a call to an
unknown/untrusted tool throws.

**Next layer:** full cryptographic admission — resolve each downstream's trust
chain to the anchor and verify its trust mark — plugs in via `check_trust_chain` /
`validate_mcp_invocation` (already built; needs the TA/TMI reachable). Continuous
revocation re-checks and the E9 catalogue feed this too. See
[docs/proposed-workplan.md](../../docs/proposed-workplan.md), Phase 6.4.
