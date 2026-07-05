---
question: How does a trust chain get verified, hop by hop?
arc: deploy-oidf-with-ai
audience: [local-dev, operator]
tags: [oidf, chain, section-10, verification, keys]
---
Verification walks from a leaf up to an anchor, checking a cryptographic binding at every hop — this is
OpenID Federation's §10 chain-validation algorithm:

1. **Start at the leaf.** Fetch the tool server's entity configuration (a signed JWT at
   `/.well-known/openid-federation`). Verify its self-signature with the keys it publishes, and check
   `iss == sub`, the `typ` header, and expiry.
2. **Climb via `authority_hints`.** Fetch the superior's **subordinate statement** about the leaf. The
   critical binding: the leaf's signing key must appear in the `jwks` of that subordinate statement.
   This is what ties "the leaf signed for itself" to "its superior vouches for that exact key."
3. **Verify each superior the same way**, checking `iss`/`sub`/`typ`/`exp` at every level.
4. **Terminate at a trust anchor you pinned out of band.** The anchor's public key must come from your
   configuration, not from the network — otherwise a compromised URL could serve its own "anchor."

If every hop's signature and key-binding holds and the chain ends at your pinned anchor, the leaf is
trusted. If any binding is missing — a leaf key the superior never vouched for, an expired statement,
a substituted key — verification fails closed. Showing exactly which key verified which statement, and
why a broken binding is rejected, is how "verify, don't assume" becomes something you can watch happen.
