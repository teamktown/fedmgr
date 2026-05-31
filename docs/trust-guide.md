# Trustworthy MCP — Step-by-Step Trust Guide

> **Audience**: This guide serves two tracks running in parallel:
>
> - **Org operator** (`letsfederate.org` or anyone running their own CA)
> - **Solo developer** wanting personal trustmarks on their own MCP servers
>
> Each section is labelled [ORG] or [DEV] where they diverge. Where both apply, steps are shared.
>
> **Principle: Say what we do, and do what we say.**
> The tooling in this repo is certified with its own trustmarks.
> This guide describes how to replicate that for any MCP server.

---

## Overview: What the Trust Stack Looks Like

```
                        ┌─────────────────────────────────────┐
                        │  Trust Anchor (TA)                  │
                        │  https://letsfederate.org           │  ← signs subordinate statements
                        │  OR: https://you.example.com        │
                        └──────────────┬──────────────────────┘
                                       │  subordinate statement (signed JWT)
                                       ▼
                        ┌─────────────────────────────────────┐
                        │  Trustmark Issuer (TMI)             │
                        │  https://tmi.letsfederate.org       │  ← issues signed trustmarks
                        │  OR: https://tmi.you.example.com    │
                        └──────────────┬──────────────────────┘
                                       │  trustmark JWS
                                       ▼
            ┌──────────────────────────┼────────────────────────────────┐
            │  Subject: any MCP server │  npm package │  container image│
            │  https://mymcp.example   │  @org/pkg    │  ghcr.io/...    │
            └──────────────────────────┴────────────────────────────────┘
```

**Verification path** (consumer verifies a trustmark):
1. Fetch trustmark JWS from the MCP server / npm / container attestation
2. Check `jku` header → fetch TMI JWKS → verify JWS signature
3. Fetch `iss` (TMI) entity statement → check `authority_hints`
4. Fetch TA's `federation_fetch?sub=<tmi>` → verify TA signed the subordinate statement
5. Fetch TA's own entity statement and confirm it is self-signed (iss=sub=ta-entity-id)
6. Trust is established: TA → TMI → subject

---

## Track A: Org Operator — Setting Up letsfederate.org (or Your Own CA)

### Step A1: Prerequisites

```bash
# Required tools
node --version    # >= 18
npm --version     # >= 9.5 (for provenance)
step --version    # https://smallstep.com/docs/step-cli/installation
cosign version    # https://docs.sigstore.dev/cosign/installation/
docker --version  # only needed for the compose lab

# Required: a domain you control with valid TLS
# Examples: letsfederate.org / tmi.letsfederate.org
#           OR: myorg.example.com / tmi.myorg.example.com (for personal CA)
```

**[DEV] Minimum viable setup** — you only need `node`, `step`, and a terminal.
No domain, no Docker. Everything runs on localhost. Pick this up at Step A3.

---

### Step A2: [ORG] DNS and TLS Setup

The TA and TMI entity IDs must be publicly accessible URLs with valid TLS.
The `/.well-known/openid-federation` path on each must return a JWT.

```
# DNS records needed:
A    letsfederate.org       → <your-server-ip>
A    tmi.letsfederate.org   → <your-server-ip>  (or same machine)

# TLS: Let's Encrypt is fine
certbot certonly --nginx -d letsfederate.org -d tmi.letsfederate.org
```

Nginx example config (reverse proxy to ta-server:8090 and tmi-server:8080):

```nginx
server {
    server_name letsfederate.org;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/letsfederate.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/letsfederate.org/privkey.pem;
    location / { proxy_pass http://127.0.0.1:8090; }
}

server {
    server_name tmi.letsfederate.org;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/letsfederate.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/letsfederate.org/privkey.pem;
    location / { proxy_pass http://127.0.0.1:8080; }
}
```

---

### Step A3: Generate TA Keys

The Trust Anchor needs an EC P-256 key pair. The private key is encrypted at rest (PBES2 JWE).

