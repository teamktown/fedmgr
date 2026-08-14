# Walkthrough — `validate_mcp_invocation` (admission verdict over MCP)

**Audience:** a developer new to OpenID Federation, lightly comfortable with crypto.
**Goal:** understand what this tool decides, the four signed inputs it needs, and how
to read its verdict.

## The one-sentence idea

When something wants to *call* an MCP server, this tool answers a single question —
**"is this call allowed?"** — and it answers **fail-closed**: anything missing, expired,
tampered, or unproven ⇒ **DENIED**.

## The four inputs (all are signed JWTs)

A **JWT** is a base64url-encoded token; a **JWS** is a JWT with a cryptographic
signature (RFC 7515 / RFC 7519). You verify a JWS with the signer's **public key**,
published as a **JWKS** (a JSON list of public keys, RFC 7517). Nothing here needs a
private key — verification is public-key only.

| Input | Plain-English meaning | OIDF term |
|---|---|---|
| `subordinate_statement` | "The Trust Anchor vouches for this MCP's keys + metadata." | Subordinate Statement |
| `entity_statement` | "The MCP describes itself, signed by its own key." | Entity Statement (self-signed) |
| `invocation_token` | "This call is authorized for endpoints X, Y and carries trust mark Z." | (runtime authZ JWT) |
| `endpoint` | the MCP endpoint actually being called | — |

The Trust Anchor's public keys (`trust_anchor_jwks`, or fetched from
`<ta_url>/.well-known/jwks.json`) verify the signatures.

## The five checks (all must pass)

```
✓ subordinateSignatureValid   the Trust Anchor really signed the subordinate statement
✓ entitySelfStatementValid    the MCP really signed its own entity statement
✓ invocationSignatureValid    the issuer really signed the invocation token
✓ invocationAudienceValid     the endpoint is listed in the token's `aud`
✓ requiredTrustMarkPresent    the required mark is in the token's `trust_marks` claim
```

**Why the trust mark must be in the *token* (not just the metadata):** the relying
party enforces what the caller actually *presents*. A token with no mark must be
denied even if the Trust Anchor's records say the MCP is entitled to one. (OIDF
§"Trust Marks".) This is the rule the tool exists to prove.

## Try it

In the demo lab the canonical Trust Anchor identity is **`https://trust.letsfederate.org`**
(its reachable lab URL defaults to `http://localhost:8090` — identity and location are
deliberately separate; OIDF §"Entity Identifiers").

Call the MCP tool `validate_mcp_invocation` with the four signed inputs (plus an inline
`trust_anchor_jwks` or a `ta_url`). You get:

```
[TRUST:VALID] MCP invocation ALLOWED for endpoint https://mcp.local/mcp-1
Checks:
  ✓ subordinateSignatureValid
  ✓ entitySelfStatementValid
  ✓ invocationSignatureValid
  ✓ invocationAudienceValid
  ✓ requiredTrustMarkPresent
```

…or, e.g. for a token missing the mark:

```
[TRUST:FAIL] MCP invocation DENIED for endpoint https://mcp.local/mcp-1
Checks:
  ...
  ✗ requiredTrustMarkPresent
```

A **DENIED** verdict is the system working — it is logged at `WARN`, not `ERROR`.

## Observability

Logs are structured JSON on **stderr** (stdout is reserved for the MCP protocol),
at levels `trace|debug|info|warn|error` via `FEDMGR_LOG_LEVEL` (default `info`). Each
tool call runs inside an OpenTelemetry span; set `OTEL_EXPORTER_OTLP_ENDPOINT` (and
install `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`) to
export traces — otherwise tracing is a zero-config no-op.

## References

- OpenID Federation 1.1 — https://openid.net/specs/openid-federation-1_1.html
- JWS RFC 7515 · JWT RFC 7519 · JWK/JWKS RFC 7517
- Verdict logic + tests: `packages/fedmgr-mcp/src/openid-ops.ts` (`validateMcpInvocation`),
  `test/validate-mcp-invocation.test.mjs`; tool tests: `test/validate-mcp-invocation-tool.test.mjs`.
- Evidence of test runs: `docs/history/evidence/phase-6.0-test-evidence.md`.
