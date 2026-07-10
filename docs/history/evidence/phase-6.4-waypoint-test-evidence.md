# Phase 6.4 — Waypoint (trust multiplexer) test evidence

Run date 2026-06-12. Node v22.22.3. Raw output.

## Waypoint suite (policy + mux-with-fake-connector + REAL fedmgr-mcp integration)
```
ok 1 - REAL: admits fedmgr-mcp under an accepted anchor; exposes its tools namespaced
ok 2 - REAL: denies fedmgr-mcp under a non-accepted anchor; exposes nothing, never connects
ok 3 - exposes only admitted downstreams' tools, namespaced
ok 4 - routes a tool call to the right downstream with the un-namespaced name
ok 5 - fail-closed: unknown or untrusted tool throws
ok 6 - a downstream that fails to connect is skipped; others still work
ok 7 - admits a downstream whose anchor is accepted
ok 8 - denies a downstream whose anchor is NOT accepted (E5 accepted-anchor)
ok 9 - denies when a required trust mark is not asserted
ok 10 - fail-closed on a malformed (non-https) entity id
# tests 10
# pass 10
# fail 0
```

## End-to-end: the waypoint MCP server (what Claude Code launches)

Same downstream (real fedmgr-mcp), two policies, via `node dist/bin.js`:
```
ALLOW policy (acceptedAnchors=[https://trust.letsfederate.org]):
  tools: 12 | has fedmgr__validate_mcp_invocation: true
DENY  policy (acceptedAnchors=[https://someone-else.example]):
  tools: 0  | has fedmgr__validate_mcp_invocation: false
```

## Design finding (not glossed)

The MCP SDK **client strips unknown `extensions`** from a downstream's advertised
capabilities (`getServerCapabilities()` returned only `resources`,`tools`). So a
multiplexer cannot read the in-band `oidf-trust` hint via the standard client.
Waypoint therefore sources trust from OPERATOR CONFIG + the accepted-anchor policy
(more robust than an unauthenticated handshake hint). Cryptographic chain/trustmark
verification (check_trust_chain / validate_mcp_invocation) is the next layer.
