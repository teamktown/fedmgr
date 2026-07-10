# Increment C — OIDF Federation Scaffolding

**RALPH phase:** Actions + Lints/Tests + Plan
**Status:** ✅ Complete
**Branch:** `feat/uplift-tdd`

---

## What Was Built

OpenID Federation 1.0 entity statement infrastructure and a conformance test hook:

```
packages/tmi-server/src/federation/
└── entity-statements.ts          # signEntityStatement, tmiMetadata, trustAnchorMetadata

packages/tmi-server/src/index.ts  # +GET /.well-known/openid-federation endpoint
packages/tmi-server/test/
└── entity-statements.test.mjs    # 10 unit tests

scripts/oidf-cert.sh               # OIDF conformance test harness runner
```

---

## OIDF Compliance Status

| Requirement (draft-43) | Status | Notes |
|---|---|---|
| `/.well-known/openid-federation` returns signed JWT | ✅ | typ=entity-statement+jwt |
| Content-Type: `application/entity-statement+jwt` | ✅ | Set in Express route |
| `iss === sub === entityId` (self-signed) | ✅ | Verified by test |
| `exp` claim present | ✅ | Default 24h, configurable |
| `jwks` in payload (public only, no `d`) | ✅ | Verified by test |
| `metadata.federation_entity` block | ✅ | Via `tmiMetadata()` |
| `authority_hints` when non-leaf | ✅ | Conditional inclusion |
| `federation_fetch_endpoint` | ⏳ | Increment D (TA scaffolding) |
| `federation_list_endpoint` | ⏳ | Increment D |
| Intermediate entity support | ⏳ | Increment E |
| Trust mark status endpoint | ⏳ | Increment E |

---

## New Endpoint

### `GET /.well-known/openid-federation`

Returns a self-signed OIDF entity statement JWT for the TMI.

```
Content-Type: application/entity-statement+jwt
Cache-Control: public, max-age=3600
```

Payload structure:
```json
{
  "iss": "https://tmi.local",
  "sub": "https://tmi.local",
  "iat": 1710000000,
  "exp": 1710086400,
  "jwks": { "keys": [{ "kty": "EC", "crv": "P-256", "kid": "...", ... }] },
  "metadata": {
    "federation_entity": {
      "organization_name": "letsfederate TMI",
      "contacts": ["ops@letsfederate.org"],
      "jwks_uri": "https://tmi.local/.well-known/jwks.json",
      "federation_trust_mark_issuer_endpoint": "https://tmi.local/trustmarks/issue"
    }
  }
}
```

Verify with:
```bash
# Check content-type
curl -sI http://localhost:8080/.well-known/openid-federation \
  | grep content-type

# Decode payload (no sig check)
curl -sf http://localhost:8080/.well-known/openid-federation \
  | cut -d. -f2 | base64 -d | python3 -m json.tool
```

---

## Conformance Test Script

```bash
# Requires the local lab to be running
docker compose -f examples/lab/docker-compose.yml up -d

# Run smoke checks + harness
bash scripts/oidf-cert.sh
```

The script:
1. Health-checks the TMI
2. Verifies `/.well-known/openid-federation` returns `application/entity-statement+jwt`
3. Decodes and pretty-prints header and payload
4. Attempts to pull and run the official OIDF conformance harness container
5. If harness unavailable, prints manual certification steps at openid.net/certification

---

## Tests

```
✔ entity statement is a valid 3-part JWS
✔ header typ is entity-statement+jwt
✔ header alg is ES256
✔ payload iss and sub equal entityId
✔ payload exp > iat
✔ payload jwks present and has public key without d
✔ payload metadata block present for TMI
✔ authority_hints absent when empty array
✔ authority_hints present when non-empty
✔ trustAnchorMetadata contains federation_fetch and federation_list endpoints
10/10 pass  0 fail
```

---

## Cumulative test count

| Package | Tests | Pass |
|---|---|---|
| `@letsfederate/kms` | 7 | 7 |
| `@letsfederate/fedmgr` | 8 | 8 |
| `@letsfederate/tmi-server` | 10 | 10 |
| **Total** | **25** | **25** |

---

## Next: Increment D — Trust Anchor scaffolding

- Static TA entity configuration (signed JWT, self-signed)
- `federation_list` endpoint (returns subordinate entity IDs)
- `federation_fetch?sub=<entityId>` endpoint (returns signed subordinate statement)
- Trust anchor registers TMI as a subordinate
- Updated compose: add `ta-server` service
