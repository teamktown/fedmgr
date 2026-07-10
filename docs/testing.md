# Testing Guide — fedmgr

> The suite runs per-package via `node --test`. For the current counts run
> `npm test` (exact numbers drift with every change, so they are not pinned here).
> HSM integration tests are gated behind `SOFTHSM2_MODULE`.

---

## 1. Test Philosophy

- **Test-first (TDD)** — tests are written before implementation.
- **Hermetic** — unit/integration tests create their own keys, servers, and state. No pre-seeded fixtures on disk.
- **No mocks for crypto** — JWT signing always uses real ephemeral JWK pairs; never mock the KMS.
- **Gated HSM tests** — PKCS#11 tests skip unless `SOFTHSM2_MODULE` is set; CI always uses SoftKMS.
- **Concurrent-safe** — each test file uses a unique `.tmp/<file>/` subdirectory; no shared key paths.

---

## 2. Test Categories

| Category | Runner | Location | When run |
|----------|--------|----------|----------|
| **Package unit/integration** | `node --test` | `packages/*/test/` | `npm test` in package or `scripts/test-report.sh` |
| **Legacy integration** | Jest | `scripts/tests/` | `npm test` (root) |
| **HSM integration** | `node --test` | `packages/kms/test/pkcs11.test.mjs` | Only when `SOFTHSM2_MODULE` is set |
| **E2E CLI** | Jest | `scripts/tests/e2e/cli-federation-workflow.test.js` | `npm test` (root) |
| **Security** | Jest | `scripts/tests/security/` | `npm test` (root) |

---

## 3. Directory Structure

```
fedmgr/
├── packages/
│   ├── kms/
│   │   └── test/
│   │       ├── softkms.test.mjs      # 7 tests: SoftKmsProvider (always run)
│   │       └── pkcs11.test.mjs       # 8 tests: Pkcs11Provider (skip if no SOFTHSM2_MODULE)
│   └── ta-server/
│       └── test/
│           ├── ta-server.test.mjs         # 13 tests: SubordinateRegistry + signSubordinateStatement
│           ├── trust-mark-status.test.mjs # 8 tests: unit + HTTP
│           ├── chain-verifier.test.mjs    # 8 tests: trust chain traversal
│           ├── intermediates.test.mjs     # 6 tests: isIntermediate() + registry
│           ├── federation-list.test.mjs   # 11 tests: /federation_list HTTP + filters
│           └── file-registry.test.mjs     # 8 tests: FileSubordinateRegistry persistence
│
├── scripts/
│   ├── tests/
│   │   ├── unit/           # Jest: server + CLI unit tests (legacy)
│   │   ├── integration/    # Jest: federation endpoint integration
│   │   ├── e2e/            # Jest: CLI workflow E2E (workspace-isolated)
│   │   └── security/       # Jest: token validation security
│   └── test-report.sh      # Runs all package tests with dual spec+JUnit output
│
└── test-results/           # Generated output (gitignored files; directory tracked)
    ├── kms.junit.xml        # JUnit XML for kms
    ├── ta-server.junit.xml  # JUnit XML for ta-server
    ├── kms-hsm.junit.xml    # JUnit XML for Pkcs11Provider (only when HSM run)
    ├── kms.log              # Spec output for kms
    ├── ta-server.log        # Spec output for ta-server
    └── summary.log          # Pass/fail/skip totals per run
```

---

## 4. Running Tests

### 4.1 Package tests (standard)

```bash
# All packages with dual spec+JUnit output → test-results/
./scripts/test-report.sh

# Single package:
cd packages/kms && npm test
cd services/ta-server && npm test

# Single package with JUnit output:
cd packages/kms       && npm run test:report
cd services/ta-server && npm run test:report

# Root (Jest legacy + security):
npm test
```

### 4.2 HSM integration tests (native SoftHSM2)

