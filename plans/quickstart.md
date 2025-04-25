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
│   └── testdrivedev.md               # Test-driven dev scaffolding
└── quickstart.md              # ← You Are Here
```

---

## ✅ Phase 1: Tests First (TESTS.md)

Before implementing functionality, define the following tests:

### 🔹 Environment prepared
- [ ] hostnames for all endpoints ping 

### 🔹 Federation Bootstrap
- [ ] Can generate a Trust Anchor keypair
- [ ] Trust Anchor exposes JWKS and metadata at `.well-known/openid-federation`

### 🔹 OIDC OP Configuration
- [ ] Generates entity configuration with correct issuer and trust anchors
- [ ] Sphereon OP boots and exposes `/.well-known/openid-federation` and `/.well-known/openid-configuration`
- [ ] JWTs are minted for user login with expected claims

### 🔹 MCP Verification
- [ ] MCP instance accepts JWT from OP in Authorization header
- [ ] MCP validates OP issuer against its trust anchor list
- [ ] MCP rejects JWTs from untrusted issuers

### 🔹 Access Enforcement
- [ ] mcp-imperialshuttle.example.org returns `401 Unauthorized` if JWT is missing, expired, or untrusted — this is expected and considered a passing test for security enforcement

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
- `fedmgr create fed <name>` → generates trust anchor
- `fedmgr create op <name>` → adds OP to fed and starts service
- `fedmgr create mcp <name>` → adds an MCP, joins the federation
- `fedmgr help` → emits federation connection info for each component, suitable for integration into client or agent tooling

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

### Step 7: MCP Core Functionality (for VSCode Agent)
- All MCPs must implement the following core API endpoints:
  - `GET /whoami` – returns decoded JWT claims for the current session
  - `GET /showtrust` – returns current trust anchors and chains recognized
  - `GET /stats` – returns usage stats by function (e.g., call counts per route)
  - `GET /status` – returns overall MCP service health and federation sync state

These endpoints provide inspection and introspection capabilities for use in integrated tools such as Copilot agents.

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


Tests should result in a valid JWT flow:
- 🟢 User logs in via Sphereon OP
- 🟢 JWT issued
- 🟢 MCP verifies JWT and grants access
- 🟢 UI shows federated nodes and live log updates
- 🟢 Unauthorized request to MCP (no/invalid JWT) fails with `401`

---

## 🔚 Outcome
By the end of this flow:
- You have a running federated trust fabric
- JWTs are issued and validated in a multi-MCP topology
- Visualization and logging is real-time
- System is test-driven and modular
- MCP libraries can be published to the NPM registry for consumption
- Each MCP can be inspected by tooling like GitHub Copilot agents
- Access controls are enforced reliably for federated endpoints

---

## 🧹 Final Step: Federation Teardown

Use the CLI to dismantle the federation environment:
```bash
fedmgr delete fed <fed_name>
```
This will:
- Remove trust anchor keys and metadata
- Deregister all connected OPs and MCPs
- Clean up Docker resources (use `docker-compose down`)
- Reset visualizer state
- Rotate and unassociate existing MCPs from the federation (invalidate their certificates)
- Allow new federation enrollment with newly minted credentials

Use this to reset between test runs or after each demo cycle.

