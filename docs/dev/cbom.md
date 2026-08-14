# CBOM — Cryptographic Bill of Materials (spec)

**Why.** The June 2026 EO makes a **Cryptographic Bill of Materials** the
supply-chain centerpiece for post-quantum readiness — a machine-readable
inventory of the crypto a system uses, so it can be assessed for
quantum-vulnerability automatically. We already emit a signed SBOM in `init`; a
CBOM is the crypto-focused sibling, and almost nobody ships one. It's our
cheapest, most credible PQC-leadership artifact. See
`docs/analysis/post-quantum-readiness.html`.

Spec-first → test-first → code.

## Format — CycloneDX 1.6 cryptographic-asset
CycloneDX 1.6 has a native `cryptographic-asset` component type with
`cryptoProperties`. We emit a faithful subset so the CBOM is a real CBOM, not an
invented format:

```json
{
  "bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1,
  "metadata": { "component": { "type": "application", "name": "@letsfederate/fedmgr" } },
  "components": [{
    "type": "cryptographic-asset",
    "name": "ECDSA-P256",
    "cryptoProperties": {
      "assetType": "algorithm",
      "algorithmProperties": {
        "primitive": "signature",
        "parameterSetIdentifier": "P-256",
        "nistQuantumSecurityLevel": 0          // 0 = not quantum-safe
      },
      "oid": "1.2.840.10045.4.3.2"
    },
    "properties": [
      { "name": "letsfederate:use", "value": "trust-chain-jws" },
      { "name": "letsfederate:quantumVulnerable", "value": "true" },
      { "name": "letsfederate:migrateTo", "value": "ML-DSA" },
      { "name": "letsfederate:deadline", "value": "2031-12-31" }
    ]
  }]
}
```

## What we inventory (our actual primitives)
| Use | Algorithm | Primitive | Quantum-safe | Migrate → | Deadline |
|---|---|---|---|---|---|
| trust-chain-jws | ES512 / ECDSA P-521 (default; ES256/384 accepted) | signature | no | ML-DSA | 2031-12-31 |
| local-ca | ECDSA P-256 (root-ca) | signature | no | ML-DSA | 2031-12-31 |
| artifact-signing | ECDSA P-256 (cosign) | signature | no | ML-DSA | 2031-12-31 |
| digest | SHA-256 | hash | yes (Grover ≈128-bit) | — | — |
| edge-key-exchange | X25519MLKEM768 | kem | yes (hybrid PQC) | — | — |

The `edge-key-exchange` row is present when we front with a PQC edge (Cloudflare
Tunnel) — it's what makes "post-quantum key exchange today" a checkable claim in
the CBOM itself, aligned to the EO's 2030 key-establishment priority.

## API
- `buildCbom(assets?)` → the CycloneDX 1.6 document (defaults to
  `FEDMGR_CRYPTO_ASSETS`, our curated inventory).
- `validateCbom(doc)` → `{ ok, reasons[], assetCount, quantumVulnerable }` —
  structural check (CycloneDX markers + every component is a
  `cryptographic-asset` with `cryptoProperties`). Independent of the builder.
- CLI: `fedmgr cbom [--out <file>] [--sign] [--json]` — emit the CBOM; `--sign`
  runs it through the provenance flow (cosign) so it's a **verifiable** CBOM.

## Test plan (before the code)
1. `buildCbom()` → valid CycloneDX 1.6; every component `type` is
   `cryptographic-asset` with `cryptoProperties.assetType === "algorithm"`.
2. Each asset carries `letsfederate:use` + a `quantumVulnerable` property;
   `nistQuantumSecurityLevel` is 0 for classical, ≥1 for PQC/hash.
3. `validateCbom(built)` → ok; `validateCbom({})` and an SBOM-shaped doc → not ok
   (**negative — not a rubber stamp**). Reports `assetCount` + `quantumVulnerable`.
4. The known-classical set (ECDSA rows) is flagged quantum-vulnerable; the KEM +
   hash rows are not — so the CBOM tells the truth about our posture.

## Why it matters
A **signed** CBOM is exactly the "automated crypto-asset assessment" the EO asks
for, and it's honest: it names our ECDSA signatures as quantum-vulnerable with a
2031 migration target, right next to the PQC key-exchange we already get at the
edge. Shipping it is the difference between *claiming* PQC-awareness and
*proving* it.
