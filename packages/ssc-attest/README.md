# @letsfederate/ssc-attest

Signed **supply-chain trust evidence**. Binds an artifact digest + SBOM digest + vulnerability-scan
tally + zero-HIGH/CRITICAL gate verdict into **one** signed in-toto statement — so a Trust Mark Issuer
can refuse to issue an artifact-bound trust mark unless the artifact demonstrably passed the gate.

The gate result is **computed from the scan counts**, not asserted: a forged `gate.passed: true` over
HIGH/CRITICAL findings is rejected (the tally is authoritative).

```ts
import { buildSscStatement, signSscStatementJws, verifySscStatementJws } from "@letsfederate/ssc-attest";

const stmt = buildSscStatement({ artifactDigest, sbomDigest, scan: { critical: 0, high: 0 } });
const jws = await signSscStatementJws(stmt, kms.signJwt);      // sign with your key
// … the TMI, before issuing:
const verdict = await verifySscStatementJws(jws, { publicJwks, expectedArtifactDigest: artifactDigest });
if (!verdict.ok) throw new Error(verdict.reasons.join("; ")); // fail closed
```

Zero dependencies beyond `jose`. Part of [fedmgr](https://github.com/letsfederate/fedmgr). MIT.
