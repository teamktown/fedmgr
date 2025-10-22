Below is a refreshed, detailed Product Requirements Document for the next “FedMgr Uplift” phase. It incorporates the Docker lifecycle, JSON-RPC2.0, UI separation, semantic versioning, conformance testing, and a strong Test-Driven Development focus.

---

## 1. Introduction

This PRD describes the precise work needed to move the current `@letsfederate/fedmgr` codebase from its existing state to a more modular, test-driven, defensively coded, and semantically versioned system that fully embodies the OpenID Federation 1.0 standard and the MCP JSON-RPC2.0 spec, all within a reproducible Docker workflow.

---

## 2. Objectives

1. **Spec Compliance**: Fully implement Trust Anchor, Federation Entity, and Relying Party profiles per OpenID Federation draft-43.
2. **Protocol Alignment**: Replace any gRPC proposals with JSON-RPC2.0 handlers for MCP calls.
3. **UI Decoupling**: Extract the embedded web UI into a standalone `fedmgr-ui` module following 12-factor app principles.
4. **Docker Lifecycle**: Define, document, and codify the exact Docker build–run–mount workflow.
5. **TDD & Defensive Coding**: Institute a strict Test-Driven Development process, defensive input validation, and conformance assertion tests.
6. **Conformance Pipeline**: Build an automated test pipeline that executes the OIDC Federation conformance suite, stores results per package version, and fails the build if regressions occur.
7. **Semantic Versioning**: Adopt a formal `MAJOR.MINOR.PATCH` release process, publish to npm, and maintain CHANGELOG.md.

---

## 3. Scope

* **In Scope**

  * CLI refactors (module splitting).
  * JSON-RPC2.0 server implementation for MCP commands.
  * New REST endpoints for federation management with admin guard.
  * Standalone UI module with its own repo/subfolder.
  * Docker Compose updates (build args, mounts, env).
  * Conformance test harness integration.
  * Semantic version bumping and npm packaging.
* **Out of Scope**

  * Full trust-mark issuance workflow (deferred).
  * Multi-admin user stores (single admin via ENV only).
  * Production secret-backend integration (placeholder for future).

---

## 4. Architecture Overview

```
┌──────────────┐         ┌────────────────────┐
│  fedmgr-cli  │──packages──> build/npm     │
└──────────────┘         └────────────────────┘
        │                         │
        ▼                         ▼
┌───────────────────┐      ┌──────────────────┐    ┌───────────────────┐
│ build/install/    │      │ docker-compose   │    │ fedmgr-admin      │
│   federations/    │↔volume│ federation-admin │↔HTTP│ JSON-RPC2.0 Server│
│   mcp_instances/  │      │ UI (fedmgr-ui)   │    └───────────────────┘
└───────────────────┘      └──────────────────┘            ▲
        ▲                          ▲                       │ JSON-RPC
        │                          │                       ▼
┌──────────────┐             ┌───────────────┐     ┌─────────────────┐
│  TDD Harness │<–artifacts–>│ Conformance   │     │ MCP JSON-RPC2.0 │
│ (Jest + CI)  │             │ Test Runner   │     │ Handler Library │
└──────────────┘             └───────────────┘     └─────────────────┘
```

---

## 5. Docker Compose Lifecycle

1. **Clone & Build**

   ```bash
   git clone …/fedmgr.git
   cd fedmgr
   npm install
   npm run build-npm             # builds .tgz packages into build/npm/
   ```
2. **Generate Entities & Keys (Host)**

   ```bash
   npx fedmgr create fed alpha    # outputs build/install/federations/alpha/
   npx fedmgr create op beta --federation alpha
   npx fedmgr create mcp client1 --federation alpha
   ```
3. **Start Containers**

   ```bash
   ./scripts/setup.sh             # sets up build/install directories
   docker-compose up --build      # uses Dockerfile.fedmgr, Dockerfile.mcp-core, etc.
   ```
