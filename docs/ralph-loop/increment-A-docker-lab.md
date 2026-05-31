# Increment A — Docker + Local Trust Lab

**RALPH phase:** Architecture + Actions
**Status:** ✅ Complete
**Branch:** `feat/uplift-tdd`

---

## What Was Built

A reproducible local trust lab using Docker Compose with a hard "no naked keys" policy:

```
examples/lab/
├── docker-compose.yml   # registry:2 + tmi-decrypt sidecar + tmi-server
└── .env.example         # override TMI_ISSUER and TMI_JWKS_URL

Dockerfile.tmi-server    # multi-stage: builder (tsc) → slim runtime
```

### Key Policy (enforced by Docker setup)

| Key material | Where it lives | How |
|---|---|---|
| `tmi.priv.jwe` | Host filesystem | PBES2-encrypted; never in image |
| `tmi.priv.jwk` (decrypted) | In-container tmpfs only | `tmi-secrets` Docker volume (`type: tmpfs`) |
| `tmi.pub.jwk` | Host filesystem (plaintext) | Bind-mounted read-only |

Private key material never appears in:
- Any Docker image layer
- Any bind-mounted directory
- Any persistent volume

### Services

| Service | Port | Purpose |
|---|---|---|
| `registry` | 5000 | Local OCI registry for push/pull during attestation testing |
| `tmi-decrypt` | — | One-shot sidecar: decrypts JWE → tmpfs, then exits |
| `tmi-server` | 8080 | Trustmark Issuer; starts only after decrypt completes |

### Startup sequence enforced by Compose

```
tmi-decrypt runs → writes /run/secrets/tmi.priv.jwk to tmpfs → exits
                 ↓ condition: service_completed_successfully
tmi-server starts → reads key from tmpfs → serves JWKS + issue endpoint
```

---

## How to Run

```bash
# 1. Generate encrypted keys (one-time per environment)
npm run tmi:keys:init

# 2. Start the lab
docker compose -f examples/lab/docker-compose.yml up --build

# 3. Verify TMI is healthy
curl http://localhost:8080/health
# → {"status":"ok","issuer":"http://localhost:8080"}

# 4. Get the JWKS
curl http://localhost:8080/.well-known/jwks.json

# 5. Issue a trustmark
curl -s -X POST http://localhost:8080/trustmarks/issue \
  -H "Content-Type: application/json" \
  -d '{
    "sub": "https://entities.example.org/mcp/demo",
    "trustmark_id": "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1"
  }' | jq .
```

---

## Dockerfile design notes

- Multi-stage build: `builder` (Node 20 + tsc) → `runtime` (Node 20 slim, no devDeps, no source)
- Runtime image runs as non-root user `tmi` (uid created in Dockerfile)
- `HEALTHCHECK` uses Node's built-in `fetch` (Node 18+) — no curl dependency in image
- `TMI_PRIVATE_JWK` defaults to `/run/secrets/tmi.priv.jwk` — the tmpfs mount point

---

## Tests verified at this increment

```
npm test -w @letsfederate/kms    # 7/7 pass (from Increment 1)
npm run build                    # both packages build clean
docker compose config            # validates compose syntax
```

---

## Next: Increment B

Add `fedmgr-cli` commands:
- `fedmgr keys init softkms`
- `fedmgr trustmark issue`
- `fedmgr oci attach-trustmark`
