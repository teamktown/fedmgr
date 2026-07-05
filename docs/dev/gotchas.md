# fedmgr — dev guards & gotchas

Hard-won lessons, kept terse. Read before touching Docker, dependencies, the
lab, or the SSC suite. Each entry is a **guard**: the trap, then the rule.

## Build / test / run (the happy path)
```bash
npm run build            # tsc -b across all packages
npm test                 # per-package `node --test` (156 tests) — the real suite
./examples/lab/up.sh     # build + start registry + TA + TMI, wait for health
./examples/lab/down.sh   # stop & clean
npm run scan             # SSC/scripts/scan-all.sh (needs scanners installed)
```
The published front door is **`@letsfederate/fedmgr`** (`packages/fedmgr/`,
`bin: fedmgr`). Root `package.json` is a private workspace root — it delegates
`build`/`test` to the workspaces and ships nothing itself.

## Guard: Docker ≠ host build
Adding a `tsc -b` project reference from one package to another builds fine on
the host but **silently breaks the Docker image** if the Dockerfile never
copies/builds the new dependency (symptom: `TS5083` at build, or a missing
route at runtime). When package A starts importing package B, update
`Dockerfile.A`:
- COPY `packages/B/package.json` before `npm ci`
- COPY `packages/B/` and `npm run build -w @letsfederate/B` **before** building A
- ship `packages/B/dist` (+ `package.json`) in the runtime stage

**Verify by running**, not by host build: `./examples/lab/up.sh` then curl a
real endpoint (e.g. `curl localhost:8090/federation_search?q=x`). This is how
the fedvec→ta-server regression was caught after host `npm run build` passed.

## Guard: disk-full corrupts node_modules
An ENOSPC event fills files with **NUL bytes**; they surface much later as
`SyntaxError: Invalid or unexpected token` deep in a dependency. `npm install`
won't refetch them (version still matches). Fix + detect:
```bash
grep -rlI $'\x00' node_modules --include=*.js   # list corrupted files
rm -rf node_modules && npm install               # clean repair
```

## Guard: Node version
Local runtime here is **Node 18**; `engines` want `>=22` (the Docker images use
`node:22`). The test runner (`node --test`) works on 18, but native addons
(better-sqlite3, @ruvector/rvf) are ABI-sensitive — rebuild if you switch Node.

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

## Commits
Author is **Chris Phillips only** — no `Co-Authored-By` / tool trailers.