> **Why native, not Docker?**
> In devcontainer environments (Codespaces, VS Code Remote), Docker uses `overlayfs` as its
> storage driver. Launching any container — even `docker run node:22-slim echo test` — fails with
> `invalid argument` when Docker tries to mount an overlay layer on top of the existing overlay
> filesystem (nested overlayfs is not supported). There is no simple workaround without restarting
> the Docker daemon with a different storage driver (`vfs` or `fuse-overlayfs`).
>
> **Native SoftHSM2 is faster, simpler, and environment-agnostic.** The `SOFTHSM2_MODULE` guard
> means `pkcs11.test.mjs` skips cleanly in CI and environments without SoftHSM2.
> `docker-compose.softhsm-test.yml` remains valid for bare-Linux hosts and GitHub Actions.

**One-time setup:**

```bash
# 1. Install SoftHSM2 (Debian/Ubuntu):
sudo apt-get install -y softhsm2 opensc

# 2. Install pkcs11js native addon into the kms package:
cd packages/kms && npm install pkcs11js

# 3. Locate the library (pick whichever exists):
find /usr -name "libsofthsm2.so" 2>/dev/null
# Typical: /usr/lib/softhsm/libsofthsm2.so
# Alt:     /usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so

# 4. Initialise a SoftHSM2 token:
mkdir -p /tmp/softhsm2/tokens
cat > /tmp/softhsm2.conf <<'EOF'
directories.tokendir = /tmp/softhsm2/tokens
objectstore.backend = file
EOF
export SOFTHSM2_CONF=/tmp/softhsm2.conf
softhsm2-util --init-token --slot 0 --label "test-token" \
  --pin testpin --so-pin soadmin

# 5. Generate an EC P-256 signing key:
pkcs11-tool --module /usr/lib/softhsm/libsofthsm2.so \
  --login --pin testpin \
  --keypairgen --key-type EC:prime256v1 \
  --label kms-test-key --id 01
```

**Run:**

```bash
SOFTHSM2_CONF=/tmp/softhsm2.conf \
SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
PKCS11_PIN=testpin \
PKCS11_KEY_LABEL=kms-test-key \
  cd packages/kms && npm run test:hsm

# With JUnit output:
SOFTHSM2_CONF=/tmp/softhsm2.conf \
SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
PKCS11_PIN=testpin \
PKCS11_KEY_LABEL=kms-test-key \
  ./scripts/test-report.sh
```

### 4.3 Reading persisted results

```bash
# Human-readable spec output from last run:
cat test-results/ta-server.log
cat test-results/kms-hsm.log

# Pass/fail summary:
cat test-results/summary.log

# JUnit XML — open in IntelliJ / VS Code Test Explorer, or use with:
# GitHub Actions: actions/upload-artifact → test-results/*.junit.xml
```

### 4.4 Run a single test file or filter by name

```bash
# Single file:
cd services/ta-server
node --test --test-reporter=spec test/chain-verifier.test.mjs

# Filter by name pattern:
node --test --test-name-pattern="resolves a 3-entity" test/chain-verifier.test.mjs
```

---

## 5. Test Suite Status (2026-03-16)

### Package tests (`node:test`)

| Package | File | Tests | Pass | Skip | Notes |
|---------|------|-------|------|------|-------|
| `kms` | `softkms.test.mjs` | 7 | 7 | 0 | Always run |
| `kms` | `pkcs11.test.mjs` | 8 | **8\*** | 8 | \*With `SOFTHSM2_MODULE`; else all skip |
| `ta-server` | `ta-server.test.mjs` | 13 | 13 | 0 | |
| `ta-server` | `trust-mark-status.test.mjs` | 8 | 8 | 0 | Unit + HTTP |
| `ta-server` | `chain-verifier.test.mjs` | 8 | 8 | 0 | Mock fetchFn |
| `ta-server` | `intermediates.test.mjs` | 6 | 6 | 0 | |
| `ta-server` | `federation-list.test.mjs` | 11 | 11 | 0 | Filter + pagination |
| `ta-server` | `file-registry.test.mjs` | 8 | 8 | 0 | Persistence |
| **Total** | | **69** | **69** | **8\*** | |

