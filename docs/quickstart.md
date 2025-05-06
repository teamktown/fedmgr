# 🚀 Quickstart Guide: `fedmgr` OIDCFederation + MCP Demo

This guide walks you through bootstrapping a trust environment using Sphereon's OIDC Federation OP, managing federated MCPs, and verifying the integration using tests. It also outlines future integration into VSCode Copilot agentic workflows.

---

## 📁 Project Setup Structure

```
fedmgr/
├── config/
│   └── oidc-op/               # JWKS and Entity Configuration
├── scripts/
│   ├── gen-keys.js            # Generates keys and config for trust anchor + OP
│   ├── setup.sh               # Generates docker-compose.yaml dynamically
│   └── build-npm.sh           # Prepares and publishes MCP libraries to NPM
├── src/cli/
│   └── create.js              # CLI logic for fed, mcp, and OP registration
├── public/
│   └── index.html             # Visualizer and telemetry
├── docker-compose.yml         # Main services (MCPs, Sphereon OP)
├── plans/
│   └── TESTS.md               # Test-driven dev scaffolding
└── quickstart.md              # ← You Are Here
```

---

## ✅ Phase 1: Tests First (TESTS.md)

Before implementing functionality, define the following tests:

### 🔹 Federation Bootstrap
- [ ] Can generate a Trust Anchor keypair
- [ ] Trust Anchor exposes JWKS and metadata at `.well-known/openid-federation`

### 🔹 OIDC OP Configuration
- [ ] Generates entity configuration with correct issuer and trust anchors
- [ ] Sphereon OP boots and exposes `/.well-known/openid-federation` and `/.well-known/openid-configuration`
- [ ] JWTs are minted for user login with expected claims

### 🔹 MCP Registration
- [ ] MCP instance accepts JWT from OP in Authorization header
- [ ] MCP validates OP issuer against its trust anchor list
- [ ] MCP rejects JWTs from untrusted issuers

### 🔹 Visualization
- [ ] UI shows correct federated entities (Trust Anchor, OP, MCPs)
- [ ] Tooltip shows issuer, trust mark, scopes

---

## 🛠 Phase 2: New Features

### Step 1: Generate Trust Anchor and OP Entity
- Use `scripts/gen-keys.js`
- Create:
  - `config/trust-anchor/jwks.json`
  - `config/trust-anchor/entity.json`
  - `config/oidc-op/entity.json`

### Step 2: Docker Compose Generation via setup.sh
- The `scripts/setup.sh` will:
  - Build a fresh `docker-compose.generated.yml`
  - Populate the MCPs and OP services using a template
  - Inject environment variables and config volumes

### Step 3: CLI Extension
- `npx @letsfederate/fedmgr create fed <name>` → generates trust anchor
- `npx @letsfederate/fedmgr create op <name>` → adds OP to fed and starts service
- `npx @letsfederate/fedmgr create mcp <name>` → adds an MCP, joins the federation

### Step 4: JWT Validation in MCPs
- Middleware verifies JWT:
  - Signature via `.well-known/jwks.json`
  - Issuer in federation trust chain
  - `aud`, `scope`, `trust_mark`, `acr`

### Step 5: Telemetry
- Each MCP emits validation logs over WebSocket
- UI updates terminal + graph in real time

### Step 6: MCP Library Publishing
- The `scripts/build-npm.sh` will:
  - Build the reusable MCP core logic as npm-compatible packages
  - Ensure version tagging and semantic release compliance
  - Push to NPM under scoped registry (e.g. `@letsfederate/mcp-<tier>`)

---

## 👩‍💻 Optional: VSCode Agent Integration (Exploratory)

### Idea:
- Register MCPs with GitHub Copilot agent (`copilot-agent.yaml`)
- On OIDC login, mint JWT and attach it in requests
- Agent performs calls with Authorization header

### Future Work:
- Define `authCallback()` to capture token
- Script agent-side plugins to attach token to each code request

---

## 🧪 Phase 3: Run Tests

Use a test runner like `vitest`, `ava`, or `jest`:
```bash
npm run test
```

Tests should result in a valid JWT flow:
- 🟢 User logs in via Sphereon OP
- 🟢 JWT issued
- 🟢 MCP verifies JWT and grants access
- 🟢 UI shows federated nodes and live log updates

---

## 🔚 Outcome
By the end of this flow:
- You have a running federated trust fabric
- JWTs are issued and validated in a multi-MCP topology
- Visualization and logging is real-time
- System is test-driven and modular
- MCP libraries can be published to the NPM registry for consumption

---

## 🧹 Final Step: Federation Teardown

Use the CLI to dismantle the federation environment:
```bash
npx @letsfederate/fedmgr delete fed <fed_name>
```
This will:
- Remove trust anchor keys and metadata
- Deregister all connected OPs and MCPs
- Clean up Docker resources (use `docker-compose down`)
- Reset visualizer state
- Rotate and unassociate existing MCPs from the federation (invalidate their certificates)
- Allow new federation enrollment with newly minted credentials

Use this to reset between test runs or after each demo cycle.
