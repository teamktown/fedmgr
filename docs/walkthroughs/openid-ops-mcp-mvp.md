# OpenID Federation + MCP convergence walkthrough

This walkthrough describes the converged implementation after adopting the `feat/uplift-tdd` workspace foundation. It is written for both humans and LLM agents that need to locate the right code ontology before changing behavior.

## Code ontology

| Concept | Package / file | OpenID Federation mapping |
| --- | --- | --- |
| Signing provider | `packages/kms/src/index.ts` and `packages/kms/src/providers/openbao.ts` | Signs entity statements, subordinate statements, trust marks, and invocation JWTs without exposing private keys. |
| Trust Anchor | `services/ta-server/src/index.ts` | Serves `/.well-known/openid-federation`, `/.well-known/jwks.json`, `/federation_list`, `/federation_fetch`, and `/trust-mark-status`. |
| Entity statement | `services/ta-server/src/federation/entity-statements.ts` | Self-signed JWT where `iss == sub` and metadata/JWKS describe the entity. |
| Subordinate statement | `services/ta-server/src/federation/subordinate-statements.ts` | TA-signed JWT where `iss` is the TA and `sub` is the MCP/TMI/subordinate entity. |
| Trust mark status | `services/ta-server/src/federation/trust-mark-status.ts` | OIDF trust-mark-status endpoint semantics. |
| MCP operations | `packages/fedmgr-mcp/src/openid-ops.ts` | MCP-native provisioning and invocation-token checks layered on top of OIDF primitives. |
| MCP tool surface | `packages/fedmgr-mcp/src/index.ts` | Claude/MCP clients call tools such as `provision_mcp_trust_circle`, `check_trust_chain`, and `verify_trustmark`. |

## Layering rule

OpenID Federation statements establish **entity trust**. MCP invocation JWTs establish **runtime endpoint authorization**.

Do not put endpoint authorization grants in the canonical OIDF entity statement. Instead:

1. Put MCP server facts in `metadata.mcp_server`.
2. Use TA/TMI statements and trust marks to establish trust.
3. Use a separate invocation JWT whose `aud` enumerates discrete MCP endpoint URLs.
4. Have gateways, wrappers, or MCP clients validate both federation trust and invocation `aud` before connecting.

## OpenBao/Vault provider

OpenBao support now lives in `packages/kms/src/providers/openbao.ts` as a Transit-style provider:

- `OpenBaoTransitProvider` implements the workspace `KeyProvider` contract.
- `HttpOpenBaoTransitClient` calls OpenBao/Vault Transit APIs.
- `MemoryOpenBaoTransitClient` is the deterministic CI/dev test double.
- The provider exposes JWKS and signs JWTs; it does not return private key material.

Run the provider tests with:

```bash
npm run build -w @letsfederate/kms
npm test -w @letsfederate/kms -- --runInBand
```

## MCP trust-circle provisioning

`packages/fedmgr-mcp/src/openid-ops.ts` provides the reusable operations layer for MCP agents:

- `registerMcpEntity()` creates an MCP entity statement and TA subordinate statement using OIDF helpers.
- `issueMcpInvocationToken()` creates a runtime JWT with endpoint `aud` values.
- `provisionMcpTrustCircle()` provisions 1 TA with N MCP entities for local/dev workflows.
- `validateMcpInvocation()` checks TA signature, MCP self-statement signature, trust mark metadata, and endpoint audience.

The MCP server exposes this as the `provision_mcp_trust_circle` tool so Claude Code or any MCP harness can request a trust circle over MCP rather than bespoke JSON-RPC.

Run the MCP convergence tests with:

```bash
npm run build -w @letsfederate/fedmgr-mcp
npm test -w @letsfederate/fedmgr-mcp -- --runInBand
```

## Acceptance checks

Use the convergence script to exercise the OpenBao provider and MCP provisioning tests:

```bash
npm run test:convergence
```

Expected coverage of the convergence tests:

- OpenBao/Vault Transit-compatible signing has public JWKS and no private fields.
- OpenBao/Vault Transit aliases are resolved by `createProvider()`.
- MCP trust circles use OIDF entity/subordinate statement helpers.
- Invocation JWT `aud` allows authorized MCP endpoints and rejects non-enumerated endpoints.
