# fedmgr — dev guards & gotchas

Hard-won lessons, kept terse. Read before touching Docker, dependencies, the
lab, or the SSC suite. Each entry is a **guard**: the trap, then the rule.

## Build / test / run (the happy path)
```bash
npm run build            # tsc -b across all packages
npm test                 # per-package `node --test` — the whole workspace suite
./deploy/lab/up.sh     # build + start registry + TA + TMI, wait for health
./deploy/lab/down.sh   # stop (durable state kept; --wipe resets)
npm run scan             # SSC/scripts/scan-all.sh (needs scanners installed)
```
The published front door is **`@letsfederate/fedmgr`** (`packages/fedmgr/`,
`bin: fedmgr`). Root `package.json` is a private workspace root — it delegates
`build`/`test` to the workspaces and ships nothing itself.

## Guard: Docker ≠ host build
Adding a `tsc -b` project reference from one package to another builds fine on
the host but **silently breaks the Docker image** if the Dockerfile never
copies/builds the new dependency (symptom: `TS5083` at build, or a missing
route at runtime). When service A starts importing package B, update
`services/A/Dockerfile`:
- COPY `packages/B/package.json` before `npm ci`
- COPY `packages/B/` and `npm run build -w @letsfederate/B` **before** building A
- ship `packages/B/dist` (+ `package.json`) in the runtime stage

**Verify by running**, not by host build: `./deploy/lab/up.sh` then curl a
real endpoint (e.g. `curl --cacert deploy/lab/ca/root.crt "https://localhost:9443/federation_search?q=x"`). This is how
the fedvec→ta-server regression was caught after host `npm run build` passed.

## Guard: disk-full corrupts node_modules
An ENOSPC event fills files with **NUL bytes**; they surface much later as
`SyntaxError: Invalid or unexpected token` deep in a dependency. `npm install`
won't refetch them (version still matches). Fix + detect:
```bash
grep -rlI $'\x00' node_modules --include=*.js   # list corrupted files
rm -rf node_modules && npm install               # clean repair
```

## Guard: Node version + npm 11 native rebuilds
Runtime and `engines` are **Node 24** (OpenSSL 3.5 — gives native ML-KEM/ML-DSA
for the PQC path). Two gotchas after upgrading Node:
- **npm 11 skips install scripts by default** (a security gate). A plain
  `npm install` will NOT rebuild native addons — you'll see
  `npm warn allow-scripts`. Rebuild the ABI-sensitive ones explicitly:
  `npm rebuild better-sqlite3 --foreground-scripts` (also `pkcs11js`,
  `onnxruntime-node` if you exercise them). `@ruvector/rvf` ships prebuilds.
- **Node 24's `node --test` default reporter is `spec`** (`✔`/`ℹ`), not TAP.
  Count with `ℹ tests|pass|fail`, not `# tests`.

## Guard: RVF cosine metric is lost on reopen
`@ruvector/rvf` 0.2.x does **not** restore the cosine metric after
close+`openReadonly` (returns squared-L2). fedvec works around it by storing
metric `l2` with L2-normalized vectors and scoring `1 - distance/2`. Don't
"simplify" it back to cosine. See `packages/fedvec/src/federation-index.ts`.
Also: RVF has companion files (`.rvf.idmap.json`) — move **all** of them on an
atomic rename, not just the `.rvf`.

## Guard: SSC suite assumes its own repo root
`SSC/scripts/*.sh` compute the repo root relative to their own location
(`$(dirname $0)/../..` — they live at `SSC/scripts/`). Reports land in
`SSC/reports/` (committed); raw output in `SSC/raw/` (gitignored). Bandit
auto-skips when there's no Python; Hadolint lints every `Dockerfile.*`.
Scanners are installed on demand and only with consent:
`SSC/scripts/install-sectools.sh --confirm-install-sectools` (the one place the
repo reaches the internet). **SLA: zero HIGH/CRITICAL before issuing a
trustmark.**

## Guard: broad .gitignore rules
This repo's `.gitignore` has sweeping rules (`reports/`, `.claude/*`,
`CLAUDE.md`, `context`). They can silently hide a directory you *want*
committed (e.g. `SSC/reports/` and `.claude/skills/` both needed explicit
`!` re-includes). When adding a committed output dir, `git check-ignore <path>`
first.

## Guard: don't commit the big stuff
The RuVector `.rvf`/brain store is 500 MB+ — **never** commit it (`.ruvector/`,
`*.rvf`, `ruvector.db`, `*.pub.jwk` are gitignored). Keep learnings as small
markdown, not a vector DB.

## Guard: JWS alg is derived from the key, allowlisted at verify
Signing/verification infer the alg from the key's curve (P-256→ES256,
P-521→ES512 — default since 2026-08; jose v6 requires an explicit alg for
JWKs without one). Verifiers constrain to `SUPPORTED_JWS_ALGS` in
`@letsfederate/kms` (EC family only) — never trust the JWS header's alg, and
never widen by key-type inference alone (that's go-oidfed's gap, don't copy
it). Exceptions that stay put: pkcs11 provider is ES256 (P-256 hardware);
fedmgr-mcp keeps its looser local helper (RS256 OpenBao transit path,
review Finding #5). jose v6 also generates **non-extractable** keys by
default — test fixtures that `exportJWK` need `{ extractable: true }`.
Compose note: recreating `ta-server` (netns owner) requires
`up -d --force-recreate entity-host caddy` — plain `restart` fails with
"No such container" (followers pin the old container id).

## Guard: PQC signing path is gated by our own pins, not the ecosystem
ML-DSA in JOSE is standardized (RFC 9964, May 2026) and available end-to-end:
Node 24 signs it natively (OpenSSL 3.5), `jose` npm supports it since **v6.1.0**,
and go-oidfed ships it today. What blocks us: we pin `jose` **^5.x** and
`packages/oidf-verify` hard-codes `algorithms:["ES256"]`. Widen the allowlist
deliberately (parameterize), never by key-type inference. Related: host `curl`
links OpenSSL 3.0 and **cannot** negotiate ML-KEM — probe the PQC edge with
Node 24 or an OpenSSL 3.5 container, not curl. Cross-stack detail:
`docs/analysis/go-oidfed-interop-pqc-2026-08.html`.

## Commits
Author is **Chris Phillips only** — no `Co-Authored-By` / tool trailers.