4. **Mounts & ENV**

   * `FEDMGR_FEDERATIONS_DIR=./build/install/federations` → container `/usr/src/app/federations:ro`
   * `MCP_INSTANCES_DIR=./build/install/mcp_instances` → container `/app/mcp_instances:ro`
   * `FEDMGR_REGISTRY_DIR=./build/install/fed-reg` → `/usr/src/app/fed-reg:rw`
5. **Stop & Cleanup**

   ```bash
   docker-compose down
   rm -rf build/install         # reset environment
   ```

---

## 6. Module & UI Separation

* **Core** (`@letsfederate/fedmgr`)

  * `cli/` – only CLI parsing
  * `commands/` – create, list, delete, oauth, etc.
  * `lib/` – JSON-RPC2.0 server, federation routes, key-provider interface
  * `utils/` – defensive validators, file-ops, JWT signing/verification
* **UI** (`fedmgr-ui/`)

  * React or Vanilla JS single-page drawing on REST+JSON-RPC
  * Own `package.json`, build pipeline, deployable independently
  * Auth via JWT; token stored in localStorage
  * Configurable API endpoints via env (12-factor)

---

## 7. JSON-RPC2.0 Integration

* **Protocol**: Conform to [JSON-RPC2.0 spec](https://www.jsonrpc.org/specification)
* **Methods** (over WebSocket or HTTP POST):

  * `createFederation(name)` → returns `{ entityId, configPath }`
  * `createIntermediate(fed, name)`
  * `createMcp(fed, name)`
  * `listEntities(fed)`
  * `startMcp(name)` / `stopMcp(name)`
  * `getTrustChain(entityId)`
* **Error Handling**: Every method must return standard JSON-RPC error codes; implement defensive parameter checks using schema validators.

---

## 8. Test Strategy & Conformance Pipeline

1. **Unit Tests (Jest)**

   * All utility modules (key-provider, validators, JSON-RPC dispatcher) first.
   * Schema validations: enforce metadata shapes with ajv.
   * Trust chain verifier: multi-hop positive/negative tests.
2. **Integration Tests**

   * **CLI**: spawn `npx fedmgr …`, assert file outputs in `build/install`.
   * **REST & JSON-RPC**: hit endpoints, verify signed JWT responses and schema using JSON-RPC client.
   * **Dockerized End-to-End**: `docker-compose up`, run conformance tests against `localhost:3001` and `localhost:4001`.
3. **Conformance Harness**

   * Integrate official OpenID Federation conformance suite via Docker (or `curl` scripts).
   * **On each `npm version` event**, run the suite; store results under `build/conformance/<version>/`.
   * Fail CI on any regression.
4. **Persistent Artifacts**

   * Archival of JWT logs, test coverage, conformance reports in `build/`.
   * Exposed via CI artifacts (GitHub Actions).

---

## 9. Semantic Versioning & Release Process

* **Versioning**: Follow \[semver.org]

  * `MAJOR` – breaking changes (e.g. spec upgrade to draft-44)
  * `MINOR` – new features (JSON-RPC2.0, UI module)
  * `PATCH` – bug fixes, test improvements
* **Workflow**

  1. Branch off `main` (e.g. `release/v1.0.0-beta`).
  2. Implement features/tests.
  3. Bump version via `npm version <patch|minor|major>` (updates package.json, Git tag).
  4. CI runs TDD suite + conformance runner.
  5. On success, merge to `main`; CI publishes to npm.
  6. Update CHANGELOG.md with release notes.

---
## 10. TDD & Defensive Coding Practices
* Red-Green-Refactor: Write failing test first (unit or integration), implement minimal code, refactor.
* Input Validation: Use JSON Schema + ajv for all JSON-RPC params and REST bodies.
* Error Handling: Catch and wrap all async errors; return structured JSON-RPC errors or HTTP 4xx/5xx with consistent format.
* Immutable Config: Treat build/install outputs as immutable once written; modification only via CLI or API.

### Logging & Observability:
* Structured logs (JSON) for server actions (entity created, JWT signed).
* Correlate logs with conformance test runs (include version tag).

### Code Reviews & PR Checklist:

* New functionality MUST include tests.
* No core changes may be merged without passing conformance harness.
* All new endpoints require OpenAPI-style docs alongside implementation.
