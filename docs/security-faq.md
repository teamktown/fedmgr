# fedmgr Security FAQ

This document covers the security patterns enforced in fedmgr and explains
what to be mindful of when building or extending OpenID Federation infrastructure.

---

## SSRF (Server-Side Request Forgery)

### What is it?

SSRF lets an attacker trick the server into making HTTP requests to internal
resources — AWS metadata endpoints, Redis, Kubernetes API, other microservices —
by supplying a crafted URL. In federation contexts, three inputs are attack vectors:

- `jwks_url` in enrollment (`POST /enroll`)
- `jku` in the JWS header of a trustmark token
- `ta_url` / `tmi_url` / `entity_url` in MCP tools

### How fedmgr blocks it

All URL inputs are validated with `assertSafeUrl()` before any outbound fetch:

- Rejects non-HTTPS schemes (`ftp://`, `file://`, etc.)
- Blocks RFC 1918 private ranges: `10.x`, `172.16–31.x`, `192.168.x`
- Blocks loopback (`127.x`, `::1`, `localhost`)
- Blocks IPv6 link-local (`fe80::`)
- `http://` only allowed when `NODE_ENV=development`

**Pattern to follow:** Any user-supplied URL that triggers an outbound HTTP
request must be passed through `assertSafeUrl()` before calling `fetch()`.

### Enrollment: entity binding

An additional SSRF-adjacent attack is victim entity enrollment: an attacker
provides `entity_id=https://victim.example` but `jwks_url=https://attacker.com/jwks`.
After proving ownership of the attacker's keys, the TA signs a subordinate
statement for the victim.

**Fix:** Enforce same-origin between `entity_id` and `jwks_url`. The enrollment
router checks `new URL(entity_id).origin === new URL(jwks_url).origin`.

---

## Algorithm Confusion (JWT)

### What is it?

JWTs signed with RS256 or HS256 can be accepted by verifiers that trust only
EC algorithms if the algorithm is not pinned. An attacker signs a token with
their RSA key or HMAC-derives it from the public key material.

### How fedmgr blocks it

The verification alg is derived from the **key we hold** (curve → alg via
`jwsAlgForJwk()`), never from the JWS header, and every `jwtVerify()` call
pins the closed EC allowlist `SUPPORTED_JWS_ALGS` (ES256/ES384/ES512, from
`@letsfederate/kms`; ES512 is the signing default since the P-521 key
rollover):

```typescript
await jwtVerify(proof_jws, cryptoKey, {
  clockTolerance: 60,
  algorithms: [...SUPPORTED_JWS_ALGS],
});
```

**Pattern to follow:** Never call `jwtVerify()` without the `algorithms` option.
Passing only the key is not sufficient — the library will accept any alg the key
supports unless you restrict it.

---

## Private Key Leakage in Signed Statements

### What is it?

A JWKS containing private key fields (`d`, `p`, `q`, `dp`, `dq`, `qi`) could be
accidentally embedded in a signed subordinate statement, publishing the private key
to any relying party that downloads the federation document.

### How fedmgr blocks it

`signSubordinateStatement()` calls `stripPrivateFields()` on every JWK before
embedding it in the JWT payload:

```typescript
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];
```

The bootstrap JWKS fetch also strips private fields from whatever the remote server returns.

**Pattern to follow:** Any code path that embeds a JWK into a signed document
must strip private fields. Never trust that a JWKS endpoint serves only public keys.

---

## Unprotected Admin Endpoints

### What is it?

Admin endpoints without authentication allow anyone on the network to revoke
subordinates, read audit logs, or issue trustmarks.

### How fedmgr protects admin endpoints

| Endpoint group | Protection |
|---|---|
| `GET/POST /subordinates/*` | `ADMIN_TOKEN` Bearer auth when `ADMIN_TOKEN` env is set |
| `GET /dashboard/*` | Same `ADMIN_TOKEN` Bearer auth |
| `POST /trustmarks/issue` (TMI) | `TMI_ISSUE_TOKEN` Bearer auth when `TMI_ISSUE_TOKEN` env is set |

