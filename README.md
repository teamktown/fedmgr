# fedctl# 🛰️ fedmgr – Federated Identity Orchestrator

`fedmgr` is a developer tool and orchestration engine for building, managing, and testing **identity federations** across **MCP servers**, **OIDC providers**, and **trust anchors**.

It enables you to:

- Bootstrap trust anchors
- Mint and manage federation metadata
- Spin up multiple federated MCPs dynamically
- Visualize trust relationships in real-time
- Simulate cross-federation identity flows
- Inspect telemetry of token validation and request activity

Inspired by tools like `kubectl`, `vault`, and `terraform`, `fedmgr` provides a modern CLI + UI interface for federated identity experimentation and trust zone simulation.

---

## 🧰 Core Commands

You can use `fedmgr` through NPX without installing it globally:

```bash
# Using NPX (recommended)
npx @letsfederate/fedmgr create fed <federation-name>    # Bootstrap a new trust anchor and federation
npx @letsfederate/fedmgr create mcp <name>               # Spawn a new MCP instance and register with a federation
npx @letsfederate/fedmgr list entities                   # List all federated entities
npx @letsfederate/fedmgr visualize                       # Show trust graph and entity telemetry
npx @letsfederate/fedmgr call <mcp> --token <jwt>        # Simulate a call to an MCP with an OIDC token
```

This approach:
- Avoids global installation
- Prevents version conflicts
- Ensures you're always using the latest version

🧠 Architecture Overview

```mermaid

graph TD
  subgraph Federation
    Anchor[Trust Anchor]
    FedAdmin[Federation Admin MCP]
  end

  subgraph ExternalOP
    OP[OIDC Provider]
  end

  Anchor --> FedAdmin
  FedAdmin --> MCP1[MCP-A1]
  FedAdmin --> MCP2[MCP-A2]
  OP -->|JWT| FedAdmin
  OP -->|JWT| MCP1
  OP -->|JWT| MCP2

  style Anchor fill:#f9f,stroke:#333,stroke-width:2px
  style FedAdmin fill:#bbf,stroke:#222
  style MCP1 fill:#bfb,stroke:#222
  style MCP2 fill:#bfb,stroke:#222
```
Each MCP can:

Validate tokens issued by trusted OIDC OPs

Confirm that the issuer is part of a known federation via metadata chaining

Emit structured telemetry to the fedmgr dashboard

🗂️ Project Structure
```bash
fedmgr/
├── /src          → All source code (CLI + services)
│   ├── cli/      → Command handlers and core `fedmgr` logic
│   ├── server/   → MCP & Federation Admin microservices
│   └── web/      → Visualization interface (D3.js UI)
├── /public       → Static assets (favicon, fonts, etc.)
├── /docs         → Markdown specs, API contracts, trust formats
├── /scripts      → Startup scripts, bootstrap helpers
├── /test         → Unit + integration tests
├── /plans        → Planning and design (markdown directives)
│   ├── federation.md
│   ├── mcp-behavior.md
│   └── telemetry.md
└── README.md
```

📍 Status
-  Federation Admin server scaffolding
-  MCP telemetry via WebSocket
- Dynamic trust validation logic
- Visualization canvas via D3.js
- democtl commands for local orchestration

🔮 Future Enhancements
- Proxy OP support (Google/Azure → local federation)
 - Federation replay/simulation scripting
 - Multi-tenant sandboxing
-  JWE encryption + assurance tagging

## 🛠️ Requirements
- Node.js ≥ v18
- VSCode (for full developer UX)
- mkcert (optional, if using TLS locally)

## 📚 Documentation

### Core Documentation
- [Quickstart Guide](docs/quickstart.md) - Get started with fedmgr
- [Federation Manager Quickstart](docs/fedmgr-quickstart.md) - Detailed guide for using the fedmgr CLI
- [NPX Usage Guide](docs/npx-usage-guide.md) - How to use fedmgr with NPX
- [Architecture Overview (April 2025)](docs/architecture-april2025.md) - System architecture and components
- [Certificate Handling](docs/certificate-handling.md) - How certificates are managed in the federation

### Specifications
- [Federation Manager Specification](docs/specs/fedmgr-spec.md) - Detailed specification for the fedmgr component
- [MCP Core Specification](docs/specs/mcp-core-spec.md) - Specification for the MCP core component
- [NPX Improvement Specification](docs/specs/improvement-add-npx.md) - Specification for NPX capabilities

### Examples and Testing
- [Example Test Run](docs/example-01-testrun.md) - Example of a test run
- [Testing Documentation](docs/testing.md) - How to test the system
