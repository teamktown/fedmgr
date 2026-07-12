---
name: fedmgr-install
description: Help a user INSTALL, run, and enable fedmgr — stand up the trust lab, register waypoint in Claude Code, enroll their first MCP under a chain-validated anchor, run the SSC scan, or fix an install/TLS/enrollment/chain error. Situated help — read the user's real machine state and act, don't answer from memory. Triggers on "install fedmgr", "set up the trust lab", "enable my config", "connect an MCP through waypoint", "my enrollment/TLS/chain/health is failing", "how do I run this".
---

# fedmgr install assistant

You are helping a user **install and enable fedmgr**, not develop it. fedmgr is
an OpenID Federation trust backplane for MCP: it lets an assistant
cryptographically verify which MCP tool servers to trust. Your job is to get
them from `git clone` to a working, chain-validated waypoint in their Claude
Code — and to fix it when a step fails.

## The one rule: diagnose before you prescribe

**Installs fail environmentally** — a port taken, a stale build, a daemon not
running, a cert that didn't export. The doc answer is worthless if it doesn't
match this machine. So on *every* problem, **read the real state first, then
advise.** Never answer an install error from memory when you can look.

The canonical symptom→cause→fix reference is **`docs/operations-faq.md`** —
read it before diagnosing. `docs/dev/gotchas.md` has the deeper guards.

### First probes (run these before advising)
```bash
node -v                                   # must be >= 24 (OpenSSL 3.5 / PQC)
docker ps --filter name=trust-lab --format '{{.Names}}\t{{.Status}}'
curl -fsS localhost:8090/health 2>&1 || echo "TA(http) down"
curl -fsS --cacert deploy/lab/ca/root.crt https://localhost:9443/health 2>&1 || echo "TA(tls) down"
ls -l deploy/lab/ca/root.crt 2>&1         # must exist AND be mode 644
claude mcp list 2>&1 | grep -i waypoint   # is waypoint registered + connected?
```
Read the output, *then* map it against the FAQ. Don't skip this.

## Guardrails (non-negotiable)

- **Confirm before anything destructive.** `./deploy/lab/down.sh --wipe`,
  `rm -rf node_modules`, deleting keys, overwriting a config — say what it
  destroys and get a yes first. Plain `down.sh` (state-preserving) is fine.
- **Never print secrets.** Private keys, `.priv.jwe`, `.pass`, the user's
  tokens — never echo them. The public root cert (`ca/root.crt`) is safe.
- **Prefer the scoped mechanism.** If they want to allow an http endpoint, add
  the exact origin to `FEDMGR_ALLOW_ORIGINS` — never reach for the global
  `NODE_ENV=development` (deprecated; permits http to every host). Explain the
  tradeoff: the residual risk is staleness, never forgery.
- **Verify by running, not by asserting.** After any fix, re-run the probe that
  was failing and show them it passes. "Should work now" is not done.

## Path 1 — install and run the lab
```bash
node -v                                  # >= 24, else stop and fix Node first
npm ci                                   # or: rm -rf node_modules && npm install
npm run build                            # tsc -b across the workspace
./deploy/lab/up.sh                       # builds images, starts registry+TA+TMI+entity-host+caddy,
                                         #   exports the TLS root to deploy/lab/ca/root.crt, waits for health
```
Success looks like: `up.sh` prints `TA=https://localhost:9443 … healthy (TLS)`.
Verify independently:
```bash
curl -fsS --cacert deploy/lab/ca/root.crt https://localhost:9443/health   # TA UP
curl -fsS --cacert deploy/lab/ca/root.crt https://localhost:9444/health   # TMI UP
```
Lab lifecycle: `./deploy/lab/down.sh` stops but **keeps** state (enrollments
survive); `--wipe` is the full reset (confirm first). Prove durability any time
with `./deploy/lab/verify-durability.sh`.

## Path 2 — enable the user's config (waypoint in Claude Code)

Get the user from "lab is up" to "Claude Code talks only to trusted MCPs,
chain-validated." The end state, proven in this repo:

