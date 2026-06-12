# Example 01 — Trust Circle (E1)

A user runs **their own** trust ecosystem: a Trust Anchor (TA) vouches for an MCP,
the MCP proves it controls its key, an image is signed and bound to a trustmark,
and a verifier admits it. Canonical anchor identity: **`https://trust.letsfederate.org`**.

## Why

To show, end-to-end, that an MCP can be made *verifiable* — not "trust me," but
"here is a signed chain to an anchor you accept, and a mark proving I passed a gate."

## What it proves

Two layers, both real:

1. **In-band handshake (Tier-1)** — fedmgr-mcp advertises the
   `org.letsfederate/oidf-trust` extension at `initialize`: its entity id, the anchor
   it chains to, and its trust marks. A client applies an **accepted-anchor policy**
   and admits/denies *before talking to it*. ✅ **Verified in this repo** —
   `test/oidf-trust-extension.test.mjs`.
2. **Cryptographic verdict** — `validate_mcp_invocation` verifies the signed
   subordinate/entity/invocation JWTs (signature, audience, required mark in the
   token). ✅ **Verified** — `test/validate-mcp-invocation*.test.mjs`.

## Run it (in-process, no Docker)

```bash
npm run build -w @letsfederate/fedmgr-mcp
node --test packages/fedmgr-mcp/test/oidf-trust-extension.test.mjs \
            packages/fedmgr-mcp/test/validate-mcp-invocation-tool.test.mjs
```

## Run it (full container round trip — LAB-GATED)

`./round-trip.sh` performs the 100% loop: build → push to the local OCI registry →
**cosign sign** (HSM key) → **syft SBOM** → TMI issues a **digest-bound trustmark**
(evidence → SBOM) → pull → cosign verify + trustmark verify → admit.

> ⚠️ Requires `docker`, `cosign`, `syft`, and SoftHSM. The script **preflights**
> these and exits with install instructions if any are missing — it never pretends
> to have signed something it didn't. As of this commit it was **not executed in
> the build sandbox** (cosign/syft/softhsm were absent there); run it in the lab.

## What to look for

- Handshake: `admit: true` only when your `acceptedAnchors` includes
  `https://trust.letsfederate.org`.
- Verdict: `[TRUST:VALID] MCP invocation ALLOWED` with all five checks `✓`.
- Round trip: `cosign verify` succeeds **and** the trustmark's `image_digest`
  equals the pulled image digest.

## The failure case

- Anchor not accepted → handshake `admit: false` (`anchorAccepted: ✗`).
- Token missing the mark, wrong audience, or tampered → verdict `DENIED`.
- Rebuilt image (new digest) → trustmark digest binding fails → admission denied.
  (This is Example 02 — the rogue gauntlet.)

See `docs/walkthroughs/validate-mcp-invocation.md` and
`docs/evidence/phase-6.1-test-evidence.md`.
