# OpenID Federation Trust Backplane MVP

This note critiques and refines the current demo into a productizable trust backplane for MCP, OpenID Federation, and local gateway enforcement. It is intentionally scoped to an MVP that can serve hobbyist/pro-sumer users while keeping an enterprise upgrade path.

## Current demo assessment

The demo already has the right building blocks:

- A federation admin service that publishes signed OpenID Federation endpoints such as entity configuration, federation fetch, resolve, and trust-mark status.
- An MCP demo service that can be registered into the federation and can call the admin service for validation.
- CLI surface area for creating federations, MCP instances, and key material.
- A key-provider abstraction with filesystem defaults and placeholders for external secret stores.
- Docker Compose packaging that is small enough to run locally.

The older pattern is that those pieces are coupled at the container and filesystem level. Keys are mounted read-only into demo containers, entity registration is mostly file-backed, trust evaluation is endpoint-specific, and the library boundary is split across runnable demos rather than a small reusable OpenID Federation operations layer.

## Refined target architecture

Treat FedMgr as a trust backplane with four strata:

1. **OpenID Federation operations library**: a succinct npm package that owns entity statements, trust-anchor metadata, subordinate registration, trust-mark issuance/status, trust-chain resolution, and verification policy.
2. **Key and signing provider layer**: an interface for signing and JWKS publication that supports local files for development, OpenBao/Vault transit or KV for stronger deployments, and later cloud KMS/HSM backends.
3. **Management surfaces**: CLI, admin UI, and MCP management server should all call the same operations library rather than reimplementing federation logic.
4. **Trust enforcement gateway**: Claude Code, local MCP wrappers, Envoy, or Kong should call one trust-evaluation API before connecting to a target MCP endpoint.

```text
Claude Code / MCP client
        |
        v
Trust-aware MCP connector or local gateway
        |
        +--> FedMgr trust evaluation API
        |       +--> OpenID Federation chain resolution
        |       +--> trust-mark policy evaluation
        |       +--> revocation / status checks
        |
        v
Allowed MCP server endpoint
```

## Critique of the proposed approach

### What is strong

- **Gateway enforcement is the right user experience**. Users should not need every MCP client to implement federation logic directly; a connector or gateway can make trust decisions consistently.
- **OpenID Federation fits the problem**. Entity statements, trust anchors, and trust marks provide a standards-aligned way to express endpoint identity and policy.
- **OpenBao is a pragmatic local-to-enterprise bridge**. It can run as a sidecar for self-hosters and map conceptually to Vault/cloud KMS for enterprise.
- **A single trust model across CLI and MCP calls reduces drift**. The CLI, admin UI, MCP control plane, and gateways should all reach the same verdict for the same endpoint.

### Risks to constrain early

- **Do not mint a general-purpose CA before the trust model needs it**. For MCP endpoint trust, OpenID Federation signing keys and JWKS are the minimum viable primitive. X.509 CA issuance should be a separate optional transport/security module.
- **Do not make Claude Code the policy engine**. A plugin should be a thin client that asks FedMgr or a local gateway for an allow/deny/needs-consent verdict.
- **Avoid embedding private-key reads throughout route handlers**. Signing should go through a provider interface so filesystem keys, OpenBao, and future KMS backends are interchangeable.
- **Separate registration from admission**. Registering an MCP server issues or stores entity statements; admission to a client session requires fresh trust-chain and trust-mark evaluation.
- **Keep the pro-sumer path zero-friction**. Default filesystem keys and a local SQLite/file registry are acceptable for demos, but the public interfaces should not assume those storage choices.

## MVP library boundary

In the converged workspace, expose operations through `@letsfederate/fedmgr-mcp` plus shared OIDF helpers rather than a parallel CommonJS package. The operations surface should include these modules/functions:

| Module | Responsibility | MVP API shape |
| --- | --- | --- |
| `TrustAnchorService` | Create and publish trust-anchor entity configuration | `createTrustAnchor(input)`, `getEntityConfiguration(entityId)` |
| `McpRegistrationService` | Register MCP servers as subordinate federation entities | `registerMcpServer(input)`, `issueSubordinateStatement(entityId)` |
| `TrustMarkService` | Issue, list, revoke, and check trust marks | `issueTrustMark(input)`, `getTrustMarkStatus(id, sub)` |
| `TrustResolver` | Resolve and verify chains to configured anchors | `resolve(entityId, trustAnchor)`, `verifyTrustChain(chain, policy)` |
| `TrustDecisionService` | Produce gateway-friendly verdicts | `evaluateEndpoint({ url, requiredTrustMarks, trustAnchors })` |
| `SigningProvider` | Abstract signing, public JWKS, and key rotation | `signJwt(payload, options)`, `getJwks()`, `rotateKey()` |
| `RegistryProvider` | Abstract entity and trust-mark persistence | `putEntity`, `getEntity`, `listSubordinates`, `putTrustMark` |

