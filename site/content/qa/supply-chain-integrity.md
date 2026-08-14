---
question: How does fedmgr improve supply-chain integrity for MCP servers?
arc: supply-chain-integrity
audience: [enterprise, operator]
tags: [sbom, cosign, ssc, slsa, in-toto, trustmark]
---
The goal is a trust mark that **means something verifiable about the artifact you actually run**, not
a rubber stamp. The building blocks each exist: a Software Bill of Materials (SBOM) enumerates what's
inside a build, a cosign signature proves who signed it, and a vulnerability scan gate enforces a
service-level agreement — the letsfederate SLA is **zero HIGH or CRITICAL findings before a trust mark
is issued**.

The integrity comes from **binding those together** rather than shipping them side by side. The
strongest, cheapest form is a single signed in-toto Statement whose subject is the artifact digest and
whose predicate carries the SBOM digest, the scan tally, and the gate verdict — so a trust mark issuer
refuses to sign unless that bound evidence is present and passing, and a consumer can verify the entire
chain (artifact → SBOM → scan → mark) independently and offline. That is the difference between "here
is a badge" and "here is cryptographic proof this exact image passed the gate." The same discipline
applies to fedmgr itself: it publishes an SBOM of its own release and signs it, so you can verify the
verifier.