### Legacy tests (Jest)

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `unit/*` | 38 | 0 | |
| `integration/*` | 31 | 0 | |
| `e2e/cli-federation-workflow` | 12 | 0 | workspace-isolated |
| `e2e/federation-workflow` | 0 | **1** | pre-existing — needs live servers on :9001-9003 |
| `security/*` | all | 0 | |
| **Total** | **≈129** | **1** | |

---

## 6. Key Conventions

### 6.1 Concurrent-safe temp files

`node --test` runs test files concurrently in worker threads. Each file that writes keys to
disk **must** use a file-specific subdirectory:

```js
// BAD — shared across concurrent test files → race condition
const TMP = new URL('./.tmp/', import.meta.url).pathname;

// GOOD — unique per file
const TMP = new URL('./.tmp/chain-verifier/', import.meta.url).pathname;
const TMP = new URL('./.tmp/file-reg/',       import.meta.url).pathname;
```

### 6.2 Module-level key generation for multi-fixture tests

For tests that sign multiple JWTs (e.g. chain-verifier builds 2- and 3-entity chains),
generate ALL keys and sign ALL fixtures at module level (`top-level await`), not inside
`test()` callbacks. This avoids mid-test write conflicts.

### 6.3 Mock ordering (Jest legacy)

`jest.mock()` must appear before any `require()`. Without Babel hoisting, modules load with
real dependencies if `jest.mock()` runs after `require()`.

### 6.4 E2E workspace isolation

CLI E2E tests must set these vars to avoid touching the real workspace:

```js
process.env.FEDMGR_HOME           = testDir;
process.env.FEDMGR_FEDERATIONS_DIR = `${testDir}/federations`;
process.env.FEDMGR_FED_REG         = `${testDir}/data/fed-reg`;
process.env.FEDMGR_FED_REG_FILE    = `${testDir}/data/fed-reg/registry.json`;
```

### 6.5 Trust chain traversal — `authority_hints`, not `iss`

All self-signed entity statements have `iss === sub === entityId`. Following `iss` to find
a parent entity loops back to the same node. Upward traversal uses `authority_hints[0]`.

---

## 7. Gotchas

### 7.1 `CKO_PUBLIC_KEY` is `2`, not `3`

`CKO_PRIVATE_KEY = 3`, `CKO_PUBLIC_KEY = 2`. Swapping them causes key searches to find nothing
(or find the wrong key type). Always verify:

```bash
node -e "const p=require('pkcs11js'); console.log('pub:', p.CKO_PUBLIC_KEY, 'priv:', p.CKO_PRIVATE_KEY)"
# → pub: 2 priv: 3
```

### 7.2 pkcs11js template attribute format

pkcs11js marshals attribute values internally. Pass plain numbers and strings — **not Buffers**:

```js
// WRONG — Buffer is silently ignored for numeric types:
{ type: CKA_CLASS, value: Buffer.from([0, 0, 0, 2]) }

// CORRECT:
{ type: CKA_CLASS, value: 2 }
{ type: CKA_LABEL, value: "my-key-label" }
```

### 7.3 `CKM_ECDSA` output format and input contract

- **Output**: raw **R||S** (64 bytes for P-256). NOT DER. No `SEQUENCE { r INTEGER, s INTEGER }`.
- **Input**: the **hash** of the message, not the message itself.

For JWS ES256 with `CKM_ECDSA`:

```js
const hash = crypto.createHash('sha256').update(signingInput).digest();
const rawRS = pkcs11.C_Sign(session, hash, Buffer.allocUnsafe(128));
// rawRS is ready for base64url encoding — no DER conversion needed.
```

### 7.4 SoftHSM2 does not support `CKM_ECDSA_SHA256`

SoftHSM2 2.6.1 only advertises `ECDSA` (raw), not `ECDSA-SHA256`. Using `0x1043` throws
`CKR_MECHANISM_INVALID`. Pre-hash in application code instead (see §7.3).

Check supported mechanisms:
```bash
pkcs11-tool --module "$SOFTHSM2_MODULE" --list-mechanisms | grep -i ecdsa
```

### 7.5 `C_Initialize` and `C_Login` cross-session errors

