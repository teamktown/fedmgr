# fedmgr documentation

Start here. The durable reference lives at the top level; process journals
from past development phases are preserved under [`history/`](history/).

## Using the system

| Doc | What it covers |
|---|---|
| [trust-guide.md](trust-guide.md) | Standing up a trust circle: TA/TMI keys, enrollment, issuing trustmarks |
| [walkthroughs/trust-lab-quickstart.md](walkthroughs/trust-lab-quickstart.md) | The local lab (`./deploy/lab/up.sh`): registry + TA + TMI in one command |
| [walkthroughs/openid-ops-mcp-mvp.md](walkthroughs/openid-ops-mcp-mvp.md) | Driving federation operations through the MCP tools |
| [walkthroughs/validate-mcp-invocation.md](walkthroughs/validate-mcp-invocation.md) | Validating an MCP server before invoking it |
| [extending-trustmarks.md](extending-trustmarks.md) | Adding a new trustmark type end to end |
| [signing.md](signing.md) | Key handling, signing, and CI secrets |
| [security-faq.md](security-faq.md) | Threat-model questions and answers |
| [operations-faq.md](operations-faq.md) | **When something breaks** — symptom → cause → prevention, from real incidents |
| [dify-knowledge-assistant.md](dify-knowledge-assistant.md) | Build a Dify RAG chat flow over these docs (model, settings, prompt) |

## Understanding the design

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | System overview and repo layout |
| [architecture/trust-fabric-architecture.md](architecture/trust-fabric-architecture.md) | The trust fabric end-state design |
| [specs/openid-federation-trust-backplane-mvp.md](specs/openid-federation-trust-backplane-mvp.md) | The MVP spec |
| [adr/](adr/) | Architecture decision records |
| [decisions.md](decisions.md) | Running log of smaller decisions |
| [fedvec-vector-search.md](fedvec-vector-search.md) | Federation vector search (fedvec) |

## Developing

| Doc | What it covers |
|---|---|
| [dev/gotchas.md](dev/gotchas.md) | **Read first** — hard-won guards (Docker ≠ host build, npm 11, RVF, SSC) |
| [dev/running.md](dev/running.md) | Build / test / run commands |
| [dev/branching.md](dev/branching.md) | **Before your first PR** — semantic branches, main protection, merge=release |
| [dev/trust-verification.md](dev/trust-verification.md) | The single §10 verifier and signer pinning |
| [dev-guide.md](dev-guide.md) | Contributor guide |
| [testing.md](testing.md) | Test layout and how to run suites |
| [proposed-workplan.md](proposed-workplan.md) | Longer-horizon workplan |

## History

[`history/`](history/) holds process journals — phase evidence
(`history/evidence/`), the ralph-loop increments (`history/ralph-loop/`), and
earlier assistant skill notes (`history/claude/`). They record how the system
got here; nothing in them is needed to use or develop it. `analysis/` holds
the HTML proto-site.
