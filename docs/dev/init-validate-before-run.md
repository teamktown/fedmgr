# init phase 1 — validate-before-run (armed)

**Goal (your Q3).** npm has no code signing, so before `fedmgr init` does
anything it verifies its own shipped files against a manifest and **fails fast**
on any mismatch.

## How it's armed
- At publish time, `prepublishOnly` runs `scripts/gen-provenance.mjs`, which
  sha256's every `dist/*.js` into `packages/fedmgr/provenance/checksums.txt`.
- The manifest ships in the package (`files` includes `provenance`).
- On `init`, `verifyChecksums(pkgRoot, manifest)` (in `selfcheck.ts`) hashes each
  listed file and compares. Any mismatch/missing → `init` aborts (exit 1).
- If no manifest is present (a dev build that didn't run the generator), `init`
  logs **"self-validation not armed"** and continues — honest, not a silent pass.

The manifest is **not committed** (it derives from `dist`, which is gitignored,
and changes every build). Regenerate locally with `npm run provenance:gen -w
@letsfederate/fedmgr` after building.

## Honest about the limit
This proves **tarball self-consistency**, not **authorship**. A malicious
publisher could ship a matching manifest. Authorship/tamper-in-transit is what
npm provenance (`publishConfig.provenance: true`, Sigstore) addresses — the two
are complementary. We say so rather than implying the checksum file proves more
than it does.

## Proof
Tampering a shipped file makes `init` abort:
```
error  validate-before-run failed: checksum mismatch for dist/ca.js
$ echo $?
1
```
Tested in `test/selfcheck.test.mjs` (round-trip, tamper → mismatch, missing file,
missing manifest — all deterministic, no external tools).
