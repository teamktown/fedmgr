# RALPH Loop — Increment F: federation_list filters, FileSubordinateRegistry, SoftHSM2

> Status: **Complete**
> Branch: `feat/uplift-tdd`
> Commits: `508eec6`, `95c1fe5`

---

## R — Requirements

### F.1 `GET /federation_list` with filters and pagination (OIDF §8.3)

| Parameter | Type | Behaviour |
|---|---|---|
| `entity_type=intermediate` | string | Return only entities that have a `federation_fetch_endpoint` in metadata |
| `entity_type=leaf` | string | Return entities that do NOT have `federation_fetch_endpoint` |
| `limit=N` | integer | Truncate result to first N entries; ignored if ≤0 or non-integer |
| `after=<entityId>` | string | Cursor pagination: return entries after this entity ID; empty array if ID not found |

Parameters are composable: `?entity_type=intermediate&after=X&limit=2` applies in order:
filter → after → limit.

### F.2 `FileSubordinateRegistry` — persistent JSON-backed registry

- Activated by `TA_REGISTRY_PATH` env var (unset → in-memory `SubordinateRegistry` only)
- Persists the full registry to a JSON file on every `register()` and `remove()` call
- Reloads from file on construction (survives TA server restarts)
- Extends `SubordinateRegistry` (drop-in replacement, same interface)

### F.3 SoftHSM2 PKCS#11 integration tests

- 8 tests in `packages/kms/test/pkcs11.test.mjs` covering the full `Pkcs11Provider` lifecycle
- All tests skip unless `SOFTHSM2_MODULE` env var is set
- Run natively (not via Docker) due to overlayfs constraint in devcontainer environments

### F.4 Test result persistence

- `scripts/test-report.sh` — dual reporter (spec to stdout + JUnit XML to `test-results/`)
- `test-results/` directory tracked in git; generated files (`.xml`, `.log`) gitignored
- HSM tests included in report when `SOFTHSM2_MODULE` is set

---

## A — Architecture

### federation_list filters

```
GET /federation_list?entity_type=intermediate&after=<id>&limit=N

packages/ta-server/src/index.ts
  ↓
  registry.listEntityIds()              // ordered array
  ↓ filter by entity_type (optional)    // isIntermediate() from subordinate-statements.ts
  ↓ cursor: slice after `after` id
  ↓ truncate to `limit`
  → JSON array of entity IDs
```

`isIntermediate(entry)` returns true iff `entry.metadata?.federation_entity?.federation_fetch_endpoint` is truthy.

### FileSubordinateRegistry

```
packages/ta-server/src/federation/
  subordinate-statements.ts    ← SubordinateRegistry base (entries: protected Map)
  file-registry.ts             ← FileSubordinateRegistry extends SubordinateRegistry

FileSubordinateRegistry
  constructor(filePath)
    _load() — readFileSync → JSON.parse → super.register() per entry
  register(entry) override
    super.register(entry) → _save()
  remove(entityId): boolean
    this.entries.delete(entityId) → _save()
  _save()
    mkdirSync(dirname, {recursive: true})
    writeFileSync(filePath, JSON.stringify([...this.entries.values()], null, 2))
```

### Pkcs11Provider (completed in Increment E, tested in Increment F)

```
packages/kms/src/providers/pkcs11.ts

signJwt(payload, header):
  1. buildSigningInput(payload, header) → "<header_b64>.<payload_b64>"
  2. createHash("sha256").update(signingInput).digest() → hash (Buffer)
  3. _pkcs11Sign(hash):
       C_SignInit(session, { mechanism: CKM_ECDSA=0x1041 }, privateKeyHandle)
       C_Sign(session, hash, Buffer.allocUnsafe(128)) → raw R||S (64 bytes)
  4. rawSig.toString("base64url") → sigB64
  5. return `${signingInput}.${sigB64}`

_initPkcs11():
  C_Initialize() — catch code 401 (already initialized)
  C_OpenSession(slot, CKF_SERIAL_SESSION | CKF_RW_SESSION)
  C_Login(session, CKU_USER, pin) — catch code 256 (already logged in)
  C_FindObjectsInit(session, [{type:CKA_CLASS, value:3}, {type:CKA_LABEL, value:label}])
  C_FindObjects → privateKeyHandle
  C_FindObjectsFinal
```

---

## L — List of Tests

### New test files (Increment F)

| File | Tests | Description |
|---|---|---|
| `packages/ta-server/test/federation-list.test.mjs` | 11 | `/federation_list` HTTP — empty, all, entity_type filter, limit, after cursor, combinations |
| `packages/ta-server/test/file-registry.test.mjs` | 8 | `FileSubordinateRegistry` — persist, reload, accumulate, remove, metadata round-trip, two paths |
| `packages/kms/test/pkcs11.test.mjs` | 8 | `Pkcs11Provider` — kid, jwks (no `d`), sign, header alg/kid, JWS verify; skip if no SoftHSM2 |

### Full test suite status (post Increment F)

