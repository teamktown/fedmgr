---
question: Is fedmgr post-quantum ready?
arc: supply-chain-integrity
audience: [enterprise, operator]
tags: [pqc, ml-dsa, ml-kem, cbom, crypto-agility]
---
Partly, honestly, and with a clear line between what's proven and what's aspirational. On Node 24 /
OpenSSL 3.5 it's demonstrated end-to-end that ML-DSA (FIPS 204) signing and ML-KEM-768 (FIPS 203) key
exchange work natively, that OpenSSL 3.5 can mint an ML-DSA-65 certificate authority, and that Node 24's
X.509 accepts it. So minting a post-quantum CA is a **tooling choice, not a capability gap**.

Crypto-agility is no longer aspirational: the trust-chain JWS layer derives its algorithm from the
signing key (ES512/P-521 by default, ES256/384 accepted against a closed EC allowlist, on jose v6),
so a future ML-DSA algorithm slot is a policy change, not a rewrite — and RFC 9964 (May 2026) has
since standardized ML-DSA for JOSE. What's *not* true yet: fedmgr's trust chain and default CA are
still classical ECDSA, and the real blocker to switching is **cross-ecosystem acceptance** — other
verifiers and public trust stores need to catch up before a PQC mark is verifiable everywhere.
Within a fedmgr-only federation (every verifier on Node 24 / OpenSSL 3.5), a private post-quantum
trust fabric is feasible today.

fedmgr ships a Cryptographic Bill of Materials (CBOM, CycloneDX 1.6) that is honest about this: the
ECDSA uses are flagged quantum-vulnerable with a migration horizon, while SHA-256 and hybrid KEMs are
not. The one caveat the audit flagged: don't let the CBOM claim a hybrid PQC edge KEM that no deployed
code actually configures — a bill of materials must describe what's wired, not what's planned.
