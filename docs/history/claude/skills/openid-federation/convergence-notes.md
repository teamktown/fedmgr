# FedMgr OpenID Federation + MCP convergence notes

Use this note when an LLM agent is modifying trust-backplane code.

## Preferred edit locations

- KMS/signing providers: `packages/kms/src/providers/*`.
- OIDF entity/subordinate statement semantics: `packages/ta-server/src/federation/*`.
- MCP provisioning and invocation-audience checks: `packages/fedmgr-mcp/src/openid-ops.ts`.
- MCP tool exposure: `packages/fedmgr-mcp/src/index.ts`.
- Operator walkthroughs: `docs/walkthroughs/openid-ops-mcp-mvp.md`.

## Do not reintroduce

- A parallel CommonJS `src/openid-ops` library.
- Production signing providers that return private keys to callers.
- Endpoint authorization grants inside canonical OpenID Federation entity statements.

## Spec anchors

- Entity statements: self-signed JWTs at `/.well-known/openid-federation`.
- Subordinate statements: superior-signed JWTs from `/federation_fetch?sub=`.
- Trust marks: TMI-issued JWT/JWS values and TA trust-mark-status checks.
- MCP invocation authorization: a fedmgr runtime layer using JWT `aud` after OIDF trust validation.
