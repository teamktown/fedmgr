---
question: Where do the trust anchor, issuer, and gateway actually run, and who runs them?
arc: bring-your-own-trust
audience: [enterprise, operator]
tags: [architecture, ta, tmi, waypoint, deployment, roles]
---
Four roles, and who runs each depends on your trust model:

- **Trust Anchor (TA)** — the root you pin. An enterprise runs its own; a community can share a
  public one (e.g. a letsfederate anchor). It holds the subordinate registry and answers "is this
  entity enrolled, and is its mark still valid?"
- **Trust-Mark Issuer (TMI)** — accredited by an anchor to mint marks (e.g. "passed the supply-chain
  gate"). Can be the same operator as the TA or a separate, specialized party.
- **MCP tool servers (leaves)** — the things doing work. Their operators enroll them as federation
  leaves so a verifier can resolve them.
- **Waypoint (the gateway)** — runs next to the AI assistant's trust boundary. It performs admission:
  chain-verify each downstream, check required marks, and only then expose its tools. Inbound to
  waypoint is OAuth/OIDC (identity — who is calling); downstream is OpenID Federation (trust — what to
  connect to).

A local developer collapses all four onto a laptop. An enterprise typically runs the TA + TMI +
waypoint centrally and lets teams enroll their MCP servers as leaves. A hosted service
(letsfederate.com, commercially) can run the anchor and issuer for those who'd rather not — while you
keep the right to add your own anchor to the list.
