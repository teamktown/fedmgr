# init phase 2 — mint-ca (spec)

**Goal.** `fedmgr init` establishes a trust root on the operator's machine: a
local root CA it mints itself, *or* a provider CA the operator chooses to
accept. Everything downstream (registry TLS, signing waypoint) chains to it.

Written spec-first, then test-first, then code — so the tests pin the contract,
not the implementation.

## Layout
```
~/.letsfederate/ca/
  root_ca.crt     EC P-256 self-signed root (0644, world-readable — it's public)
  root_ca.key     encrypted private key    (0600)
  .pass           random 32-byte password  (0600)
```
`caPaths(home?)` returns those four absolute paths. `home` defaults to the OS
home dir (injectable for tests).

## Minting — `mintLocalCa(paths?, opts?)`
- Uses the `smallstep/step-cli` **container** (no host `step` dependency —
  consistent with `deploy/lab`). Runs as the host uid so files are
  host-owned, not root.
- `step certificate create "letsfederate local root CA" root_ca.crt root_ca.key
  --profile root-ca --password-file .pass` → EC P-256, self-signed, CA:TRUE.
- **Idempotent.** If cert+key already exist, returns them untouched unless
  `opts.force`.
- Requires Docker. If Docker is absent the caller (init) reports it and stops
  the phase — it does not pretend to have minted anything.

## Accepting a provider CA — `acceptCa(ref, paths?)`
- `ref` = a local file path to a PEM cert (URL support is a later slice; a URL
  ref throws a clear "not yet supported").
- **Verifies before trusting** (see below); refuses to install a cert that
  isn't a valid CA. Copies the accepted cert to `root_ca.crt`.

## Verification — `verifyCa(pem)` → the independent cross-check
This is the crux of "never lie in tests." Minting is done by **step**;
verification is done by **Node's own X.509 parser** (`node:crypto`
`X509Certificate`) — a *different* tool. A cert that step produced is only
accepted if Node independently agrees it is:
- parseable as X.509,
- `ca === true` (basicConstraints CA:TRUE),
- self-signed (`subject === issuer`) **and** its signature verifies against its
  own public key,
- currently within its validity window.

Returns `{ ok, reasons[], subject, issuer, notAfter }`. `reasons` is non-empty
exactly when `ok` is false, and names each failure — so a test can assert *why*
a bad cert was rejected, not just that it was.

## Test plan (written before the code)
Unit (no Docker — always run):
1. `caPaths` → the four expected paths under `~/.letsfederate/ca`.
2. `verifyCa("garbage")` → `ok:false`, reason "not a parseable X.509…".
3. `verifyCa(goodCaFixture)` → `ok:true`, subject present. *(fixture minted by step, checked by node — cross-tool)*
4. `verifyCa(leafFixture)` → `ok:false`, a reason mentions CA / self-signed.
   **Negative test proves the check isn't a rubber stamp.**
5. `acceptCa(goodCaFile)` installs + re-verifies; `acceptCa(leafFile)` throws.

Integration (Docker-gated — **skips with a reported `# SKIP`, never a fake pass**):
6. `mintLocalCa` into a temp dir really runs step, then `verifyCa` (node) must
   independently pass; a second call is idempotent.

## Why this matters to users
`npm test` doubles as an environment health check. If step's output ever drifts
(image change, profile change, clock issues), test 6 fails loudly because an
*independent* parser stopped agreeing — that's drift detection, not decoration.
