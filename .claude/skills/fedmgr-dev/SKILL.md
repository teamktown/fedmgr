---
name: fedmgr-dev
description: Working in the fedmgr repo — building, testing, running the trust lab (TA/TMI/registry via docker compose), changing Dockerfiles or dependencies, or running the SSC security scans. Loads the repo's hard-won guards so you don't repeat known traps.
---

# fedmgr dev

fedmgr is an OpenID Federation trust backplane for MCP: a TypeScript workspace
(`packages/*`) whose published front door is **`@letsfederate/fedmgr`**
(`packages/fedmgr/`, `bin: fedmgr`). The lab (`examples/lab/`) runs a local
OCI registry + Trust Anchor (TA) + Trustmark Issuer (TMI).

**Before you act, read `docs/dev/gotchas.md`** — it is the canonical list of
guards. The two that bite hardest:

1. **Docker ≠ host build.** If you make one package import another, host
   `npm run build` can pass while the Docker image breaks (dep never
   copied/built). Update the consuming `Dockerfile.*`, then **verify by
   running the lab and hitting a live endpoint**, not by host build alone.

2. **Disk-full corrupts node_modules.** After any ENOSPC, a dependency may be
   NUL-filled and throw `SyntaxError: Invalid or unexpected token`. Fix with
   `rm -rf node_modules && npm install`; detect via
   `grep -rlI $'\x00' node_modules --include=*.js`.

## Commands
```bash
npm run build            # tsc -b across packages
npm test                 # the real suite (per-package node --test)
./examples/lab/up.sh     # build + start TA/TMI/registry, wait for health
npm run scan             # SSC scan (installs scanners on consent only)
```

## Non-negotiables
- **Commits: Chris Phillips only** — no `Co-Authored-By` / tool trailers.
- **Never commit the RuVector brain / `.rvf`** (500 MB+). Keep learnings as
  small markdown (like `docs/dev/gotchas.md`), not a vector DB.
- **SSC SLA:** zero HIGH/CRITICAL findings before issuing a trustmark.

Full detail and the remaining guards (Node version, RVF cosine-on-reopen, SSC
repo-root assumptions, broad `.gitignore` rules): **`docs/dev/gotchas.md`**.
