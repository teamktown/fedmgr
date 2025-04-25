# 👨‍💻 Developer Guide: `fedmgr`

This guide describes how to extend and maintain the federated trust framework, with a focus on modularity, test-driven development (TDD), and automation.

---

## 🧪 Tests First (TDD)

Define tests in `plans/TESTS.md` before implementation.

Examples:
- MCP accepts valid JWT
- MCP rejects unsigned or untrusted JWT (expected `401`)
- Federation trust anchors resolve properly
- `fedmgr` emits federation metadata via `fedmgr help`

Run tests:
```bash
npm run test

## 🧠 Core Concepts

- **OIDC (OpenID Connect)**: Used for identity authentication
- **OAuth 2.0**: Used for delegated authorization and token scopes
- **OpenID Federation 1.0** ([spec link](https://openid.net/specs/openid-federation-1_0.html)):
  - Enables trust establishment between OPs and RPs
  - Used to bootstrap federated circles of trust between MCPs
  - Uses signed metadata and trust chains via entity statements
- **MCP (Master Control Program)**:
  - A service that validates OIDC tokens using trust policies
  - Part of a simulated federated environment
```

---

## 🛠️ CLI Commands

```bash
fedmgr create fed <name>      # Bootstrap trust anchor
fedmgr create op <name>       # Register OP
fedmgr create mcp <name>      # Register MCP with JWKS and config
fedmgr help                   # Emit trust metadata for MCP integration
fedmgr delete fed <name>      # Destroy federation and rotate keys
```

---

## 📦 Build and Publish

To build and validate packages:
```bash
scripts/build-npm.sh
```

This:
- Runs lint + test (`npm run sanity`)
- Packs `.tgz` archives
- Optionally publishes to npm

---

## 🐳 Setup and Compose

Run `scripts/setup.sh` to:
- Generate `docker-compose.generated.yml`
- Bootstrap services with config
- Use mounted folders from `config/`

---

## 🔌 Agent/AI Tooling

MCPs support endpoints for VSCode/GitHub Copilot integration:
- `/whoami`: reveals active JWT user claims
- `/showtrust`: reveals loaded trust anchors
- `/stats`: displays usage metrics
- `/status`: service health and config sync
## 🔗 References

- OpenID Connect Core 1.0 – https://openid.net/specs/openid-connect-core-1_0.html
- OAuth 2.0 Framework – https://tools.ietf.org/html/rfc6749
- OpenID Federation 1.0 – https://openid.net/specs/openid-federation-1_0.html
- JSON Web Token (JWT) – https://datatracker.ietf.org/doc/html/rfc7519
- D3.js Library – https://d3js.org/
---

## 🚀 NPM Structure

- `@letsfederate/mcp-core` – Reusable server logic
- `@letsfederate/fedmgr` – CLI tools and config utilities

All are versioned and scoped to support modular use.

## 🌐 Web Interface

- Built with Express + WebSockets
- Telemetry stream for each MCP via `/ws/telemetry`
- Syslog-style log window below D3.js trust graph
- D3.js renders:
  - MCPs
  - Federation Anchors
  - OIDC OPs
  - Trust links and graph edges

