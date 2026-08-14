---
question: What does "bring your own trust" mean in practice?
arc: bring-your-own-trust
audience: [enterprise, operator]
tags: [trust-anchor, multi-anchor, governance, byot]
---
"Bring your own trust" means **you choose the anchors your AI stack will trust**, rather than
inheriting a single vendor's list. A verifier is configured with one or more trust anchors it accepts;
a tool server is admitted only if it chains to one of them. That configuration is yours to set.

In practice this supports layered trust: an enterprise can accept both its **own corporate anchor**
(for internally built and vetted MCP servers) and a **public letsfederate anchor** (for a baseline of
community-vetted servers), and set policy about which marks each must carry. A local developer can run
a single self-minted anchor on their laptop and trust only what they enrolled. No party is forced to
route trust through a gatekeeper — the anchor list is a local decision, which is exactly what keeps
one platform vendor from becoming a chokepoint for the whole ecosystem.

The important design consequence: trust marks must be **discoverable and verifiable from federation
documents alone**, so any verifier — yours, ours, or a third party's — reaches the same verdict from
the same evidence. Trust is a property of the chain, not of who is asking.
