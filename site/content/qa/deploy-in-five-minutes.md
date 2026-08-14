---
question: What does deploying OpenID Federation for MCP actually look like?
arc: deploy-oidf-with-ai
audience: [local-dev, operator]
tags: [init, waypoint, lab, quickstart, demo]
---
The end-to-end loop is small enough to run on one machine and watch:

1. **Mint your ecosystem.** `fedmgr init` stands up a local trust anchor (TA), a trust-mark issuer
   (TMI), and a registry, minting a local CA and signing fedmgr's own SBOM along the way.
2. **Enroll a tool server as a leaf.** The MCP server proves possession of its key to the TA
   (proof-of-key enrollment) and becomes a resolvable entity in the federation.
3. **Issue it a trust mark** bound to the artifact you're running (its image digest), gated on a clean
   supply-chain scan.
4. **Put waypoint in front.** Waypoint is the MCP gateway: it admits a downstream tool server only if
   the server chains to your anchor and carries the required trust mark. Your AI assistant connects to
   waypoint over authenticated HTTP.
5. **Revoke and watch it flip.** Revoke the mark at the TA; waypoint's admission for that server flips
   to DENIED.

That single loop — enroll → issue → admit → revoke → deny — is the whole thesis made concrete. The best
version runs it as an automated test so the claim stays true over time rather than as a one-time demo.