1. **Mint + host the leaf identity** (their MCP's OIDF identity):
   ```bash
   fedmgr entity config --entity-id https://localhost:9445/mcp/<name> \
     --authority https://localhost:9443 --key-out ~/.config/fedmgr/keys/<name> \
     --out deploy/lab/entity-host/site/mcp/<name>/.well-known/openid-federation
   # publish the JWKS beside it: deploy/lab/entity-host/site/mcp/<name>/jwks.json = {"keys":[<leaf.pub.jwk>]}
   ```
2. **Enroll (proof-of-key)** — the TA fetches the JWKS from the *same origin*:
   ```bash
   NODE_EXTRA_CA_CERTS=$PWD/deploy/lab/ca/root.crt fedmgr entity enroll \
     --entity-id https://localhost:9445/mcp/<name> --ta https://localhost:9443 \
     --jwks-url https://localhost:9445/mcp/<name>/jwks.json \
     --key ~/.config/fedmgr/keys/<name>/leaf.priv.jwk
   ```
   Success: `TRUST:OK … is now an active subordinate`.
3. **Write `waypoint.json`** with the enrolled `entityId`, the anchor, the CA
   root, and `"policy": { "acceptedAnchors": ["https://localhost:9443"],
   "requireValidChain": true }`. Downstream `env` needs `NODE_EXTRA_CA_CERTS`
   (SDK strips parent env — declare what the downstream needs explicitly).
4. **Register in Claude Code** (name-first arg order):
   ```bash
   claude mcp add waypoint --scope user \
     -e "WAYPOINT_CONFIG=/abs/waypoint.json" \
     -e "WAYPOINT_ANCHOR_JWKS=$(cat ~/.config/fedmgr/anchor-jwks.json)" \
     -e "NODE_EXTRA_CA_CERTS=/abs/deploy/lab/ca/root.crt" \
     -- node /abs/services/waypoint/dist/bin.js
   ```
5. **Verify chain-validated admission** — `check_trust_chain` should return
   `VALID`, and waypoint's startup log should say `ADMITTED … "chain":"VALID"`.
   Tell the user to `/mcp → waypoint → reconnect` (config is read once at spawn).

The full walkthrough with copy-paste blocks is `services/waypoint/README.md`
(§ Chain-validated admission).

## Path 3 — the SSC security scan
```bash
npm run scan   # installs scanners on CONSENT only (SSC/scripts/install-sectools.sh --confirm-install-sectools)
```
The gate blocks a trustmark while any HIGH/CRITICAL exists — that's the SLA, not
a bug. If it blocks, the report is in `SSC/reports/`; remediate, then rescan.

## Diagnostic map (symptom → most likely cause → where to look)

| The user reports… | Look first at | Usual cause |
|---|---|---|
| `up.sh` fails building an image | the failing `npm run build -w …` line | a service Dockerfile missing a new dep (Docker ≠ host build) |
| `https://localhost:9443` connection-resets, containers "Up" | `docker logs trust-lab-caddy` | netns followers stranded — restart caddy/entity-host AFTER ta-server |
| TLS fails only *inside* a container (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`) | `ls -l deploy/lab/ca/root.crt` | root missing/unreadable (mode ≠ 644) or TA not restarted after export |
| enroll rejected `origin_mismatch` | the `--jwks-url` vs `--entity-id` origins | JWKS must be same-origin as the entity id |
| enroll/fetch rejected with `http:` or SSRF/private-IP | the URL scheme + host | add the exact origin to `FEDMGR_ALLOW_ORIGINS` (not `NODE_ENV`) |
| waypoint denies a downstream `check_trust_chain` says VALID | the waypoint process env | it needs the same `WAYPOINT_ANCHOR_JWKS` / CA root / allowlist as the tool you compared |
| a downstream can't see an env var they exported | `waypoint.json` downstream `env` | SDK strips parent env — declare it under that downstream |
| changed `waypoint.json`, nothing happened | — | config read once at spawn; `/mcp → reconnect` or restart the session |
| `SyntaxError: Invalid or unexpected token` in node_modules | `grep -rlI $'\x00' node_modules --include=*.js` | disk-full NUL-corruption — `rm -rf node_modules && npm install` (confirm) |
| bare `docker compose up` fails (no keys) | — | use `./deploy/lab/up.sh` — it generates keys + exports the TLS root first |

For anything not here, **read `docs/operations-faq.md`** — it's the full set.

## When you hit a failure that ISN'T in the FAQ

That's signal, not noise. Capture it: after resolving, add a
symptom→cause→prevention entry to `docs/operations-faq.md` so the next user
(and the Dify/RVF assistant that indexes it) gets the answer for free. The
assistant's failures are the corpus that improves the assistant. See
`docs/analysis/install-assistant-swot-2026-07.html` for the strategy.

## Prereqs & non-negotiables
- **Node 24** (OpenSSL 3.5 — native ML-KEM/ML-DSA). Docker + compose. Optional
  for the container round-trip: `cosign`, `syft`, `jq`.
- The lab is disposable — re-minting is `up.sh`-cheap; only *shared* identities
  need to persist. Reassure users that a wiped lab is a `./deploy/lab/up.sh`
  away.
- Working in the repo (building/testing/changing Dockerfiles) rather than
  installing? That's the **`fedmgr-dev`** skill and `docs/dev/gotchas.md`.