| Package | File | Tests | Pass | Skip |
|---|---|---|---|---|
| `kms` | `softkms.test.mjs` | 7 | 7 | 0 |
| `kms` | `pkcs11.test.mjs` | 8 | 8* | 8 |
| `ta-server` | `ta-server.test.mjs` | 13 | 13 | 0 |
| `ta-server` | `trust-mark-status.test.mjs` | 8 | 8 | 0 |
| `ta-server` | `chain-verifier.test.mjs` | 8 | 8 | 0 |
| `ta-server` | `intermediates.test.mjs` | 6 | 6 | 0 |
| `ta-server` | `federation-list.test.mjs` | 11 | 11 | 0 |
| `ta-server` | `file-registry.test.mjs` | 8 | 8 | 0 |
| **Total** | | **69** | **69** | **8\*** |

\* With `SOFTHSM2_MODULE`; else all 8 skip.

---

## P — Problems Encountered and Fixed

### P.1 Docker overlayfs in devcontainer

**Problem:** `docker compose up` fails with `mount source: "overlay", fstype: overlay, err: invalid argument`.
All container launches fail — even trivial ones like `docker run node:22-slim echo test`.

**Root cause:** Docker uses overlayfs storage driver; the devcontainer host is already on overlayfs.
Nested overlay mounts require `userxattr` kernel option or a different storage driver (`vfs`, `fuse-overlayfs`).
Restarting the Docker daemon to change storage driver would destroy all existing images and containers.

**Resolution:** Pivot to native SoftHSM2 (`sudo apt-get install -y softhsm2 opensc`).
Proved more productive — ran tests directly, surfaced 7 real bugs in `Pkcs11Provider`.
See Decision 5.

### P.2 `CKO_PUBLIC_KEY` was `3` (should be `2`)

`CKO_PRIVATE_KEY = 3`, `CKO_PUBLIC_KEY = 2`. The constant was wrong, causing public key search to find nothing.
Fix: `private readonly CKO_PUBLIC_KEY = 2`.

### P.3 `C_FindObjectsInit` Buffer attribute format

pkcs11js expects plain numbers and strings, not Buffers, for numeric CKA_CLASS values.
`Buffer.from([0,0,0,2])` was silently misinterpreted. Fix: use `{ type: CKA_CLASS, value: 2 }`.

### P.4 `CKR_CRYPTOKI_ALREADY_INITIALIZED` (code 401)

Each test creates a fresh `Pkcs11Provider` which calls `C_Initialize()`.
Fix: wrap `C_Initialize()` in try/catch; continue if code is 401.

### P.5 `CKR_USER_ALREADY_LOGGED_IN` (code 256)

Token login state is shared across all sessions in a process.
Fix: wrap `C_Login()` in try/catch; continue if code is 256.

### P.6 `C_Sign` requires 3 arguments

pkcs11js `C_Sign` signature is `(session, data, outputBuffer)`.
`pkcs11.C_Sign(session, data)` throws `Expected 3 arguments, but received 2`.
Fix: `p11.C_Sign(this._session, data, Buffer.allocUnsafe(128))`.

### P.7 `CKM_ECDSA_SHA256` not supported by SoftHSM2 2.6.1

SoftHSM2 only advertises `CKM_ECDSA` (raw hash input), not `CKM_ECDSA_SHA256`.
`0x1043` throws `CKR_MECHANISM_INVALID`.
Fix: use `CKM_ECDSA = 0x00001041`; pre-hash the signing input with SHA-256 in application code.

### P.8 DER conversion applied to raw R||S output

`CKM_ECDSA` returns raw R||S (64 bytes for P-256), not DER. The existing `derEcdsaToRaw()` helper
expected a DER SEQUENCE and threw `ECDSA DER: expected SEQUENCE tag`.
Fix: removed DER conversion; raw output is ready for base64url encoding directly.

### P.9 `kms` factory function: `Cannot find name 'Pkcs11Provider'`

`packages/kms/src/index.ts` re-exported `Pkcs11Provider` but the factory function couldn't reference it.
TypeScript re-exports are not local bindings.
Fix: added a local `import { Pkcs11Provider, type Pkcs11Config }` alongside the re-export line.

---

## H — How to Run

```bash
# Standard package tests (no HSM):
./scripts/test-report.sh

# With HSM integration (after one-time setup — see docs/testing.md §4.2):
SOFTHSM2_CONF=/tmp/softhsm2.conf \
SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
PKCS11_PIN=testpin \
PKCS11_KEY_LABEL=kms-test-key \
  ./scripts/test-report.sh

# Results:
cat test-results/summary.log
cat test-results/ta-server.log
cat test-results/kms-hsm.log   # only when HSM run
```

---

## Remaining Work (Increment G+)

| Item | Notes |
|---|---|
| Increment F — CI/CD | GitHub Actions: test matrix (Node 22/24/26), semantic-release, npm publish |
| Intermediate entity support (full) | `federation_fetch_endpoint` propagation through chain |
| Trust mark status revocation | `/trust-mark-status` revocation list management |
| YubiKey PIV provider | `Pkcs11Provider` tested against real hardware |
| Cloud KMS provider | AWS KMS / GCP KMS via PKCS#11 bridge or native SDK |