```bash
# [ORG] TA keys go in packages/ta-server/keys/
npm run ta:keys:init
# Prompts for a passphrase — store it in a password manager.
# Creates:
#   packages/ta-server/keys/ta.priv.jwe   ← encrypted private key (safe to commit)
#   packages/ta-server/keys/ta.pub.jwk    ← plaintext public key (safe to commit)

# [DEV] Same command — your personal TA key
npm run ta:keys:init
```

**Key policy enforced here:**
- The `.jwe` file is PBES2-encrypted — safe to store in git
- The decrypted `.jwk` must only ever exist on tmpfs at runtime
- `SoftKmsProvider` validates this at startup

---

### Step A4: Generate TMI Keys

```bash
# [ORG] TMI keys go in packages/tmi-server/keys/
npm run tmi:keys:init
# Creates:
#   packages/tmi-server/keys/tmi.priv.jwe
#   packages/tmi-server/keys/tmi.pub.jwk

# [DEV] Same command
npm run tmi:keys:init
```

---

### Step A5: Run the Local Trust Lab

The compose lab brings up everything you need to develop and test locally.

```bash
# Start the full trust lab (registry + ta-server + tmi-server)
npm run lab:up

# Services:
#   registry:2        :5000   local OCI registry
#   ta-server         :8090   Trust Anchor
#   tmi-server        :8080   Trustmark Issuer

# Verify:
curl http://localhost:8090/.well-known/openid-federation | step crypto jwt inspect --insecure
curl http://localhost:8080/.well-known/jwks.json
curl http://localhost:8080/health
```

**What happens when trust fails at startup:**

```
[ta-server] [TRUST:FAIL] JWKS fetch failed for https://tmi.example.com ...
  Recommended: Verify https://tmi.example.com is deployed ...
  To skip failed subordinates at startup: set TRUST_POLICY=permissive
```

This is the default `strict` policy. To start anyway for debugging:
```bash
TRUST_POLICY=permissive npm run lab:up
```

---

### Step A6: [ORG] Register the TMI as a Subordinate of the TA

Tell the TA about the TMI so it can issue signed subordinate statements:

```bash
# Option 1: env var (stateless, re-read at every startup)
export TA_SUBORDINATES='[
  {
    "entityId": "https://tmi.letsfederate.org",
    "jwksUrl":  "https://tmi.letsfederate.org/.well-known/jwks.json"
  }
]'

# Option 2: persistent JSON registry (survives restarts)
export TA_REGISTRY_PATH=/data/ta-registry.json
# The TA will create this file automatically on first registration.
```

Confirm the subordinate statement is being served:

```bash
curl "https://letsfederate.org/federation_fetch?sub=https://tmi.letsfederate.org" \
  | step crypto jwt inspect --insecure
# Look for: "iss": "https://letsfederate.org", "sub": "https://tmi.letsfederate.org"
```

---

### Step A7: [ORG] Configure authority_hints on the TMI

The TMI must advertise who its Trust Anchor is so chain verification works upward:

```bash
export TMI_AUTHORITY_HINTS='["https://letsfederate.org"]'
# Restart the TMI. The /.well-known/openid-federation response will now include:
# "authority_hints": ["https://letsfederate.org"]
```

---

## Track B: Certifying a Tool with a Trustmark

### Step B1: Issue a Trustmark for a Tool

Any MCP server, npm package, or container image can receive a trustmark.
The trustmark is a signed JWT that asserts the subject meets the quality bar.

```bash
# Issue a trustmark for a running MCP server:
fedmgr trustmark issue \
  --sub  https://mymcp.example.com \
  --id   https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1 \
  --tmi  https://tmi.letsfederate.org \
  --ttl  86400

# Output: compact JWS string — save this as TRUSTMARK_JWS

# Verify it immediately:
fedmgr trustmark verify --jws "$TRUSTMARK_JWS"
# ✔ Trustmark JWS verified
# {
#   "iss": "https://tmi.letsfederate.org",
#   "sub": "https://mymcp.example.com",
#   "id":  "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1",
#   ...
# }
```

---

### Step B2: Verify the Full OIDF Chain