The CLI, admin routes, MCP management endpoints, and gateway/plugin integrations should consume this package.

## Trust decision contract

Gateways and plugins should consume a stable verdict schema instead of raw implementation internals:

```json
{
  "target": "https://mcp.example.com",
  "decision": "allow",
  "reason": "trusted_anchor_and_required_marks_present",
  "trust_anchor": "https://fedmgr.local",
  "entity_id": "https://mcp.example.com",
  "required_trust_marks": ["https://fedmgr.local/trust-marks/mcp-basic"],
  "validated_trust_marks": ["https://fedmgr.local/trust-marks/mcp-basic"],
  "expires_at": 1767225600,
  "evidence": {
    "trust_chain_jwts": [],
    "resolved_metadata_hash": "sha256:..."
  }
}
```

Recommended decisions are `allow`, `deny`, `prompt`, and `unknown`. `prompt` lets pro-sumer flows ask for local consent when the chain is valid but trust marks are incomplete.

## Key management model

Use three provider tiers:

1. **Filesystem provider** for developer demos and single-user installs.
2. **OpenBao provider** for local/pro-sumer and small-team deployments. OpenBao can run as a Docker Compose profile or as an installed binary. Prefer transit signing when available; KV-backed PEM storage is acceptable for MVP compatibility.
3. **KMS/HSM provider** for enterprises that require managed rotation, audit logs, and policy separation.

Key guidance:

- Private keys should be referenced by `kid`/key handle, not by path, at higher layers.
- Entity statements should be signed through `SigningProvider`, never by route-local filesystem reads.
- JWKS publication should be provider-backed and cacheable.
- Rotation should support overlapping active keys so issued statements remain verifiable until expiry.
- CA issuance should be isolated as a future `CertificateAuthorityProvider`; do not mix TLS CA lifecycle with OpenID Federation entity-signing lifecycle.

## Docker Compose direction

The default demo should remain two services for ease of use. Add OpenBao as an opt-in profile so advanced users can test secret-backed key management without increasing the default path complexity:

```bash
docker compose --profile openbao up --build
```

When OpenBao is enabled in the converged workspace, fedmgr packages should receive `FEDMGR_KMS_PROVIDER=openbao-transit`, `OPENBAO_ADDR`, `OPENBAO_TOKEN`, `OPENBAO_TRANSIT_MOUNT`, and `OPENBAO_TRANSIT_KEY`. The provider contract maps to production Vault/OpenBao Transit or cloud KMS/HSM equivalents without returning private keys to callers.

## Gateway and Claude Code integration

Use a layered integration strategy:

1. **Local wrapper first**: a small MCP proxy/wrapper calls `TrustDecisionService.evaluateEndpoint` before opening a downstream MCP connection.
2. **Claude Code plugin second**: the plugin configures or invokes that wrapper, displays trust verdicts, and allows user prompts where policy permits.
3. **Envoy/Kong third**: enterprise deployments enforce the same trust decision through an external authorization filter/plugin and centralized policy.

The gateway should cache positive decisions only until the shortest of entity-statement expiry, trust-mark expiry, or policy TTL. Negative decisions can be cached briefly to avoid repeated network abuse, but must not hide fresh trust-mark issuance for long.

## MVP milestones

1. **Extract operations library**: move entity-statement signing, registration, resolve, trust-mark status, and token/trust validation into a shared npm package.
2. **Replace route-local private-key reads**: route handlers and CLI commands call `SigningProvider` and `RegistryProvider` abstractions.
3. **Implement OpenBao-compatible provider**: support environment-driven provider selection with filesystem fallback.
4. **Expose trust decision API**: add `/trust/evaluate` and a CLI command such as `fedmgr trust evaluate <url>`.
5. **Build MCP trust wrapper**: proxy stdio/http MCP invocations through a trust check before connection.
6. **Add policy profiles**: `personal`, `team`, and `enterprise` defaults that differ in prompting, required marks, and accepted anchors.
7. **Package Claude Code integration**: plugin or generated MCP config that routes MCP endpoints through the wrapper.
8. **Add Envoy/Kong adapter**: map the same verdict schema to external authorization decisions.

## Product packaging

- **Personal/pro-sumer**: npm install, local filesystem or OpenBao binary, prompt-capable gateway, one local trust anchor.
- **Team**: Docker Compose with OpenBao profile, shared federation admin UI, explicit trust-mark issuance workflows, audit logs.
- **Enterprise**: KMS/HSM-backed signing, HA registry, policy-as-code, Envoy/Kong enforcement, SIEM/audit export, and multiple anchors/trust-mark issuers.

The key product principle is that every tier uses the same trust backplane contract. The deployment substrate changes; the trust decision semantics do not.
