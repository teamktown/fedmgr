# Phase 6.0 — test evidence (validate_mcp_invocation MCP tool)

Run date: 2026-06-12 (UTC). Branch: codex/refactor-docker-compose-for-trust-anchor-implementation
Node: v22.22.3. Command: `node --test test/*.test.mjs` in packages/fedmgr-mcp
These are raw, unedited runner outputs — not summaries.

## New tool tests — `test/validate-mcp-invocation-tool.test.mjs`

```
# {"level":"info","ts":"2026-06-12T00:26:46.200Z","service":"fedmgr-mcp","msg":"mcp invocation verdict","endpoint":"https://mcp.local/mcp-1","entityId":"https://fedmgr.local/mcp/mcp-1","trusted":true,"checks":{"subordinateSignatureValid":true,"entitySelfStatementValid":true,"invocationSignatureValid":true,"invocationAudienceValid":true,"requiredTrustMarkPresent":true}}
# Subtest: tool ALLOWS a valid ES256 invocation (inline JWKS, canonical TA id)
ok 1 - tool ALLOWS a valid ES256 invocation (inline JWKS, canonical TA id)
# {"level":"warn","ts":"2026-06-12T00:26:46.208Z","service":"fedmgr-mcp","msg":"mcp invocation verdict","endpoint":"https://mcp.local/mcp-1","entityId":"https://fedmgr.local/mcp/mcp-1","trusted":false,"checks":{"subordinateSignatureValid":true,"entitySelfStatementValid":true,"invocationSignatureValid":true,"invocationAudienceValid":true,"requiredTrustMarkPresent":false}}
# Subtest: tool DENIES when the required trust mark is absent from the invocation JWT
ok 2 - tool DENIES when the required trust mark is absent from the invocation JWT
# {"level":"warn","ts":"2026-06-12T00:26:46.212Z","service":"fedmgr-mcp","msg":"mcp invocation verdict","endpoint":"https://mcp.local/not-authorized","entityId":"https://fedmgr.local/mcp/mcp-1","trusted":false,"checks":{"subordinateSignatureValid":true,"entitySelfStatementValid":true,"invocationSignatureValid":true,"invocationAudienceValid":false,"requiredTrustMarkPresent":true}}
# Subtest: tool DENIES when the endpoint is not in the token aud
ok 3 - tool DENIES when the endpoint is not in the token aud
# Subtest: tool rejects a missing required argument (fail-closed at the boundary)
ok 4 - tool rejects a missing required argument (fail-closed at the boundary)
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 344.082669
```

## Full fedmgr-mcp suite (regression)

```
# tests 22
# pass 22
# fail 0
# skipped 0
# todo 0
```

## Telemetry smoke — structured stderr logs (FEDMGR_LOG_LEVEL=debug)

Confirms leveled JSON logging on stderr (stdout is the MCP protocol channel) and that a DENIED verdict logs at WARN, not ERROR:
```json
{"level":"debug","ts":"2026-06-12T00:26:12.118Z","service":"fedmgr-mcp","msg":"using inline trust_anchor_jwks"}
{"level":"info","ts":"...","service":"fedmgr-mcp","msg":"mcp invocation verdict","endpoint":"https://mcp.local/mcp-1","trusted":true,"checks":{"subordinateSignatureValid":true,"entitySelfStatementValid":true,"invocationSignatureValid":true,"invocationAudienceValid":true,"requiredTrustMarkPresent":true}}
```