```bash
# Check sub → TMI → TA chain all at once:
fedmgr trustmark check \
  --sub  https://mymcp.example.com \
  --ta   https://letsfederate.org \
  --jws  "$TRUSTMARK_JWS"

# Exit codes:
#   0 = VALID   (full chain verified)
#   1 = INVALID (fails; strict mode: do not proceed)
#   2 = WARN    (valid but advisory — check recommended action)

# Example VALID output:
# [TRUST:VALID] Trustmark verified — issuer=https://tmi.letsfederate.org sub=https://mymcp.example.com
# [TRUST:VALID] Full chain verified — https://tmi.letsfederate.org → https://letsfederate.org (1 hop)

# Example INVALID output:
# [TRUST:FAIL] Trustmark JWS signature verification FAILED — no key in JWKS at ...
#   Recommended: The signing key has been rotated or trustmark tampered. Re-issue...

# Example WARN output (expiring):
# [TRUST:WARN] Trustmark for https://mymcp.example.com expires in 300s (2026-03-17T06:00:00.000Z)
#   Recommended: Re-issue the trustmark before it expires...
```

---

### Step B3: Sign an npm Package with Provenance

npm provenance links the published tarball to the GitHub Actions run that produced it.
No key needed — uses Sigstore OIDC.

```json
// In each publishable package.json:
{
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

**In GitHub Actions:**

```yaml
- name: npm publish
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
    NPM_CONFIG_PROVENANCE: "true"
  # Requires: permissions.id-token: write
```

**Verify after publish:**
```bash
npm audit signatures
# @letsfederate/kms@1.0.0: Signed by:
#   Repository: teamktown/fedmgr
#   Workflow:   .github/workflows/release.yml
```

---

### Step B4: Build and Sign a Container Image

```bash
# 1. Build the image
docker build -t ghcr.io/teamktown/ta-server:1.0.0 -f Dockerfile.ta-server .

# 2. Push
docker push ghcr.io/teamktown/ta-server:1.0.0

# 3. Get digest
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' \
  ghcr.io/teamktown/ta-server:1.0.0 | cut -d@ -f2)

# 4. Sign with cosign (keyless — no key needed, uses OIDC)
cosign sign ghcr.io/teamktown/ta-server@${DIGEST}

# 5. Generate and attach SBOM
syft ghcr.io/teamktown/ta-server@${DIGEST} \
  -o cyclonedx-json \
  --file ta-server-sbom.json

cosign attest --type cyclonedx \
  --predicate ta-server-sbom.json \
  ghcr.io/teamktown/ta-server@${DIGEST}

# 6. Verify
cosign verify \
  ghcr.io/teamktown/ta-server@${DIGEST} \
  --certificate-identity-regexp "https://github.com/teamktown/fedmgr" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

---

### Step B5: Attach a Trustmark to a Container

This is the "eating our own dog food" step — the container is vouched for
through the same OIDF federation it manages.

```bash
# Issue the trustmark for the image:
TRUSTMARK_JWS=$(fedmgr trustmark issue \
  --sub  "ghcr.io/teamktown/ta-server@${DIGEST}" \
  --id   "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1" \
  --tmi  https://tmi.letsfederate.org \
  --image-digest "${DIGEST}" \
  --repo "https://github.com/teamktown/fedmgr")

# Attach it as a cosign attestation:
fedmgr oci attach-trustmark \
  --image "ghcr.io/teamktown/ta-server@${DIGEST}" \
  --jws   "$TRUSTMARK_JWS"

# Verify:
fedmgr oci verify-trustmark \
  --image "ghcr.io/teamktown/ta-server@${DIGEST}"
```

Complete verification chain (all three layers):
```bash
# 1. Cosign signature (workflow identity)
cosign verify ghcr.io/teamktown/ta-server@${DIGEST} \
  --certificate-identity-regexp "https://github.com/teamktown/fedmgr" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

# 2. SBOM (what's inside the image)
cosign verify-attestation --type cyclonedx \
  ghcr.io/teamktown/ta-server@${DIGEST} \
  --certificate-identity-regexp "https://github.com/teamktown/fedmgr" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

# 3. OIDF Trustmark (quality/compliance claim, chain back to TA)
fedmgr oci verify-trustmark \
  --image ghcr.io/teamktown/ta-server@${DIGEST}

fedmgr trustmark check \
  --sub "ghcr.io/teamktown/ta-server@${DIGEST}" \
  --ta  https://letsfederate.org
```