| Error | Code | Cause | Fix |
|-------|------|-------|-----|
| `CKR_CRYPTOKI_ALREADY_INITIALIZED` | 401 | Second `C_Initialize()` call per process | Catch code 401, continue |
| `CKR_USER_ALREADY_LOGGED_IN` | 256 | Token login state is shared across all sessions in a process | Catch code 256, continue |

### 7.6 `C_Sign` requires 3 arguments in pkcs11js

```js
// WRONG — throws: "Expected 3 arguments, but received 2"
pkcs11.C_Sign(session, data)

// CORRECT — third arg is the output buffer; pkcs11js returns a slice of it
const sig = pkcs11.C_Sign(session, data, Buffer.allocUnsafe(128));
```

### 7.7 Docker in devcontainers — overlayfs limitation

Running Docker inside a devcontainer fails for ANY image:

```
failed to mount ...: mount source: "overlay", fstype: overlay, err: invalid argument
```

Root cause: Docker uses overlayfs; the devcontainer host already uses overlayfs; nested
overlay mounts are not supported without kernel `userxattr` mount option or a different
storage driver. **Workaround: use native SoftHSM2 (§4.2).** The Docker Compose file
(`deploy/lab/docker-compose.softhsm-test.yml`) works on:
- Bare Linux with `overlay2` driver
- macOS Docker Desktop (uses a Linux VM)
- GitHub Actions (ubuntu-latest, non-nested)

### 7.8 `pkcs11js` is optional — install manually for HSM testing

`pkcs11js` is not in `packages/kms/package.json` dependencies (it requires native compilation
and a PKCS#11 library at runtime). Install it manually when needed:

```bash
cd packages/kms && npm install pkcs11js
```

CI and the standard `npm test` path work without it (the `import("pkcs11js")` dynamic import
throws a clear error if missing; all 8 tests skip via the `SOFTHSM2_MODULE` guard).

---

## 8. FAQ

**Q: Why does `npm test` (root) pass but `packages/kms` npm test shows 8 skips?**
A: Root runs Jest (SoftKMS only). The kms package runner also executes `pkcs11.test.mjs`, which
skips 8 tests when `SOFTHSM2_MODULE` is not set. Expected — Decision 2.

**Q: Can I run chain-verifier tests without a real TA server?**
A: Yes. `chain-verifier.test.mjs` uses an injectable `fetchFn`. All 8 tests use an in-memory
`Map<url, jwt>` — no ports opened, no HTTP.

**Q: Why are `test-results/` files gitignored but the directory is tracked?**
A: Only generated files (`.junit.xml`, `.tap`, `.log`) are gitignored. The directory itself is
tracked so CI pipelines can write to a known path without creating the directory first. Upload
JUnit XML as CI artifacts — don't commit them.

**Q: How do I run only one test file?**
```bash
cd services/ta-server
node --test --test-reporter=spec test/chain-verifier.test.mjs
```

**Q: How do I filter tests by name?**
```bash
node --test --test-name-pattern="resolves a 3-entity" test/chain-verifier.test.mjs
```

**Q: The HSM test fails with `no private key found`. How do I debug?**
```bash
pkcs11-tool --module "$SOFTHSM2_MODULE" --login --pin "$PKCS11_PIN" --list-objects
# Check the label matches PKCS11_KEY_LABEL exactly (default: kms-test-key)
```

**Q: Can `FileSubordinateRegistry` be used in production?**
A: For small single-instance deployments, yes. For production with concurrent TA replicas,
replace with a database-backed registry. The `SubordinateRegistry` base class is the extension point.

**Q: What does `entity_type=intermediate` do in `GET /federation_list`?**
A: Returns only entities whose registry entry has a
`metadata.federation_entity.federation_fetch_endpoint` — i.e. entities that themselves have
subordinates. Detected by `isIntermediate()` in `services/ta-server/src/federation/subordinate-statements.ts`.

**Q: How is `FileSubordinateRegistry` activated?**
A: Set `TA_REGISTRY_PATH=/path/to/registry.json` when starting `ta-server`. Unset → in-memory
only (default, data lost on restart).
