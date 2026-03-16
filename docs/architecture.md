# fedmgr Architecture

> **Supersedes** `architecture-april2025.md`.
> Last updated: feat/uplift-tdd, Increment C.
> Source of truth: `plans/arch-prd-chatgpt-candidate-20250620.md` +
> `plans/arch-codereview-20250620.md`.

---

## 1. What fedmgr Is

`fedmgr` is an OpenID Federation 1.0 orchestration toolkit for MCP (Model Context Protocol) server deployments. It enables:

- **Trust establishment**: A Trust Anchor (TA) vouches for MCP servers and Trustmark Issuers via signed entity statements
- **Trustmark issuance**: The TMI server mints JWS trustmarks asserting assessed quality, compliance, or capability claims
- **OCI attestation**: Trustmarks are attached to container images as cosign attestations
- **CLI tooling**: `fedmgr` CLI manages the full key → trustmark → attestation lifecycle

---

## 2. Monorepo Layout

```
fedmgr/
├── packages/
│   ├── kms/             @letsfederate/kms           — KMS interface + SoftKMS provider
│   ├── tmi-server/      @letsfederate/tmi-server     — Trustmark Issuer HTTP service
│   ├── ta-server/       @letsfederate/ta-server      — Trust Anchor HTTP service
│   └── fedmgr-cli/      @letsfederate/fedmgr-cli     — CLI (keys/trustmark/oci)
│
├── src/                 Legacy CommonJS code (pre-uplift, to be migrated)
│   ├── fedmgr/          — existing federation manager
│   └── mcp-core/        — existing MCP core runtime
│
├── examples/
│   └── lab/             — Local trust lab (registry:2 + ta-server + tmi-server)
│
├── scripts/
│   ├── tmi-keys-init.sh — Generate encrypted JWK pair via step CLI (reused for TA)
│   ├── tmi-decrypt.sh   — Decrypt JWE → tmpfs; wipe on EXIT
│   └── oidf-cert.sh     — OIDF conformance test harness runner
│
├── Dockerfile.tmi-server — Multi-stage build for tmi-server
├── Dockerfile.ta-server  — Multi-stage build for ta-server
├── docs/
│   ├── architecture.md         — This file
│   ├── decisions.md            — Locked architecture decisions
│   ├── extending-trustmarks.md — How to add trustmark types/fields
│   └── ralph-loop/             — Per-increment RALPH docs
└── tsconfig.base.json   — Shared TS composite config
```

---

## 3. Key Components

### 3.1 `@letsfederate/kms` — KMS Interface

```
KeyProvider (interface)
├── kid(): Promise<string>
├── jwks(): Promise<{ keys: JWK[] }>       ← public only, no `d` field
└── signJwt(payload, header): Promise<string>

SoftKmsProvider (implements KeyProvider)
├── Reads: privateJwkPath (decrypted, on tmpfs at runtime)
├── Reads: publicJwkPath  (plaintext, bind-mount)
├── Validates: EC P-256 only (fails fast on wrong key type)
└── Signs: ES256 via jose

Pkcs11Provider (stub — Increment D)
└── Throws: "not yet implemented"
```

**Key policy:**
- Private key encrypted at rest as PBES2 JWE (`step crypto jwk create`)
- Decrypted only into tmpfs (`/dev/shm` or Docker `type: tmpfs` volume)
- `SoftKmsProvider` never writes key material
- `jwks()` strips `d` before returning

### 3.2 `@letsfederate/ta-server` — Trust Anchor

```
Endpoints:
  GET  /.well-known/openid-federation           — self-signed TA entity statement JWT
  GET  /.well-known/jwks.json                   — TA public JWKS
  GET  /federation_list                         — JSON array of subordinate entity IDs
  GET  /federation_fetch?sub=<entityId>         — signed subordinate statement JWT
  GET  /trust-mark-status                       — stub (501 until Increment E)
  GET  /health                                  — liveness + subordinate count

SubordinateRegistry (in-memory):
  Populated at startup from TA_SUBORDINATES env var (JSON array of {entityId, jwksUrl})
  TA fetches each subordinate's JWKS and caches it
  Fail-fast if any JWKS fetch fails at startup
```

### 3.3 `@letsfederate/tmi-server` — Trustmark Issuer

```
Endpoints:
  GET  /.well-known/jwks.json            ← public JWKS (Cache-Control: 1h)
  GET  /.well-known/openid-federation    ← self-signed entity statement JWT
  POST /trustmarks/issue                 ← mint signed trustmark JWS
  GET  /health                           ← liveness check

Trustmark payload:
  { iss, sub, id, iat, exp, jku, image_digest?, repo?, evidence? }

Entity statement payload:
  { iss, sub, iat, exp, jwks, metadata.federation_entity, authority_hints? }
```

**Content-Type**: `application/entity-statement+jwt` (OIDF spec §4.3)

### 3.4 `@letsfederate/fedmgr-cli` — CLI

