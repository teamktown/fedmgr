# Increment B — `fedmgr` Commands

**RALPH phase:** Actions + Lints/Tests
**Status:** ✅ Complete
**Branch:** `feat/uplift-tdd`

---

## What Was Built

A typed CLI package (`@letsfederate/fedmgr`) wiring together the full
key → trustmark → OCI attestation workflow.

```
packages/fedmgr/
├── src/
│   ├── bin.ts                    # shebang entry point
│   ├── index.ts                  # commander root + command registration
│   └── commands/
│       ├── keys.ts               # keys init softkms
│       ├── trustmark.ts          # trustmark issue / verify
│       └── oci.ts                # oci attach-trustmark / verify-trustmark
└── test/
    └── cli.test.mjs              # 8 structural unit tests
```

---

## Commands

### `fedmgr keys init softkms`

```bash
fedmgr keys init softkms [--dir <path>] [--force]
```

Generates an encrypted EC P-256 JWK pair using step CLI:
- Creates `<dir>/.pass` (random 32-byte passphrase, chmod 600)
- Calls `step crypto jwk create` with `--password-file` — private key is
  PBES2-encrypted at rest
- chmod 600 on both `.pass` and `tmi.priv.jwe` after creation
- Fails with clear error if `step` not in PATH

### `fedmgr trustmark issue`

```bash
fedmgr trustmark issue \
  --sub https://entities.example.org/mcp/demo \
  [--id <trustmark-type-url>] \
  [--tmi http://localhost:8080] \
  [--ttl 3600] \
  [--image-digest sha256:<hex>] \
  [--repo <url>] \
  [--evidence <url>] \
  [--json]
```

POSTs to `<tmi>/trustmarks/issue` and prints the compact JWS (or full JSON
with `--json`). Default trustmark type:
`https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1`

### `fedmgr trustmark verify`

```bash
fedmgr trustmark verify --jws <compact-jws> [--jwks <url>]
```

Decodes the `jku` header from the JWS, fetches the JWKS, and verifies the
signature. Exits 0 on success, 1 on failure.

### `fedmgr oci attach-trustmark`

```bash
fedmgr oci attach-trustmark \
  --image localhost:5000/myapp:latest \
  --jws <compact-jws> \
  [--type <predicate-uri>] \
  [--allow-insecure-registry]
```

Wraps `cosign attest --type <uri> --predicate <tmpfile>`. The predicate JSON
is written to a `mkdtemp` directory and cleaned up on exit.

### `fedmgr oci verify-trustmark`

```bash
fedmgr oci verify-trustmark \
  --image localhost:5000/myapp:latest \
  [--type <predicate-uri>] \
  [--allow-insecure-registry]
```

Wraps `cosign verify-attestation` for the trustmark predicate type.

---

## Full Local Round-Trip

```bash
# 1. Generate keys
fedmgr keys init softkms

# 2. Start the lab
docker compose -f examples/lab/docker-compose.yml up -d

# 3. Issue a trustmark
JWS=$(fedmgr trustmark issue --sub https://entities.example.org/mcp/demo)

# 4. Verify the JWS
fedmgr trustmark verify --jws "$JWS"

# 5. Push an image to local registry
docker pull alpine:latest
docker tag alpine:latest localhost:5000/demo:latest
docker push localhost:5000/demo:latest

# 6. Attach trustmark as attestation
fedmgr oci attach-trustmark \
  --image localhost:5000/demo:latest \
  --jws "$JWS" \
  --allow-insecure-registry

# 7. Verify the attestation
fedmgr oci verify-trustmark \
  --image localhost:5000/demo:latest \
  --allow-insecure-registry
```

---

## Tests

```
✔ program has correct name and version
✔ program registers keys command
✔ program registers trustmark command
✔ program registers oci command
✔ keys command has 'init' subcommand with 'softkms'
✔ trustmark command has 'issue' and 'verify' subcommands
✔ oci command has 'attach-trustmark' and 'verify-trustmark' subcommands
✔ trustmark issue --sub is required
8/8 pass  0 fail
```

---

## Cumulative test count across all packages

| Package | Tests | Pass |
|---|---|---|
| `@letsfederate/kms` | 7 | 7 |
| `@letsfederate/fedmgr` | 8 | 8 |
| **Total** | **15** | **15** |

---

## Next: Increment C

OIDF Federation scaffolding:
- Static entity statements (TA + TMI) as signed JWTs
- `/.well-known/openid-federation` endpoints
- `scripts/oidf-cert.sh` — run the official federation test harness container