---

## Track C: Personal Trustmarks (Solo Developer)

A solo developer wants trustworthy MCPs with their own personal trustmark.
The workflow:
1. Run a personal TA + TMI on localhost (or personal domain)
2. Adopt existing public trustmarks (e.g. from letsfederate.org)
3. Issue your own trustmarks that reference the adopted ones
4. Configure your MCP client to enforce trust checks

---

### Step C1: Personal Trust Anchor and TMI (localhost)

```bash
# Clone and install
git clone https://github.com/teamktown/fedmgr
cd fedmgr && npm install && npm run build -ws --if-present

# Generate both key pairs
npm run ta:keys:init   # passphrase: use a strong one, store in password manager
npm run tmi:keys:init

# Start the local trust lab
npm run lab:up
# TA at  http://localhost:8090
# TMI at http://localhost:8080

# Register TMI as TA subordinate (required for chain verification)
export TA_SUBORDINATES='[{"entityId":"http://localhost:8080","jwksUrl":"http://localhost:8080/.well-known/jwks.json"}]'
# Restart the TA (or set env before starting lab:up)
```

---

### Step C2: Adopt an Existing Public Trustmark

"I trust letsfederate.org's assessment, and I want to endorse it with my own signature."

```bash
# Step 1: Get the existing trustmark from the tool's published trustmark
ORIGINAL_JWS="eyJ..."   # from npm package metadata, cosign attestation, or the tool's own endpoint

# Step 2: Validate it first
fedmgr trustmark verify --jws "$ORIGINAL_JWS"

# Step 3: Adopt — issue your own trustmark that cites the original
MY_TRUSTMARK=$(fedmgr trustmark adopt \
  --source  "$ORIGINAL_JWS" \
  --sub     https://mymcp.example.com \
  --tmi     http://localhost:8080 \
  --id      https://localhost:8090/trustmarks/personal/endorsed_v1)

# Output shows:
# [trustmark adopt] Validating source trustmark before adoption...
# [TRUST:VALID] Trustmark verified — issuer=https://tmi.letsfederate.org ...
# [TRUST:VALID] Adoption trustmark issued — sub=https://mymcp.example.com adopted_from=https://tmi.letsfederate.org
```

The adopted trustmark contains:
- `iss`: your TMI (`http://localhost:8080`)
- `sub`: the MCP server
- `adopted_from_iss`: `https://tmi.letsfederate.org` (the original issuer)
- `adopted_from_id`: the original trustmark type URI
- `adopted_from_jws`: the full original JWS embedded as evidence

Anyone verifying your trustmark can also check the embedded original — full provenance chain.

---

### Step C3: What Happens When Validation Fails

The system is **fail-secure** by default (`TRUST_POLICY=strict`).

#### Case 1: Expired trustmark

```bash
fedmgr trustmark check --sub https://expired-mcp.example.com --jws "$EXPIRED_JWS"
# [TRUST:FAIL] Trustmark expired at 2026-03-01T00:00:00.000Z — this trustmark is no longer valid
#   Recommended: Re-issue the trustmark: fedmgr trustmark issue --sub <url> --tmi <tmi-url>.
#                Consider reducing TTL and automating re-issuance before expiry.
# exit code 1
```

#### Case 2: Signature mismatch (key rotation or tampering)

```bash
fedmgr trustmark check --sub https://mcp.example.com --jws "$TAMPERED_JWS"
# [TRUST:FAIL] Trustmark JWS signature verification FAILED —
#              no key in JWKS at https://tmi.example.com/.well-known/jwks.json
#   Recommended: The signing key has either been rotated or the trustmark was tampered with.
#                Re-issue the trustmark: fedmgr trustmark issue --sub <url>
# exit code 1
```

#### Case 3: Chain broken (TMI not in TA's federation_list)

```bash
fedmgr trustmark check --sub https://mcp.example.com --ta https://letsfederate.org
# [TRUST:FAIL] Authority https://letsfederate.org has no subordinate statement for
#              https://tmi.example.com: federation_fetch returned HTTP 404
#   Recommended: Register https://tmi.example.com as a subordinate of https://letsfederate.org.
#                For the TA, set TA_SUBORDINATES or use TA_REGISTRY_PATH to add the TMI.
# exit code 1
```