```
fedmgr keys init softkms [--dir] [--force]
  → step crypto jwk create (encrypted JWK pair)

fedmgr trustmark issue --sub <url> [--id] [--tmi] [--ttl] [--image-digest] ...
  → POST /trustmarks/issue → compact JWS

fedmgr trustmark verify --jws <token> [--jwks <url>]
  → fetch jku JWKS → jwtVerify → exit 0/1

fedmgr oci attach-trustmark --image <ref> --jws <token>
  → cosign attest --type <predicate-uri> --predicate <tmpfile>

fedmgr oci verify-trustmark --image <ref>
  → cosign verify-attestation --type <predicate-uri>
```

---

## 4. Local Trust Lab

```bash
npm run ta:keys:init   # generate TA keys (one-time)
npm run tmi:keys:init  # generate TMI keys (one-time)
npm run lab:up         # docker compose up --build

Services:
  registry:2   :5000  — local OCI registry
  ta-decrypt   (sidecar) — decrypts TA JWE → ta-secrets tmpfs, exits
  tmi-decrypt  (sidecar) — decrypts TMI JWE → tmi-secrets tmpfs, exits
  tmi-server   :8080  — starts after tmi-decrypt completes
  ta-server    :8090  — starts after ta-decrypt completes AND tmi-server healthy
```

**Key flow in Docker:**
```
packages/ta-server/keys/
  ta.priv.jwe (PBES2)  ──→ ta-decrypt ──→ /run/secrets/ta.priv.jwk  (RAM only)
  ta.pub.jwk  (plain)  ──→ bind-mount :ro → /app/keys/ta.pub.jwk

packages/tmi-server/keys/
  tmi.priv.jwe (PBES2) ──→ tmi-decrypt ──→ /run/secrets/tmi.priv.jwk (RAM only)
  tmi.pub.jwk  (plain) ──→ bind-mount :ro → /app/keys/tmi.pub.jwk
```

**Startup dependency order:**
```
ta-decrypt(exit:0) ─┐
tmi-decrypt(exit:0)─┼─→ tmi-server(:8080 healthy) ─→ ta-server(:8090)
                    └─────────────────────────────────────────────────
```

---

## 5. OIDF Federation Trust Model

```
Trust Anchor (letsfederate.org)      [Increment D]
  └── subordinate statement for TMI
        └── Trust Mark Issuer (tmi-server)
              ├── /.well-known/openid-federation  (self-signed entity statement)
              ├── /.well-known/jwks.json           (public JWKS)
              └── /trustmarks/issue               (signed trustmark JWS)
                        └── attached to OCI image via cosign attest
```

**OIDF compliance checklist:**

| Requirement | Status |
|---|---|
| Signed entity configurations (application/entity-statement+jwt) | ✅ |
| `exp` claim in entity statements | ✅ |
| `jwks` in entity statement payload (pub only) | ✅ |
| `metadata.federation_entity` block | ✅ |
| `authority_hints` for non-TA entities | ✅ |
| `federation_list_endpoint` (TA) | ✅ |
| `federation_fetch_endpoint` (TA) | ✅ |
| TA vouches for TMI via subordinate statement | ✅ |
| Intermediate entity support | ⏳ Increment E |
| Full trust chain verification (every link) | ⏳ Increment E |
| Trust mark status endpoint | ⏳ Increment E |

---

## 6. Security Properties

| Property | Mechanism |
|---|---|
| No naked private keys on disk | PBES2 JWE (step CLI) |
| Key only in RAM at runtime | tmpfs (`/dev/shm` or Docker `type:tmpfs`) |
| Key wiped on process exit | `trap cleanup EXIT` in `tmi-decrypt.sh` |
| Startup validation | `TMI_ISSUER`, `TMI_JWKS_URL` validated before `app.listen()` |
| JWKS never includes private `d` | `SoftKmsProvider.jwks()` strips `d` |
| `x-powered-by` header removed | `app.disable('x-powered-by')` |
| Non-root container user | `tmi` user (uid created in Dockerfile) |

---

## 7. Testing

```
npm test -ws --if-present

Package                   Tests   Pass
@letsfederate/kms           7      7    (SoftKMS sign, JWKS safety, kid continuity)
@letsfederate/fedmgr-cli    8      8    (command structure, --sub required)
@letsfederate/tmi-server   10     10    (entity statement claims, typ, exp>iat, authority_hints)
@letsfederate/ta-server    12     12    (subordinate registry, federation_fetch signing, chain verify)
─────────────────────────────────────
Total                      37     37
```

See also: `docs/ralph-loop/` for per-increment test details.

---

## 8. Roadmap

| Increment | Status | Description |
|---|---|---|
| 1 — KMS + TMI | ✅ | KeyProvider interface, SoftKmsProvider, tmi-server JWKS + issue |
| A — Docker | ✅ | Multi-stage Dockerfile, tmpfs compose lab, registry:2 |
| B — CLI | ✅ | `fedmgr keys init softkms`, `trustmark issue/verify`, `oci attach/verify` |
| C — OIDF scaffolding | ✅ | Entity statements, `/.well-known/openid-federation`, oidf-cert.sh |
| D — Trust Anchor | ✅ | TA entity config, `federation_list`, `federation_fetch`, ta-server in compose |
| E — Full chain + PKCS#11 | ⏳ | Trust chain verification (every link), intermediate entities, SoftHSM2 |
| F — CI/CD publish | ⏳ | GitHub Actions: test matrix, semantic-release, npm publish |
