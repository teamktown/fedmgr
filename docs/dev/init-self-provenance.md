# init phase 4 — self-provenance (spec)

**Goal.** The freshly-minted ecosystem proves the trust loop *on itself*:
generate an SBOM for what we ship, sign it, and confirm the signature with an
**independent** tool. This is the R5 "code-pedigree" promise made concrete.

Spec-first → test-first → code. Built incrementally:
- **This slice:** SBOM generation + independent structural validation, and
  blob signing + **independent signature verification**.
- **Next slice:** build+push the waypoint image to the local registry and
  attach the SBOM/signature as an OCI attestation; issue the trust mark.

## Tools & PATH
`syft` and `cosign` are installed in `~/.local/bin`. The provenance module
augments the child-process `PATH` with `~/.local/bin` so it finds them however
it's invoked (not just from a login shell).

## SBOM — `generateSbom(target, outPath)` + `validateSbom(json)`
- `generateSbom` runs `syft dir:<target> -o cyclonedx-json=<outPath>`.
- `validateSbom` is a **structural** check (not crypto): the document must have
  `bomFormat === "CycloneDX"`, a `specVersion`, and a `components` array. It
  returns `{ ok, reasons[], format, componentCount }`. This is drift detection:
  if syft's output shape changes, validation fails loudly rather than silently
  passing a malformed SBOM downstream.

## Signing — the independent cross-check
cosign signs; **Node's `crypto` verifies** — a different implementation.
- `ensureCosignKeypair(dir)` → `cosign generate-key-pair` (empty password) if
  absent; returns `{ key, pub }`.
- `signBlob(path, keyDir, bundleOut)` → `cosign sign-blob --key … --bundle …`.
  The Sigstore bundle (`v0.3`) carries the raw signature at
  `messageSignature.signature` (base64).
- `verifyBlobIndependently(path, bundlePath, pubPath)` → parse the bundle,
  extract that signature, and verify it with `crypto.createVerify("SHA256")`
  against the cosign **public** key over the original bytes. Returns
  `{ ok, reasons[] }`. It never calls cosign — that's the point.

## Test plan (written before the code)
Unit (always run):
1. `validateSbom(minimalCycloneDX)` → ok; `validateSbom({})` and an SPDX-shaped
   doc → not ok, with a reason. **Negative cases prove it's not a rubber stamp.**

Tool-gated (`syft`/`cosign`; **skip with a reported `# SKIP` when absent** — never a fake pass):
2. `generateSbom` on a small dir → a document `validateSbom` accepts
   (cross-tool: syft produces, our validator checks the shape).
3. Sign a blob with cosign, then `verifyBlobIndependently` (node) → ok;
   **tamper the blob → not ok** (independent negative test).

## Why it matters
A signed SBOM whose signature a *second* tool confirms is real provenance, not
a decorative artifact (the assessment's R5 critique of the old round-trip:
"makes SBOM, never validated"). And the test suite catches the day cosign or
syft drift, because the independent verifier stops agreeing.
