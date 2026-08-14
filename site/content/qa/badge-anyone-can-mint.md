---
question: Why isn't a trust mark just a badge anyone can mint?
arc: bring-your-own-trust
audience: [local-dev, enterprise, operator]
tags: [trustmark, verification, oidf, security]
---
A badge you can mint yourself is worthless — the whole point of a trust mark is that a verifier can
tie it back to an authority it already trusts. In OpenID Federation a trust mark is a signed JWT, and
verifying it correctly means three things: resolve the mark's **issuer** through a verified trust
chain to your configured trust anchor, verify the mark's signature with the issuer's **federation
keys from that chain** (never a key the presenter chose), and confirm the anchor actually authorizes
that issuer to mint that type of mark (its `trust_mark_issuers` claim).

Get any of those wrong and you have a badge, not trust. The subtle failure mode is verifying the
signature against a key named *in the mark itself* (a `jku` header the presenter controls) — that
proves only "someone signed this with a key they also handed me," which is no proof at all. A correct
verifier rejects a self-signed mark whose issuer has no chain to the anchor. That rejection — showing
a plausible-looking trust mark being denied because it doesn't chain — is the clearest demonstration
of what "bring your own trust" actually buys you.
