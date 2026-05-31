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

## Decision 2 — SoftKMS for All Dev/Test; PKCS#11 gated by `SOFTHSM2_MODULE`

**Status:** Updated (Increment F)
**Date:** Originally Increment D; updated Increment F

**Decision:**
All local development and CI test runs use SoftKMS only.
PKCS#11 providers are not required for `npm test` to pass.
PKCS#11 integration tests (`pkcs11.test.mjs`) run only when `SOFTHSM2_MODULE` is set.

**Rationale:**
- CI environments don't have SoftHSM2 or YubiKeys available
- Key policy (no naked keys) is still enforced by SoftKMS (PBES2 + tmpfs)
- The `SOFTHSM2_MODULE` guard enables clean skipping of all 8 HSM tests in CI
- `pkcs11js` is listed in `dependencies` but `import("pkcs11js")` is dynamic — fails gracefully if the native addon is absent

**Impact:**
- `pkcs11.test.mjs` — all 8 tests skip unless `SOFTHSM2_MODULE` is set
- `scripts/test-report.sh` — runs HSM tests when `SOFTHSM2_MODULE` is set; skips cleanly otherwise
- CI pipeline: runs only SoftKMS tests; SoftHSM2 tests run in a separate optional job

---

## Decision 5 — Native SoftHSM2 over Docker for Devcontainer HSM Testing

**Status:** Accepted
**Date:** Increment F

**Decision:**
PKCS#11 integration tests run against a natively-installed SoftHSM2 library
(`sudo apt-get install softhsm2 opensc`) rather than a Docker container.

**Rationale:**
- Devcontainer and Codespaces environments use overlayfs as the Docker storage driver.
  Launching any container fails with `mount source: "overlay", fstype: overlay, err: invalid argument`
  because nested overlayfs mounts are not supported without the `userxattr` kernel option.
- Native SoftHSM2 is faster (no container build time), simpler (no volume mounts), and
  environment-agnostic (bare Linux, macOS, GitHub Actions, devcontainers all work).
- The Docker Compose file (`examples/lab/docker-compose.softhsm-test.yml`) remains valid for
  bare-Linux hosts and GitHub Actions (non-nested), but is **not** the primary test path.

**Constraints:**
- One-time setup: `sudo apt-get install -y softhsm2 opensc` + token init (see `docs/testing.md §4.2`)
- `pkcs11js` native addon must be installed manually: `cd packages/kms && npm install pkcs11js`
- The token directory (`/tmp/softhsm2/tokens`) is ephemeral per machine; re-run init if lost

**SoftHSM2 API constraints discovered during implementation:**
- Supports `CKM_ECDSA` (raw; requires pre-hashed input) but NOT `CKM_ECDSA_SHA256`
- `C_Initialize` throws `CKR_CRYPTOKI_ALREADY_INITIALIZED` (code 401) when called twice per process — tolerate, don't fail
- `C_Login` throws `CKR_USER_ALREADY_LOGGED_IN` (code 256) due to shared token login — tolerate, don't fail
- `C_FindObjectsInit` template values must be plain JS numbers/strings, not Buffers
- `C_Sign` requires 3 arguments (session, data, outputBuffer) — pkcs11js does not have a 2-arg form
- `CKO_PUBLIC_KEY = 2`, `CKO_PRIVATE_KEY = 3` — these are NOT interchangeable

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
