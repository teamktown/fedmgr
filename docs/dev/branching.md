# Branching model & main protection

The rules for how work flows into `main` on **letsfederate/fedmgr**. The short
version: **semantic feature branches, PR into a protected `main`, and remember
that merging to `main` publishes a release.**

## The one interaction that shapes everything: merge = release

`.github/workflows/release.yml` runs on **push to `main`** and runs
`semantic-release` — it publishes the libraries and the CLI to npm, tags, and
writes changelogs. **A merge to `main` is a release event, not just an
integration event.** Two consequences:

- Never push directly to `main`. Every change lands via a reviewed PR.
- **Conventional Commits are load-bearing**, not cosmetic — semantic-release
  reads commit types to decide the version bump. `fix:` → patch, `feat:` →
  minor, `feat!:`/`BREAKING CHANGE:` → major, and `chore:`/`docs:`/`test:`/
  `refactor:`/`ci:` → no release. Get the type wrong and you cut the wrong
  version (or none).

## Branch naming — semantic prefixes

One branch = one intent. Prefix by the Conventional Commit type it will
produce, so the branch name predicts the release:

| Prefix | For | Example |
|---|---|---|
| `feat/` | a new capability | `feat/openbao-keyprovider` |
| `fix/` | a bug fix | `fix/enrollment-origin-check` |
| `refactor/` | behavior-preserving restructure | `refactor/extract-oidf-signing` |
| `docs/` | docs only | `docs/deploy-k8s-guide` |
| `chore/` / `ci/` | tooling, deps, workflows | `chore/bump-node-24-2` |
| `test/` | tests only | `test/waypoint-http-oauth` |

Keep the scope in the slug (`feat/waypoint-<thing>`), lower-kebab-case, no
personal names or ticket-only slugs. A stranger should read the branch and know
what ships.

## The flow

```
main (protected, releases on merge)
  └─ feat/<thing>        # branch from latest main
       ├─ commits use Conventional Commits (feat:/fix:/…)
       ├─ push → open PR into main
       ├─ CI green (build, test, structure guards, SSC gate)
       ├─ review approved
       └─ squash-merge → main → release fires
```

- **Branch from the latest `main`.** Rebase onto `main` before opening the PR
  (or use the PR's "update branch"); a linear history keeps semantic-release's
  commit analysis unambiguous.
- **Squash-merge is the default.** One PR = one semantic commit on `main`. The
  squash commit's **title must be a Conventional Commit** — that title is what
  semantic-release reads. (Merge commits are allowed only for release-train
  branches; see below.)
- **Delete the branch on merge** (enable "automatically delete head branches"
  in repo settings). The work is in `main`; the branch is noise.

## Main branch protection (required settings)

Configure on `letsfederate/fedmgr` → Settings → Branches → `main`:

- **Require a pull request before merging** — 1+ approval; dismiss stale
  approvals on new commits.
- **Require status checks to pass** — mark `ci` (build + `npm test` + the
  repo-structure guards) and the container/SSC checks as required. The
  structure guards (`npm run test:structure`) encode the invariants — packages
  can't depend on services, no key material tracked, TLS lab intact — so a PR
  that breaks the architecture fails the gate, not review.
- **Require branches to be up to date before merging** — forces a rebase so the
  release fires against tested state.
- **Require linear history** — pairs with squash-merge; keeps changelogs clean.
- **Require signed commits** *(recommended for a trust project)* — we sign
  everything else; sign the history too.
- **Do not allow bypassing** — include administrators. The release automation is
  the only actor that pushes to `main`, and it does so via the PR merge, not a
  direct push.
- **Restrict who can push** — nobody directly; PR-merge only.

Tags are created by semantic-release; a tag-protection rule (`v*`,
`*-v*`) prevents manual tag tampering.

## Releases

Releases are automatic — you don't cut them. Merge a `feat:`/`fix:` PR and
semantic-release does the bump, tag, changelog, and npm publish (libraries then
the CLI; services ship as container images via `containers.yml`, never npm).
Because of this, **land docs/chore/test PRs freely** (they don't release) and
**batch or time capability PRs** when you want to control release cadence.

If you need to prepare a coordinated multi-PR release, use a short-lived
`release/x.y` train branch, merge features into it, then one PR from
`release/x.y` → `main` (the one place a merge commit is fine).

## Author identity

Commits are authored by **Chris Phillips** only — no `Co-Authored-By` or tool
trailers (this is enforced by convention and reviewed). See
[gotchas.md](gotchas.md).

## See also

- [gotchas.md](gotchas.md) — the hard guards (Docker ≠ host build, etc.)
- [running.md](running.md) — build / test / run
- [../operations-faq.md](../operations-faq.md) — symptom → cause → fix
- Root [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — the contributor entry point