**Pattern to follow:** Always set `ADMIN_TOKEN` and `TMI_ISSUE_TOKEN` in production.
The servers log a `[TRUST:WARN]` at startup if either is absent.

---

## Express 4.x Async Error Handling

### What is it?

Express 4 does not automatically forward rejected promises from `async` route
handlers to error middleware. An unhandled rejection silently hangs or crashes
the process instead of returning a 500.

### How fedmgr fixes it

All async routes are wrapped with `asyncHandler()`:

```typescript
app.get("/path", asyncHandler(async (req, res) => {
  // any throw or rejection here → forwarded to next(err)
}));
```

**Pattern to follow:** Wrap every `async` route handler with `asyncHandler`.
Express 5 handles this automatically; until upgrade, the wrapper is required.

---

## Size and Timeout DoS

### What is it?

Without limits, a malicious JWKS endpoint can return a gigabyte response
(memory exhaustion) or hang indefinitely (thread starvation).

### How fedmgr protects fetches

- **Enrollment JWKS fetch:** 64 KB cap, `Content-Length` checked before body read
- **Bootstrap JWKS fetch (ta-server):** 5-second `AbortController` timeout
- **MCP `fetchJson`:** 10-second timeout + 1 MB response cap

**Pattern to follow:** Any server-side `fetch()` that processes external input must
have both a timeout (`AbortController`) and a response size cap.

---

## `jose` as an Undeclared Dependency

### What is it?

`jose` was used in `fedmgr` but not listed in `package.json#dependencies`.
It worked accidentally because `@letsfederate/kms` depended on it, but that's a
hoisting accident — not guaranteed across npm/pnpm/Yarn versions.

### Fix

`jose` is now explicitly listed in `@letsfederate/fedmgr` dependencies.

**Pattern to follow:** Every package that `import`s a module must declare it
directly in its own `package.json#dependencies`. Do not rely on transitive hoisting.

---

## CI/CD: `secrets` Context in Step Conditions

### What is it?

GitHub Actions `secrets` context is only available inside `${{ }}` expressions.
Writing `if: secrets.FOO != ''` (without `${{ }}`) is silently evaluated as a
truthy string, causing the step to always run.

### Fix

```yaml
# Wrong
- name: Step
  if: secrets.TMI_PRIV_JWE != ''

# Correct
- name: Step
  if: ${{ secrets.TMI_PRIV_JWE != '' }}
```

---

## TTL Validation in CLI

### What is it?

`parseInt(opts.ttl, 10)` returns `NaN` for non-numeric input. Passing `NaN`
to the TMI produces a token with `exp: NaN`, which some verifiers accept as
never-expiring.

### Fix

The `trustmark issue` CLI now validates the TTL before sending:

```typescript
const ttlParsed = parseInt(opts.ttl, 10);
if (isNaN(ttlParsed) || ttlParsed < 60 || ttlParsed > 86400) {
  process.stderr.write(`Invalid --ttl: must be 60–86400 seconds.\n`);
  process.exit(1);
}
```

---

## Summary Checklist

Before shipping federation infrastructure, verify:

- [ ] `ADMIN_TOKEN` is set in production (management + dashboard endpoints)
- [ ] `TMI_ISSUE_TOKEN` is set in production (trustmark issuance)
- [ ] All outbound URLs are validated with `assertSafeUrl()` (SSRF)
- [ ] `entity_id` and `jwks_url` share the same origin (entity binding)
- [ ] JWK embedding strips private fields with `stripPrivateFields()`
- [ ] All `jwtVerify()` calls pin `algorithms` to `SUPPORTED_JWS_ALGS` (EC family only)
- [ ] All `async` Express routes are wrapped with `asyncHandler()`
- [ ] All outbound fetches have timeouts and size caps
- [ ] Every npm package declares its runtime deps explicitly
- [ ] GitHub Actions step conditions use `${{ secrets.FOO != '' }}` syntax