#### Case 4: Expiring soon (WARN state)

```bash
fedmgr trustmark check --sub https://mcp.example.com --jws "$EXPIRING_SOON_JWS"
# [TRUST:WARN] Trustmark for https://mcp.example.com expires in 47s (2026-03-16T07:00:00.000Z)
#   Recommended: Re-issue the trustmark before it expires: fedmgr trustmark issue --sub <url>
# exit code 2
```

Exit code 2 = WARN means: valid for now, but action is needed.

---

### Step C4: Administrative Override (Permissive Mode)

When you need to run a tool that lacks a trustmark (e.g. internal dev tool, new deployment):

```bash
# Override trust enforcement for this session:
TRUST_POLICY=permissive fedmgr trustmark check --sub https://dev-mcp.example.com
# [TRUST:FAIL] ...
#   [TRUST:POLICY] Operating in permissive mode — proceeding despite trust failure.
#   Set TRUST_POLICY=strict to enforce trust validation.
```

**Permissive mode for server startup:**

```bash
# Start the TMI even if its own trustmark is invalid/missing:
TRUST_POLICY=permissive SELF_TRUSTMARK_JWS="" npm run tmi:dev
# [tmi-server] [TRUST:SKIP] SELF_TRUSTMARK_JWS not set — operating without self-attestation validation.
```

**Audit mode** — log everything, never block (useful for monitoring):

```bash
TRUST_POLICY=audit fedmgr trustmark check --sub https://any-mcp.example.com
# All trust events logged; exit 0 regardless of trust state
```

---

### Step C5: Configure a Server's Self-Trustmark

Once you have a trustmark JWS for the server itself, inject it at startup:

```bash
# tmi-server validates its own trustmark at startup:
SELF_TRUSTMARK_JWS="eyJ..." \
TRUST_POLICY=strict \
  node packages/tmi-server/dist/index.js

# Success:
# [tmi-server] Validating self-trustmark (SELF_TRUSTMARK_JWS)...
# [TRUST:VALID] Trustmark verified — issuer=https://tmi.letsfederate.org ...
# [tmi-server] listening on :8080  issuer=https://tmi.letsfederate.org  policy=strict

# Failure (strict mode):
# [TRUST:FAIL] Trustmark expired at ... — this trustmark is no longer valid
#   Recommended: Re-issue the trustmark...
# [tmi-server] [TRUST:FAIL] Startup aborted — self-trustmark validation failed under TRUST_POLICY=strict.
# exit code 78 (EX_CONFIG)
```

---

## Track D: At Scale — Production Operations

### Step D1: Trustmark Lifecycle Automation

Trustmarks expire. Automate re-issuance before expiry.

Add to cron or your deployment pipeline:

```bash
#!/usr/bin/env bash
# scripts/renew-trustmarks.sh
#
# Re-issues trustmarks for all registered subjects.
# Run 2h before expected expiry (set --ttl 3600 and cron every 50 minutes).

set -euo pipefail
TMI="${TMI_ISSUER:-https://tmi.letsfederate.org}"

while IFS= read -r subject; do
  [ -z "$subject" ] && continue
  JWS=$(fedmgr trustmark issue --sub "$subject" --tmi "$TMI")
  echo "$subject $JWS" >> /var/lib/fedmgr/trustmarks.db
  echo "[renew] Issued trustmark for $subject"
done < /etc/fedmgr/subjects.txt
```

### Step D2: SBOM Baseline and Daily Drift Detection

```bash
# Generate today's SBOM:
./scripts/sbom-diff.sh sbom-baseline.json sbom-today.json
# NEW:     express@5.0.0    ← review this addition
# Summary: 1 new, 0 removed
# exit 1 — trigger CI issue

# In daily-scan.yml (already configured):
# Opens a GitHub issue with the diff when new dependencies appear.
```

### Step D3: Revocation

To revoke a trustmark (e.g. compromise discovered):

