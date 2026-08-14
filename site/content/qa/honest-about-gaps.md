---
question: What is fedmgr honest about NOT doing yet?
arc: deploy-oidf-with-ai
audience: [local-dev, enterprise, operator]
tags: [roadmap, honesty, limitations, verification, trust]
---
A trust project that hides its gaps is the opposite of trustworthy, so here is the honest edge. fedmgr
today is a strong trust **surface** with a still-maturing trust **verification** layer. Concretely, as
of mid-2026:

- The federation documents are spec-shaped (signed entity configurations, fetch/list endpoints), but
  full OpenID Federation §10 chain validation — leaf-key binding, out-of-band anchor pinning,
  strict `iss`/`sub`/`typ` checks — is being hardened.
- Trust-mark verification is moving from a presenter-supplied key to chain-resolved issuer keys plus a
  `trust_mark_issuers` authorization check.
- The zero-HIGH/CRITICAL supply-chain SLA is defined and scanned, and the work in progress is making it
  a hard gate on issuance rather than an advisory log.
- Revocation is recorded, and the verifier that consults revocation status on every check is on the
  near roadmap.

None of this is hidden — the roadmap and the advocacy backlog are the same list, and each fix ships as
a demonstration on this site. "We verify our own claims, including the ones that aren't done yet" is the
posture; independent, reproducible checks are how you hold us to it.
