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

## Run it (full container round trip)

`./round-trip.sh` performs the 100% loop: build → push to the local OCI registry →
**cosign sign** → **syft SBOM** → TMI issues a **digest-bound trustmark** → pull →
cosign verify + trustmark digest binding → admit. It **preflights** docker/cosign/
syft/jq and aborts (exit 69) rather than fake a result.

> ✅ **Executed in the project VM on 2026-06-12** — see
> `docs/evidence/phase-6.1-lab-roundtrip.md` for raw output: a real SoftHSM EC P-256
> key, image pushed to a local registry, **cosign verified**, a 15-package SPDX SBOM,
> and a digest-bound trustmark whose `image_digest` equals the pushed digest (a
> rebuilt image's digest is denied).
>
> ⚠️ **cosign + HSM caveat:** the official cosign *release binary* lacks PKCS#11
> (`unimplemented`), so signing the image *directly* with the SoftHSM key needs a
> cosign built with the `pkcs11key` tag, or a cloud-KMS key URI. The run above used
> a key-based cosign signature; the SoftHSM key is real and the OIDF trustmark uses
> our ES256 signing (the `KeyProvider`/HSM seam). The TMI-issued trustmark step needs
> the lab's TA/TMI running; the evidence used our in-process ES256 issuance.

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