```bash
# The TA marks the subject as revoked in the TrustMarkStatusRegistry.
# From ta-server:
curl -X POST http://localhost:8090/trust-mark-status \
  -H "Content-Type: application/json" \
  -d '{"sub":"https://compromised.example.com","id":"https://letsfederate.org/trustmarks/...","status":"revoked"}'

# Check revocation status:
curl "http://localhost:8090/trust-mark-status?sub=https://compromised.example.com&id=..."
# {"active": false}
```

### Step D4: Key Rotation

When rotating TA or TMI keys:

1. Generate new keys: `npm run tmi:keys:init --dir packages/tmi-server/keys/rotation-YYYY-MM-DD`
2. Deploy new keys to tmpfs: update `tmi-decrypt.sh` to use new JWE
3. Restart TMI — it serves new public key from JWKS endpoint
4. Re-issue all trustmarks (old signatures invalid against new key)
5. Retire old keys: remove old `.jwe` file

**TMI key rotation does NOT require TA re-registration** — the TA's subordinate statement
covers the TMI entity ID, not its key fingerprint. The TMI's JWKS endpoint is the source of truth.

### Step D5: Multi-TA Federation

For large organizations with multiple trust anchors:

```
root-ta.letsfederate.org
  ├── subordinate statement → intermediate-ta.org-A.example
  │     └── subordinate statement → tmi.org-A.example
  │           └── trustmarks for org-A tools
  └── subordinate statement → intermediate-ta.org-B.example
        └── subordinate statement → tmi.org-B.example
              └── trustmarks for org-B tools
```

Consumers at `root-ta.letsfederate.org` can verify any tool in the federation.
Each org manages its own TMI. The root TA only needs to know the intermediate TAs.

Configure intermediates in TA_SUBORDINATES with `fetchEndpoint`:

```json
[{
  "entityId": "https://intermediate-ta.org-A.example",
  "jwksUrl":  "https://intermediate-ta.org-A.example/.well-known/jwks.json",
  "fetchEndpoint": "https://intermediate-ta.org-A.example/federation_fetch"
}]
```

---

## Trust State Reference

All operations produce structured trust messages with a consistent prefix:

| Prefix | State | Exit code | Meaning |
|---|---|---|---|
| `[TRUST:VALID]` | `VALID` | 0 | Signature verified, not expired, chain rooted in TA |
| `[TRUST:WARN]` | `WARN` | 2 | Valid but advisory action needed (expiring soon, no chain, partial verification) |
| `[TRUST:FAIL]` | `INVALID` | 1 | Signature bad, expired, chain broken, or fetch error |
| `[TRUST:SKIP]` | — | 0 | No trustmark configured; state unknown |
| `[TRUST:POLICY]` | — | — | Policy applied (permissive/audit mode notice) |

### Reading error messages

Every `[TRUST:FAIL]` and `[TRUST:WARN]` message includes:
1. **What failed** — specific technical reason
2. **Recommended action** — concrete next step (always on the next line, prefixed `Recommended:`)

Example:
```
[TRUST:FAIL] JWKS fetch failed (https://tmi.letsfederate.org/.well-known/jwks.json): HTTP 503
  Recommended: The TMI JWKS endpoint is unreachable. Verify the TMI server is running
  at https://tmi.letsfederate.org. If the TMI URL has changed, re-issue the trustmark
  with the correct --tmi.
```

---

## Trust Policy Configuration Reference

Set `TRUST_POLICY` environment variable on any server or CLI invocation:

| Value | Server startup | CLI check | When to use |
|---|---|---|---|
| `strict` (default) | Exits 78 on `INVALID` | Exits 1 on `INVALID`, 2 on `WARN` | Production — enforce all trust |
| `permissive` | Warns on `INVALID`, continues | Warns, continues | Development, migration, initial deployment |
| `audit` | Logs all states, never exits | Logs all states, always exits 0 | Security monitoring, observability |

---

## Environment Variable Quick Reference

### tmi-server

