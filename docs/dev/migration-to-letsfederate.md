# One-time runbook: teamktown/fedmgr → letsfederate/fedmgr

A checklist for moving the repo to the `letsfederate` org, collapsing the
branch sprawl, and landing on the protected-`main` + semantic-branch model in
[branching.md](branching.md). Run it once; then delete this file (or keep it as
history).

> **Snapshot first — belt and suspenders.** Before anything destructive:
> ```bash
> git bundle create ../fedmgr-full-history-$(date +%Y%m%d).bundle --all   # every branch + tag, restorable
> tar --exclude=node_modules --exclude='**/dist' -czf ../fedmgr-tree-$(date +%Y%m%d).tar.gz .
> ```
> The `.bundle` preserves the entire history (all branches/tags) in one file you
> can `git clone` from later; the tarball is the working tree. Keep both off the
> box.

## 1. Land the work on `main`

All current work lives on `codex/refactor-docker-compose-for-trust-anchor-implementation`
— **91 commits ahead of `main`, 0 behind** (a clean fast-forward). This is the
"great work"; it becomes `main`.

```bash
git checkout main
git merge --ff-only codex/refactor-docker-compose-for-trust-anchor-implementation
git push origin main     # ⚠️ this triggers release.yml → the FIRST npm publish. See §4.
```

Do **not** squash the 91 commits — they are the provenance trail (each records
what was verified and how), which is load-bearing for a trust project.

## 2. Branch triage (assessed 2026-07-13)

Ages relative to `main` (2025-10-21). "ahead/behind" = commits vs `main`.

| Branch | ahead | behind | Verdict | Why |
|---|---:|---:|---|---|
| `codex/refactor-docker-compose-for-trust-anchor-implementation` | 91 | 0 | **→ becomes `main`** | all current work; the merge above |
| `feat/uplift-tdd` | 17 | 0 | **archive as tag, delete** | original lineage of the increment/TDD work — its every "unique" file (fedmgr-cli, examples/lab, monolith Dockerfiles, validate-url.ts, the OIDF skill doc) was **renamed/moved/consolidated** by our restructure; content is superseded, not lost. Verified by tree-diff. |
| `feat-v0.8.1-improved-secrets` | 1 | 2 | **delete** | the 1 unique commit adds an **empty** `.vscode/mcp.json.example` — no content |
| `coderabbitai/docstrings/WAdH…` | 1 | 79 | **delete** | docstrings on `src/server/mcp-server.js` — the deleted monolith; file no longer exists |
| `feat-v0.8.0-uplift-oidcfed43-tdd-refactor` | 0 | 12 | delete | fully in `main` |
| `codex/*` (7 branches) | 0 | 6–49 | delete | fully in `main` (add-dotenv, mcp-instance, module-structure, remove-copy, service-mounts, setup-docs, loadregistry) |
| `cpdev-roobuilding`, `cpdev-roo-dockerbuild` | 0 | 83, 72 | delete | fully in `main` (early dev branches) |
| `feat-refactor-dockercompose-mcp` | 0 | 41 | delete | fully in `main` |
| `feat-update-to-oidc-server-mock-for-OP` | 0 | 60 | delete | fully in `main` |
| `v0.0.1-legacy-websocket-no-packaging` | 0 | 83 | **tag, then delete** | intentional version marker — preserve as an annotated tag |
| `v0.0.5-legacy-npm-compose-demo` | 0 | 45 | **tag, then delete** | intentional version marker — preserve as an annotated tag |

Net: keep `main`; **archive 4 as tags** (`feat/uplift-tdd`, the two `v0.0.*`
legacy markers, and — optionally — `feat-v0.8.0`); **delete the other ~14**.

## 3. Preserve-then-prune

Archive the branches worth remembering as annotated tags (immutable, cheap,
out of the branch list), then delete every merged/superseded branch.

```bash
# Archive lineage + version markers as annotated tags
git tag -a archive/uplift-tdd     origin/feat/uplift-tdd                     -m "Archived: original increment/TDD lineage (superseded by the 2026-07 restructure)"
git tag -a v0.0.1-legacy          origin/v0.0.1-legacy-websocket-no-packaging -m "Legacy: websocket, no packaging"
git tag -a v0.0.5-legacy          origin/v0.0.5-legacy-npm-compose-demo       -m "Legacy: npm compose demo"
git push origin --tags

# Delete the superseded remote branches (review this list before running)
for b in \
  feat/uplift-tdd feat-v0.8.1-improved-secrets \
  coderabbitai/docstrings/WAdHAkdJRhf0rybTQJUDDoS0a8wk \
  feat-v0.8.0-uplift-oidcfed43-tdd-refactor \
  codex/add-dotenv-config-to-fedmgr.js \
  codex/implement-mcp-instance-creation-in-setup-script \
  codex/refactor-fedmgr-module-structure \
  codex/remove-copy-instructions-from-dockerfiles \
  codex/update-docker-compose-for-service-mounts \
  codex/update-documentation-for-setup-script-requirements \
  codex/update-loadregistry-to-write-missing-file \
  cpdev-roobuilding cpdev-roo-dockerbuild \
  feat-refactor-dockercompose-mcp feat-update-to-oidc-server-mock-for-OP \
  v0.0.1-legacy-websocket-no-packaging v0.0.5-legacy-npm-compose-demo \
  codex/refactor-docker-compose-for-trust-anchor-implementation ; do
  git push origin --delete "$b"
done
```

Result: `main` + a handful of `archive/*` and `v*-legacy` tags. Clean.

## 4. The org move

Two ways; pick by whether commit history matters (for a trust project, it does).

**Option A — GitHub transfer (recommended, keeps everything).**
Repo → Settings → *Transfer ownership* → `letsfederate`. GitHub moves history,
tags, issues, PRs, and sets up a redirect from the old URL. Then locally:
`git remote set-url origin https://github.com/letsfederate/fedmgr`.

**Option B — Fresh repo from the snapshot (clean slate, loses history).**
Create empty `letsfederate/fedmgr`, then from the tarball tree:
`git init && git add -A && git commit -m "chore: import fedmgr" && git push`.
Only choose this if you deliberately want to drop the 91-commit provenance —
the `.bundle` from the snapshot step still preserves it out-of-band.

Either way, the URL rewrite in manifests/docs is already done (commit
`teamktown → letsfederate`); the historical SSC reports intentionally keep the
old image labels as point-in-time records.

## 5. Post-move checklist

- [ ] **Branch protection on `main`** — apply every setting in
      [branching.md](branching.md) § Main branch protection.
- [ ] **Enable "automatically delete head branches"** (Settings → General).
- [ ] **Re-point CI secrets** in the new org: `NPM_TOKEN` (release),
      `GITHUB_TOKEN` scopes, `TMI_ISSUER`/`TMI_JWKS_URL`/`TMI_PRIV_JWE`
      (containers trustmark step), any GHCR access.
- [ ] **npm provenance** — packages publish with `--provenance`; the OIDC
      subject changes with the repo URL. Confirm the first release from the new
      org publishes and the provenance attests `letsfederate/fedmgr`.
- [ ] **GHCR image paths** — `containers.yml` uses
      `ghcr.io/${{ github.repository }}`, so images auto-move to
      `ghcr.io/letsfederate/fedmgr/*`; update any doc/compose that hardcodes the
      old path (none live remain; check `deploy/` and `packages/fedmgr/deploy/`).
- [ ] **Tag protection rule** (`v*`, `*-v*`) so releases can't be hand-tampered.
- [ ] **First green PR** through the new flow to confirm required checks,
      squash-merge, and the release trigger all behave.
