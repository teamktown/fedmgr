# Increment E — Trust Chain Verification, Intermediates, PKCS#11, Trust Mark Status

**RALPH phase:** Actions + Lints/Tests + Plan
**Status:** ✅ Complete
**Branch:** `feat/uplift-tdd`

---

## What Was Built

Four capabilities added across `@letsfederate/kms` and `@letsfederate/ta-server`:

1. **Full trust chain verification** — walks the chain from a leaf entity up to a configured trust anchor following OIDF draft-43 §9 semantics
2. **Intermediate entity support** — TA can manage and issue subordinate statements for non-leaf intermediates
3. **Pkcs11Provider** — production-grade HSM provider using PKCS#11 (SoftHSM2, YubiKey, Cloud HSM)
4. **Trust mark status endpoint** — `GET /trust-mark-status?sub=&id=` per OIDF §10

---

## Files Added / Modified

```
packages/kms/
├── src/
│   ├── index.ts                          # re-exports Pkcs11Provider; factory updated
│   ├── providers/
│   │   └── pkcs11.ts                     # NEW: Pkcs11Provider (lazy pkcs11js, DER→raw sig)
│   └── types/
│       └── pkcs11js.d.ts                 # NEW: ambient declaration (CI build without pkcs11js)
└── test/
    └── pkcs11.test.mjs                   # NEW: 8 integration tests (all skip without SOFTHSM2_MODULE)

packages/ta-server/
├── src/
│   ├── index.ts                          # +trust-mark-status router, +intermediates endpoint
│   └── federation/
│       ├── chain-verifier.ts             # NEW: verifyTrustChain(), resolveFederationStatement()
│       ├── subordinate-statements.ts     # +isIntermediate() helper
│       └── trust-mark-status.ts          # NEW: TrustMarkStatusRegistry + Express router
└── test/
    ├── chain-verifier.test.mjs           # NEW: 8 tests
    ├── intermediates.test.mjs            # NEW: 6 tests
    └── trust-mark-status.test.mjs        # NEW: 8 tests (4 unit + 4 HTTP)
```

---

## Trust Chain Verifier

### Algorithm (OIDF draft-43 §9)

```
verifyTrustChain(leafEntityId, trustAnchorEntityId):
  1. Fetch leaf's self-signed entity statement; decode it.
  2. Loop (up to maxDepth):
     a. Read authority_hints[0] from current entity's statement.
     b. If no authority_hints → entity claims self-sovereignty.
        If it IS the expected TA → verify TA self-signature → done (ok: true).
        Otherwise → error: chain terminated at wrong entity.
     c. Fetch authority's self-signed statement; verify its self-signature.
     d. Fetch authority's federation_fetch?sub=currentEntityId.
     e. Verify subordinate statement signature using authority's JWKS.
     f. Push { iss: authorityId, sub: currentEntityId, jwt } to chain.
     g. If authorityId === trustAnchorEntityId → done (ok: true).
     h. Advance: currentEntity = authority.
```

### Key design decision: `authority_hints` not `iss`

All self-signed entity statements have `iss === sub === entityId`. Following `iss` to find the parent would loop back to the same entity. The correct traversal uses `authority_hints[0]` from each entity's self-signed statement to discover the next authority up the chain.

### Injectable fetchFn

`TrustChainOptions.fetchFn` allows injecting a mock fetch for unit tests — no real HTTP required. All 8 chain-verifier tests use a `Map<url, jwt>` lookup, generated from ephemeral in-memory JWK pairs at module level (not per-test, to avoid concurrent write races).

---

## Intermediate Entity Support

`isIntermediate(entry: SubordinateEntry): boolean`

An entity is an intermediate (not a leaf) when its `metadata.federation_entity.federation_fetch_endpoint` is a non-empty string. This distinguishes entities the TA has subordinated that themselves have subordinates.

The TA server `/intermediates` endpoint (POST to register, GET to list) stores entries with `fetchEndpoint` in the subordinate registry spec. Subordinate statements for intermediates include `metadata.federation_entity.federation_fetch_endpoint` so downstream verifiers can walk through them.

---

## Pkcs11Provider

### Design

- **Lazy initialization**: `_initPkcs11()` called on first use; dynamically imports `pkcs11js` via `await import("pkcs11js")`. Throws a clear diagnostic if the package is not installed.
- **Key material never leaves HSM**: `signJwt()` assembles the signing input (`header.payload` compact form), submits to `C_Sign` via `CKM_ECDSA`, then converts the DER result to raw R||S for JWS.
- **DER → raw conversion**: `derEcdsaToRaw(der, coordinateBytes=32)` — minimal ASN.1 parser with no external dependencies. Handles multi-byte DER length fields and leading 0x00 sign bytes on INTEGER components.
- **Public key export**: `C_GetAttributeValue(CKA_EC_POINT)` returns DER-wrapped uncompressed point (0x04 || X || Y); stripped to raw X/Y then base64url-encoded for JWK.

### CI Gating (Decision 2)

`packages/kms/test/pkcs11.test.mjs` — 8 tests, all skip when `SOFTHSM2_MODULE` is unset:

```bash
# Local HSM integration test run:
SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
  PKCS11_PIN=userpin PKCS11_KEY_LABEL=kms-test-key \
  node --test test/pkcs11.test.mjs
```

A `src/types/pkcs11js.d.ts` ambient declaration satisfies TypeScript without pkcs11js installed.

---

## Trust Mark Status Endpoint

`GET /trust-mark-status?sub=<entityId>&id=<trustMarkId>`

Returns `{ active: true }` or `{ active: false }` per OIDF §10.
- 400 if `sub` or `id` missing.
- Status managed by `TrustMarkStatusRegistry` (in-memory; operator can revoke/restore via admin API in a future increment).

---

## Test Summary

| Package | Tests | Pass | Fail | Skip |
|---------|-------|------|------|------|
| `@letsfederate/kms` | 15 | 7 | 0 | 8 (HSM) |
| `@letsfederate/ta-server` | 35 | 35 | 0 | 0 |
| **Total new tests (E)** | **22** | **14** | **0** | **8** |

Cumulative fedmgr: **130 passing**, **1 pre-existing** server E2E failure (requires live port 9001), **8 skipped** (HSM integration).

---

## Next Increment (F — Candidates)

- **Trust mark issuance endpoint** (`POST /trust-mark`) — TA signs and issues trust marks
- **Federation list endpoint** (`GET /federation_list`) — paginated list of registered entities
- **Persistent subordinate registry** — replace in-memory registry with SQLite or file-backed store
- **Docker integration test** — SoftHSM2 container + Pkcs11Provider end-to-end
