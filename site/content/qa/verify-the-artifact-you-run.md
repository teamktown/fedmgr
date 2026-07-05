---
question: How do I verify a trust mark is bound to the exact artifact I'm running?
arc: supply-chain-integrity
audience: [enterprise, operator]
tags: [digest, binding, cosign, in-toto, verify, provenance]
---
Binding to the artifact is the difference between a real supply-chain claim and a decorative one. A
trust mark should carry the artifact's **content digest** (the image or package hash), and verification
should confirm three things together: the mark's signature chains to an anchor you trust, the mark's
`image_digest` matches the digest of the artifact you're about to run, and the signer is who you
require — not "any signer with a valid certificate."

The failure mode to watch for is a verify command that checks a signature exists but accepts *any*
identity (an issuer/identity pattern of `.+`), or that never re-checks the embedded mark against the
digest. That verifies almost nothing. A trustworthy verifier pins the expected signer identity, verifies
the embedded trust-mark JWS against chain-resolved keys, and refuses when the running digest doesn't
match the one the mark attests. Only then does "this image passed the gate" survive an adversary who can
present a different image with a genuine-looking mark.
