# Increment D — Trust Anchor Server

**RALPH phase:** Actions + Lints/Tests + Plan
**Status:** ✅ Complete
**Branch:** `feat/uplift-tdd`

---

## What Was Built

A full Trust Anchor HTTP service (`@letsfederate/ta-server`) implementing the
OIDF federation authority role.

```
packages/ta-server/
├── src/
│   ├── index.ts                              # Express TA server (4 endpoints)
│   └── federation/
│       ├── entity-statements.ts              # (shared) signEntityStatement etc.
│       └── subordinate-statements.ts         # SubordinateRegistry + signSubordinateStatement
├── test/
│   └── ta-server.test.mjs                    # 12 unit tests
└── keys/.gitkeep                             # keys dir (content gitignored)

Dockerfile.ta-server                          # multi-stage, non-root ta user
examples/lab/docker-compose.yml              # +ta-decrypt sidecar, +ta-server
```

---

## New Endpoints

### `GET /.well-known/openid-federation`
Self-signed TA entity statement JWT.
- `Content-Type: application/entity-statement+jwt`
- Payload: `iss=sub=TA_ENTITY_ID`, jwks, metadata with `federation_fetch_endpoint`, `federation_list_endpoint`, `federation_trust_mark_status_endpoint`

### `GET /.well-known/jwks.json`
TA public JWKS. `Cache-Control: public, max-age=3600`.

### `GET /federation_list`
Returns a JSON array of subordinate entity IDs (spec §8.3).
```json
["http://localhost:8080"]
```

### `GET /federation_fetch?sub=<entityId>`
Returns a signed subordinate statement JWT (spec §8.1).
- `Content-Type: application/entity-statement+jwt`
- `iss` = TA, `sub` = subordinate entity ID
- `jwks` = subordinate's public JWKS (fetched at startup)
- 404 JSON error for unknown subjects (not HTML)

### `GET /trust-mark-status`
Stub — returns 501. Implemented in Increment E.

### `GET /health`
`{ status: "ok", entity_id, subordinates: N }`

---

## SubordinateRegistry

The TA maintains an in-memory registry populated at startup from `TA_SUBORDINATES` env var:

```bash
export TA_SUBORDINATES='[
  {"entityId":"http://localhost:8080","jwksUrl":"http://localhost:8080/.well-known/jwks.json"}
]'
```

At startup, the TA fetches each subordinate's JWKS and caches it. If a fetch fails, startup aborts (fail-fast — no partial trust chains).

---

## Full Lab Startup Order

```
ta-decrypt  ──✓──→  ta-secrets tmpfs populated
tmi-decrypt ──✓──→  tmi-secrets tmpfs populated
tmi-server  ──healthy──→  serving JWKS on :8080
ta-server   ──depends_on tmi-server(healthy)──→  fetches TMI JWKS → serving on :8090

registry ──→  OCI registry on :5000 (independent)
```

---

## Quick-start

```bash
# Generate keys for TA and TMI (one-time)
npm run ta:keys:init
npm run tmi:keys:init

# Start the full lab
npm run lab:up

# Check TA health
curl http://localhost:8090/health

# List TA subordinates
curl http://localhost:8090/federation_list

# Fetch subordinate statement for TMI
curl -s http://localhost:8090/federation_fetch?sub=http://localhost:8080 \
  | cut -d. -f2 | base64 -d | python3 -m json.tool

# Full round-trip
JWS=$(fedmgr trustmark issue --sub http://localhost:8080)
fedmgr trustmark verify --jws "$JWS"
```

---

## Tests

```
✔ registry: empty list when no entries
✔ registry: register() and listEntityIds()
✔ registry: get() returns registered entry
✔ registry: has() returns true for registered, false for unknown
✔ subordinate statement is a valid 3-part JWS
✔ header typ is entity-statement+jwt
✔ iss = TA entity ID, sub = subordinate entity ID
✔ exp > iat
✔ jwks present in payload, no private `d` field
✔ verifies against TA public key (end-to-end signature check)
✔ metadata included in payload when provided
✔ metadata absent when not provided
12/12 pass  0 fail
```

---

## Cumulative test count

| Package | Tests | Pass |
|---|---|---|
| `@letsfederate/kms` | 7 | 7 |
| `@letsfederate/fedmgr-cli` | 8 | 8 |
| `@letsfederate/tmi-server` | 10 | 10 |
| `@letsfederate/ta-server` | 12 | 12 |
| **Total** | **37** | **37** |

---

## Next: Increment E

- Full trust chain verification (every link, not just first hop)
- Intermediate entity support
- `Pkcs11Provider` with SoftHSM2 (→ YubiKey → Cloud KMS)
- Trust mark status endpoint (active/inactive/expired)
