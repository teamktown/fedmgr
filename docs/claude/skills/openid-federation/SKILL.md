---
name: openid-federation
description: OpenID Federation 1.0 design patterns, security practices, and implementation guide for Trust Anchors, Trustmark Issuers, and subordinate entities
version: 1.0.0
category: security
tags:
  - openid-federation
  - trust-anchor
  - trustmark
  - oidf
  - fedmgr
  - jwt
  - jwks
  - ssrf
  - security
author: fedmgr team
---

# OpenID Federation 1.0 — Design Patterns & Security Guide

## Overview

OpenID Federation 1.0 (draft-43) is a framework for establishing verifiable trust
between entities in a federation. A Trust Anchor (TA) signs subordinate statements
for Trustmark Issuers (TMIs), which in turn issue signed trustmarks to MCP servers,
OPs, and other relying parties. Verifiers walk the trust chain from the subject entity
up to the expected TA to confirm membership.

This skill covers:
1. [Core Concepts](#core-concepts)
2. [Entity Roles](#entity-roles)
3. [Trust Chain Resolution](#trust-chain-resolution)
4. [Enrollment Protocol](#enrollment-protocol)
5. [Security Patterns](#security-patterns)
6. [Implementation Checklist](#implementation-checklist)
7. [Common Mistakes](#common-mistakes)
8. [fedmgr Tool Reference](#fedmgr-tool-reference)

---

## Core Concepts

### Entity Statement

A self-signed JWT (`typ: entity-statement+jwt`) at `/.well-known/openid-federation`.
Contains:
- `iss` / `sub` — both equal the entity's own URL (self-signed)
- `jwks` — the entity's public keys
- `authority_hints` — array of parent entity URLs (empty for the TA)
- `metadata` — role-specific metadata (`openid_provider`, `federation_entity`, etc.)
- `iat` / `exp` — issued-at and expiry (24h typical)

### Subordinate Statement

A JWT signed by an authority (TA or intermediate) about a subordinate:
- `iss` — the signing authority's entity ID
- `sub` — the subordinate entity ID
- `jwks` — the subordinate's public keys (copied/verified by the authority)
- Returned by `GET /federation_fetch?sub=<entityId>`

### Trustmark

A JWT issued by a Trustmark Issuer (`iss`) about a subject (`sub`):
- `id` — trustmark type URI
- `iat` / `exp` — issued-at and expiry
- `jku` — JWKS URL of the TMI (for signature verification)
- Optional: `image_digest`, `repo`, `evidence`, `adopted_from_*`

---

## Entity Roles

### Trust Anchor (TA)

The root of trust. Self-signed; no `authority_hints`.

Required endpoints:
- `GET /.well-known/openid-federation` — self-signed entity statement
- `GET /.well-known/jwks.json` — TA public JWKS
- `GET /federation_list` — array of direct subordinate entity IDs
- `GET /federation_fetch?sub=<entityId>` — signed subordinate statement
- `GET /trust-mark-status?sub=<sub>&id=<id>` — trustmark revocation check

fedmgr implementation: `@letsfederate/ta-server`

### Trustmark Issuer (TMI)

Issues signed trustmarks. Subordinate of the TA.

Required endpoints:
- `GET /.well-known/openid-federation` — entity statement with `authority_hints: [TA_URL]`
- `GET /.well-known/jwks.json` — TMI public JWKS
- `POST /trustmarks/issue` — mint a trustmark (requires `TMI_ISSUE_TOKEN` auth)

fedmgr implementation: `@letsfederate/tmi-server`

### Intermediate Entity

An entity that is both a subordinate of the TA and itself an authority over other entities.
Its entity statement includes `federation_fetch_endpoint` in its `federation_entity` metadata.

### Leaf Entity (MCP server, OP, RP, etc.)

Has `authority_hints` pointing to the TA (or an intermediate).
Receives a trustmark from the TMI after being enrolled with the TA.

---

## Trust Chain Resolution

The verifier performs these steps:

1. Fetch subject's entity statement (`subject/.well-known/openid-federation`)
2. Extract `authority_hints[0]` (first authority)
3. Fetch the authority's entity statement (to get their JWKS)
4. Fetch the authority's subordinate statement for the subject
   (`authority/federation_fetch?sub=subject`)
5. Verify the subordinate statement with the authority's JWKS
6. If `authority !== expectedTA`, recurse with `authority` as the new subject
7. When `authority === expectedTA`, chain is verified

**Depth limit:** Implementations must cap chain depth (default: 10) to prevent
infinite loops from misconfigured or malicious `authority_hints`.

**Algorithm pinning:** Use `algorithms: ["ES256"]` in `jwtVerify()`. Never accept
all algorithms — this prevents RS256/HS256 confusion attacks.

### fedmgr CLI chain check

```bash
fedmgr trustmark check \
  --sub https://my-mcp-server.example.com \
  --ta  https://letsfederate.org \
  --jws $(cat trustmark.jwt) \
  --policy strict
```

Exit codes: `0` = VALID, `1` = INVALID, `2` = WARN

---

## Enrollment Protocol

The TA uses a two-step proof-of-key-ownership flow:

### Step 1: Start enrollment

```http
POST /enroll
Content-Type: application/json

{
  "entity_id": "https://my-server.example.com",
  "jwks_url":  "https://my-server.example.com/.well-known/jwks.json",
  "notes": "MCP server for project X"
}
```

Response:
```json
{
  "enrollment_id": "<uuid>",
  "nonce": "<32-byte-hex>",
  "expires_at": "2025-01-01T00:10:00Z"
}
```

### Step 2: Complete enrollment

Create a JWS with payload `{"nonce":"<nonce>","entity_id":"<entity_id>"}` signed
by the entity's private key, then:

```http
POST /enroll/<enrollment_id>/complete
Content-Type: application/json

{
  "proof_jws": "<compact-jws>"
}
```

Response: `{ entity_id, status: "active", signed_entity_statement }`

### Entity binding rule

`jwks_url` MUST share the same origin (scheme + host + port) as `entity_id`.
This prevents an attacker from enrolling a victim entity with their own JWKS.

```
entity_id = https://victim.example.com      ← allowed origin
jwks_url  = https://victim.example.com/...  ← ✓ same origin
jwks_url  = https://attacker.com/...        ← ✗ rejected
```

---

## Security Patterns

### 1. SSRF Prevention

Every server-side URL that triggers an outbound fetch must be validated:

```typescript
import { assertSafeUrl, UrlSafetyError } from "@letsfederate/kms";

try {
  assertSafeUrl(callerSuppliedUrl, "jwks_url");
} catch (err) {
  if (err instanceof UrlSafetyError) {
    return res.status(400).json({ error: "invalid_request", message: err.message });
  }
  throw err;
}
```

Blocked: RFC 1918 (`10.x`, `172.16-31.x`, `192.168.x`), loopback (`127.x`, `localhost`),
link-local (`169.254.x`, `fe80::`), non-HTTPS in production.

### 2. Private JWK Stripping

Never embed a JWK with private fields in a signed federation document:

```typescript
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

function stripPrivateFields(jwk: JWK): JWK {
  const pub = { ...jwk };
  for (const f of PRIVATE_JWK_FIELDS) delete (pub as Record<string, unknown>)[f];
  return pub;
}

// Use:
jwks: { keys: subjectJwks.keys.map(stripPrivateFields) }
```

### 3. Algorithm Pinning

```typescript
const { payload } = await jwtVerify(jws, cryptoKey, {
  clockTolerance: 60,
  algorithms: ["ES256"],  // REQUIRED — prevents RS256/HS256 confusion
});
```

### 4. Fetch Timeouts and Size Caps

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000); // 10s
try {
  const r = await fetch(url, { signal: controller.signal });
  const text = await r.text();
  if (text.length > 1024 * 1024) throw new Error("Response too large");
  return JSON.parse(text);
} finally {
  clearTimeout(timeout);
}
```

### 5. Express 4.x Async Handler

```typescript
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Usage:
app.get("/federation_fetch", asyncHandler(async (req, res) => {
  // rejected promises forwarded to error middleware
}));
```

### 6. Admin Endpoint Authentication

```typescript
// Pattern for optional Bearer token auth
function adminAuth(token: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) return next();          // disabled in dev
    if (req.headers["authorization"] === `Bearer ${token}`) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

// Startup warning when token not set
if (!process.env["ADMIN_TOKEN"]) {
  process.stderr.write("[TRUST:WARN] ADMIN_TOKEN not set — endpoints unprotected\n");
}
```

### 7. Key Rotation

When rotating the TA signing key:
1. Publish the new public JWK at `/.well-known/jwks.json` alongside the old one
2. Wait for cached subordinate statements to expire (≤ 24h)
3. Re-sign all subordinate statements with the new key
4. Remove the old JWK from JWKS after all cached tokens have expired

Trustmarks with `jku` pointing to the old JWKS will fail verification after the
old key is removed — re-issue affected trustmarks.

---

## Implementation Checklist

### Trust Anchor

- [ ] Self-signed entity statement at `/.well-known/openid-federation`
- [ ] JWKS at `/.well-known/jwks.json` (public keys only — strip `d`, `p`, `q`, etc.)
- [ ] `federation_list` endpoint (active subordinates only)
- [ ] `federation_fetch` endpoint (404/403 for pending/revoked/decommissioned)
- [ ] `trust-mark-status` endpoint (check revocation DB)
- [ ] Two-step enrollment with proof-of-key-ownership
- [ ] Entity binding: `jwks_url` origin == `entity_id` origin
- [ ] SSRF validation on all caller-supplied URLs
- [ ] `ADMIN_TOKEN` for management endpoints in production
- [ ] SQLite WAL mode for concurrent reads

### Trustmark Issuer

- [ ] Self-signed entity statement with `authority_hints: [TA_URL]`
- [ ] `authority_hints` populated from env (`TMI_AUTHORITY_HINTS`)
- [ ] `TMI_ISSUE_TOKEN` protecting `POST /trustmarks/issue`
- [ ] `jku` header in issued trustmarks points to own JWKS
- [ ] Private key on tmpfs (decrypted at runtime, never written by server)

### Trustmark Verifier

- [ ] Fetch JWKS via `jku` claim in JWS header
- [ ] Apply `assertSafeUrl` to `jku` before fetching (SSRF)
- [ ] Pin `algorithms: ["ES256"]`
- [ ] Check `exp` claim
- [ ] Optionally verify full chain to TA via `validateTrustChain()`

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Not pinning `algorithms` in `jwtVerify` | RS256/HS256 confusion attack | Always use `algorithms: ["ES256"]` |
| Embedding private JWK fields in signed statement | Private key disclosed publicly | Call `stripPrivateFields()` before embedding |
| Accepting any `jku` without SSRF check | SSRF to internal services | `assertSafeUrl(jku, "jku")` before fetch |
| Enrolling with mismatched `jwks_url` origin | Victim entity enrollment | Enforce origin equality in enrollment handler |
| No timeout on outbound JWKS fetches | Thread starvation / DoS | `AbortController` with 5–10s timeout |
| No size cap on JWKS response | Memory exhaustion | Check `Content-Length` + body size ≤ 64KB |
| Unprotected `POST /trustmarks/issue` | Anyone can issue trustmarks | Require `TMI_ISSUE_TOKEN` Bearer auth |
| Async Express 4 handler without asyncHandler | Unhandled rejections, silent failures | Wrap with `asyncHandler()` |
| `jose` not in `package.json#dependencies` | Breaks on non-hoisted installs | Declare all runtime imports explicitly |
| `if: secrets.FOO != ''` in GitHub Actions | Step always runs | Use `if: ${{ secrets.FOO != '' }}` |

---

## fedmgr Tool Reference

### Enrollment

```bash
# Start enrollment
curl -X POST https://ta.example.com/enroll \
  -H 'Content-Type: application/json' \
  -d '{"entity_id":"https://my-server.example.com","jwks_url":"https://my-server.example.com/.well-known/jwks.json"}'

# Complete enrollment (after signing nonce)
curl -X POST https://ta.example.com/enroll/<id>/complete \
  -H 'Content-Type: application/json' \
  -d '{"proof_jws":"<compact-jws>"}'
```

### Trustmark issuance

```bash
fedmgr trustmark issue \
  --sub   https://my-server.example.com \
  --tmi   https://tmi.example.com \
  --id    https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1 \
  --ttl   3600
```

### Trustmark verification

```bash
fedmgr trustmark verify --jws $(cat trustmark.jwt)
```

### Full chain check

```bash
fedmgr trustmark check \
  --sub    https://my-server.example.com \
  --ta     https://letsfederate.org \
  --policy strict
```

### MCP tools (`@letsfederate/fedmgr-mcp`)

| Tool | Purpose |
|------|---------|
| `federation_status` | Overview of TA + TMI health |
| `list_subordinates` | List active/pending/revoked subordinates |
| `enroll_server` | Start enrollment for a new entity |
| `complete_enrollment` | Submit signed proof to complete enrollment |
| `issue_trustmark` | Mint a trustmark via the TMI |
| `verify_trustmark` | Verify a trustmark JWS |
| `check_trust_chain` | Walk the full OIDF trust chain |
| `revoke_subordinate` | Revoke a subordinate (admin) |
| `get_signed_config` | Fetch a signed entity statement |
| `initialize_local_ca` | Bootstrap a local test PKI |

---

## References

- OpenID Federation 1.0 draft-43: https://openid.net/specs/openid-federation-1_0.html
- OIDF §8.1 — Subordinate Statements (federation_fetch)
- OIDF §8.3 — Federation List (federation_list)
- OIDF §12 — Trust Mark Status
- RFC 7517 — JSON Web Key (JWK)
- RFC 7519 — JSON Web Tokens (JWT)
- OWASP SSRF Prevention Cheat Sheet