| Variable | Default | Description |
|---|---|---|
| `TMI_ISSUER` | `http://localhost:8080` | Public URL of this TMI |
| `TMI_JWKS_URL` | derived from `TMI_ISSUER` | JWKS endpoint URL |
| `TMI_PUBLIC_JWK` | `keys/tmi.pub.jwk` | Path to public JWK |
| `TMI_PRIVATE_JWK` | `keys/tmi.priv.jwk` | Path to decrypted private JWK (tmpfs) |
| `TMI_AUTHORITY_HINTS` | `[]` | JSON array of TA entity IDs |
| `TRUST_POLICY` | `strict` | `strict` \| `permissive` \| `audit` |
| `SELF_TRUSTMARK_JWS` | unset | JWS of this TMI's own trustmark (validated at startup) |

### ta-server

| Variable | Default | Description |
|---|---|---|
| `TA_ENTITY_ID` | `http://localhost:8090` | Public URL of this TA |
| `TA_JWKS_URL` | derived from `TA_ENTITY_ID` | JWKS endpoint URL |
| `TA_PUBLIC_JWK` | `keys/ta.pub.jwk` | Path to public JWK |
| `TA_PRIVATE_JWK` | `keys/ta.priv.jwk` | Path to decrypted private JWK (tmpfs) |
| `TA_SUBORDINATES` | unset | JSON array of subordinate specs |
| `TA_REGISTRY_PATH` | unset | Path for persistent JSON registry |
| `TRUST_POLICY` | `strict` | `strict` \| `permissive` \| `audit` |

### fedmgr CLI trust commands

```bash
fedmgr trustmark check \
  --sub    <entity-id>   # subject to check
  --ta     <ta-url>      # expected trust anchor (default: https://letsfederate.org)
  --jws    <token>       # optional: also validate this JWS
  --policy <mode>        # strict | permissive | audit (default: strict)
  --json                 # output result as JSON

fedmgr trustmark adopt \
  --source <jws>         # existing trustmark to adopt
  --sub    <url>         # subject entity ID
  --tmi    <url>         # your TMI URL
  --id     <uri>         # your trustmark type URI
  --ttl    <seconds>     # token lifetime (default: 3600)
  --evidence <url>       # optional additional evidence

fedmgr trustmark issue  --sub ... --id ... --tmi ... --ttl ...
fedmgr trustmark verify --jws ...
fedmgr oci attach-trustmark --image ... --jws ...
fedmgr oci verify-trustmark --image ...
```

---

## FAQ

**Q: Can I use a self-signed cert for my personal TA?**
A: Yes for local/personal use. `fedmgr trustmark check` does not enforce TLS cert validity
during chain traversal. For public federation with others, use a CA-signed cert (Let's Encrypt).

**Q: How long should a trustmark TTL be?**
A: Depends on how often you assess the subject. For actively-developed tools: 24h–7d.
For stable, audited tools: up to 90d. Always automate renewal before expiry (Step D1).

**Q: What happens if my TMI goes down?**
A: Existing trustmarks remain valid until they expire. New issuance will fail.
JWKS caching (Cache-Control: 1h) means most verification succeeds for ~1h.
For long TTL trustmarks (7d+): JWKS should be cached or backed by a CDN.

**Q: Can a tool hold multiple trustmarks from different issuers?**
A: Yes. A container image can have multiple cosign attestations, each from a different TMI.
The `adopted_from_iss` / `adopted_from_id` claims chain them together.
Consumers can check any or all of them.

**Q: What's the difference between TRUST:WARN and TRUST:FAIL?**
A: WARN = structurally valid but requires attention (expiring, missing chain depth).
FAIL = invalid, execution should stop (signature bad, expired, chain broken).
In strict mode: WARN exits 2 (caller decides), FAIL exits 1 (always stop).

**Q: The server exits with code 78 at startup. What is that?**
A: Exit code 78 (`EX_CONFIG`) is the standard POSIX exit code for configuration errors.
`TRUST_POLICY=strict` + trust failure = EX_CONFIG. Check the `[TRUST:FAIL]` message above it.

**Q: I want to use my personal trustmark CA with my team. What do I need?**
A: Deploy your TA and TMI publicly (Steps A2-A7) on a domain your team trusts.
Have each team member set `--ta https://your-domain.example.com` in their `fedmgr trustmark check` calls.
Your TA entity statement is the trust root — share its entity ID as the "CA anchor" for your team.
