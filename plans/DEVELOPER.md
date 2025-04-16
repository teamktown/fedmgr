# 🧑‍💻 Developer Onboarding – fedmgr Project

Welcome to the **fedmgr** project! This document captures the goals, architecture, and relevant specifications for developers contributing to the CLI tool and orchestration layer for federated identity using OIDC, OpenID Federation, and simulated MCP servers.

---

## 🎯 Project Goals

`fedmgr` is a CLI and orchestration tool that:

- Bootstraps federated trust environments with OpenID Federation 1.0
- Spins up and manages **Master Control Program (MCP)** servers that act as identity consumers
- Creates **Trust Anchors** and **Entity Statements**
- Simulates federated token validation, including telemetry
- Supports a web-based **chat UI** and **D3.js visualization** of trust graphs
- Is designed for demos, reproducible documentation, and research experimentation

---

## 📦 Project Structure

```
fedmgr/
├── /src          → All source code (CLI, services, UI)
│   ├── cli/      → `fedmgr` command implementations
│   ├── server/   → MCP + Federation Admin server logic
│   └── web/      → Web chat interface + graph visualization (D3.js)
├── /public       → Static assets (e.g., index.html, favicon)
├── /docs         → Project documentation and specifications
├── /scripts      → Startup helpers (e.g. federation bootstrap, entity registration)
├── /test         → Test cases for CLI and server modules
├── /plans        → Markdown planning files (e.g. federation.md, telemetry.md)
└── README.md     → High-level project overview
```

---

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

---

## 🧪 Key CLI Use Cases

```bash
fedmgr create fed alpha             # Bootstrap trust anchor "alpha"
fedmgr create mcp MCPA             # Start a new MCP (MCPA), register to fed 'alpha'
fedmgr list entities               # Show registered federated entities
fedmgr visualize                   # Launch webapp with D3.js trust graph
fedmgr call MCPA --token <jwt>     # Simulate OIDC-authenticated call to MCPA
```

---

## 🌐 Web Interface

- Built with Express + WebSockets
- Telemetry stream for each MCP via `/ws/telemetry`
- Syslog-style log window below D3.js trust graph
- D3.js renders:
  - MCPs
  - Federation Anchors
  - OIDC OPs
  - Trust links and graph edges

---

## ✅ Current Status

- [x] Federation Admin MCP with metadata endpoint
- [x] MCP Server framework with JWT validation and telemetry
- [x] WebSocket telemetry channels per MCP
- [ ] CLI-based `democtl` command framework (in progress)
- [ ] Dynamic D3.js trust graph (in progress)
- [ ] Token flow simulation with trust validation (in progress)

---

## 🔒 Deferred Feature (Backlog)

**OIDC OP Proxying:**
- The idea of letting the local OIDC OP act as a broker (receiving ID Tokens from Azure/Google and minting local JWTs into the federation) is deferred for now.
- This would require upstream client registration, token validation, and sub remapping.
- Notes available, but not part of initial product requirements.

---

## 🔗 References

- OpenID Connect Core 1.0 – https://openid.net/specs/openid-connect-core-1_0.html
- OAuth 2.0 Framework – https://tools.ietf.org/html/rfc6749
- OpenID Federation 1.0 – https://openid.net/specs/openid-federation-1_0.html
- JSON Web Token (JWT) – https://datatracker.ietf.org/doc/html/rfc7519
- D3.js Library – https://d3js.org/

---

## 📥 Getting Started

- Clone the repo
- `npm install`
- Run `scripts/bootstrap-fed.sh` or `scripts/start-dev.sh` to initialize a federation and launch example MCP servers
- Visit `http://localhost:3000` to access the web UI

> For any questions, refer to `/plans` and `/docs` or ping the `fedmgr` core team.

