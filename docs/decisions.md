# Architecture Decisions

Locked decisions for the `feat/uplift-tdd` implementation.
Update this file when a decision is revisited or superseded.

---

## Decision 1 — KMS Provider Order

**Status:** Accepted
**Date:** Increment D

**Decision:**
KMS provider implementation order:
1. **SoftKMS** (default for dev/test) — `step` CLI encrypted JWK, PBES2 at rest
2. **PKCS#11 + SoftHSM2** — local HSM emulation
3. **PKCS#11 + YubiKey (PIV)** — hardware key for staging/on-prem
4. **Cloud KMS** — AWS KMS / GCP KMS / Azure Key Vault (for production)

**Rationale:**
- SoftKMS unblocks local development immediately with zero hardware dependency
- SoftHSM2 validates the PKCS#11 abstraction layer before any hardware cost
- YubiKey covers the on-prem operator use case before committing to cloud
- Cloud KMS comes last — most powerful but introduces external dependencies

**Implementation files:**
- `packages/kms/src/index.ts` — `KeyProvider` interface, `SoftKmsProvider`, `Pkcs11Provider` (stub)
- `packages/kms/src/providers/pkcs11.ts` — to be created in Increment E
- `scripts/tmi-keys-init.sh` — SoftKMS key generation

---

## Decision 2 — SoftKMS for All Dev/Test Environments

**Status:** Accepted
**Date:** Increment D

**Decision:**
All local development and CI test runs use SoftKMS only.
PKCS#11 providers are not required for `npm test` to pass.

**Rationale:**
- `Pkcs11Provider` constructor throws "not yet implemented" — tests can mock it
- CI environments don't have SoftHSM2 or YubiKeys available
- Key policy (no naked keys) is still enforced by SoftKMS (PBES2 + tmpfs)

**Impact:**
- The `Pkcs11Provider` class is a typed stub in `packages/kms/src/index.ts`
- Test suites mock or skip PKCS#11 paths
- Increment E will implement and add integration tests requiring SoftHSM2

---

## Decision 3 — Trustmark Payload Schema (v1, Frozen)

**Status:** Accepted
**Date:** Increment D

**Fields (all v1 trustmarks):**

| Field | Type | Required | Description |
|---|---|---|---|
| `iss` | string (URL) | ✅ | TMI entity ID |
| `sub` | string (URL) | ✅ | Subject entity ID |
| `id` | string (URL) | ✅ | Trustmark type URI |
| `iat` | number | ✅ | Issued-at (Unix timestamp) |
| `exp` | number | ✅ | Expiry (Unix timestamp, default iat+3600) |
| `image_digest` | string | ❌ | OCI image digest (`sha256:<hex64>`) |
| `repo` | string (URL) | ❌ | Source repository URL |
| `evidence` | string (URL) | ❌ | Evidence/audit report URL |

**No additional fields will be added to v1.**

**To add fields in future versions:**
See [`docs/extending-trustmarks.md`](./extending-trustmarks.md) for the
versioning and extension process.

---

## Decision 4 — No Naked Private Keys

**Status:** Accepted (permanent)

**Decision:**
Private key material must NEVER exist as plaintext on the filesystem.
Specifically:
- Keys are generated encrypted (`step crypto jwk create --password-file`)
- The encrypted JWE file is the only persistent form
- Decryption is done at process startup into tmpfs (`/dev/shm` or Docker `type:tmpfs`)
- Decrypted key is wiped on process exit via `trap cleanup EXIT`
- CI uses keyless cosign (OIDC) for image signing — no signing keys in CI

**Enforcement:**
- `.gitignore` blocks `*.priv.jwk`, `*.priv.jwe`, `keys/.pass`
- `Dockerfile.*` does not `COPY` any key material
- Docker `type:tmpfs` volumes ensure decrypted keys never touch disk
- `SoftKmsProvider` validates it only reads from caller-supplied paths (no generation)
