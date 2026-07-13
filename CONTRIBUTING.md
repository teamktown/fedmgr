# Contributing to fedmgr

fedmgr is an OpenID Federation trust backplane for MCP. Thanks for helping build
it. This is the short entry point; the detail lives in `docs/dev/`.

## Setup

Prerequisites: **Node ≥ 24** (OpenSSL 3.5 — native ML-KEM/ML-DSA), Docker +
compose. Optional for the container round-trip: `cosign`, `syft`, `jq`.

```bash
git clone https://github.com/letsfederate/fedmgr && cd fedmgr
npm ci
npm run build          # tsc -b across the workspace
npm test               # the whole suite (per-package node --test + structure guards)
./deploy/lab/up.sh     # stand up the local trust lab (TA/TMI/registry, TLS)
```

New to the codebase? Read **[docs/README.md](docs/README.md)** (the index) and
**[docs/dev/gotchas.md](docs/dev/gotchas.md)** (the hard-won guards) first.

## How work lands

1. **Branch from the latest `main`** with a semantic prefix:
   `feat/…`, `fix/…`, `refactor/…`, `docs/…`, `chore/…`, `test/…`.
2. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)** —
   these drive automated releases, so the type matters
   (`feat:` → minor, `fix:` → patch, `feat!:` → major, `docs:`/`chore:` → no
   release).
3. **Open a PR into `main`.** CI must pass — build, `npm test`, the repo-
   structure guards, and the SSC security gate (zero HIGH/CRITICAL).
4. **Squash-merge** once approved; the PR title becomes the release commit.

`main` is protected and **publishing** — a merge to `main` triggers a
semantic-release npm publish. The full rules (branch protection, the merge=release
interaction, the release train) are in
**[docs/dev/branching.md](docs/dev/branching.md)**. Read it before your first PR.

## Bars every change must clear

- **Verify by running, not by asserting.** For anything with a runtime surface,
  drive the real flow (the lab, a live endpoint) — host build passing is not
  proof. See the "Docker ≠ host build" guard.
- **Tests are genuine.** New behavior gets a real test (hermetic, with a
  negative case); no mocks-of-your-own-logic. Green must mean correct.
- **Security is a gate, not a warning.** The SSC scan blocks a trustmark while
  any HIGH/CRITICAL exists — keep it at zero. Never commit key material,
  secrets, or the RuVector `.rvf` brain.
- **Docs move with the code.** If you change a path, command, or flag, update the
  docs and the operations FAQ in the same PR.

## Commit authorship

Commits are authored by **Chris Phillips** only — no `Co-Authored-By` or tooling
trailers.

## Where to look

| I want to… | Read |
|---|---|
| Understand the layout & guards | [docs/README.md](docs/README.md), [docs/dev/gotchas.md](docs/dev/gotchas.md) |
| Know the branching / release rules | [docs/dev/branching.md](docs/dev/branching.md) |
| Build / test / run | [docs/dev/running.md](docs/dev/running.md) |
| Fix an install/operational error | [docs/operations-faq.md](docs/operations-faq.md) |
| Help a user install (agent skill) | `.claude/skills/fedmgr-install/` |
