# Proposed Workplan — Trust-Fabric Fixes + MCP-Driven OpenID Federation Demonstration

Status: Phases 0–5 complete (2026-06-11); Phase 6 specced — decisions locked, not started
Scope: the 10 review findings on branch
`codex/refactor-docker-compose-for-trust-anchor-implementation`, plus a plan to
**demonstrate and self-validate an MCP that participates in OpenID Federation** —
"the fedmgr CLI experience, but driven over MCP."

This document is written to be read by both humans and AI coding agents. It uses a
small, greppable comment/intent vocabulary (see *Working principles*) so the *why*
behind each change survives future refactors.

---

## Working principles (apply to every item)

**TDD loop (red → green → refactor):**
1. Write the test(s) first and run them — confirm they fail *for the reason stated*,
   not a setup error.
2. Implement the minimal defensive fix.
3. Re-run; confirm green. Then refactor with tests still green.
4. Every security finding gets at least one **negative test** (the attack / invalid
   input must be *rejected*), not just a happy-path test.

**Defensive-coding standard:**
- Trust decisions **fail closed**: unknown / missing / malformed input ⇒
  `trusted:false` or a thrown `TrustError`, never a silent pass or default-allow.
- No `as` type assertion without a runtime guard immediately before it
  (the root of findings #1 and #8).
- Validators return a verdict object; they must not throw on
  *invalid-but-well-formed* input. Reserve throws for programmer error /
  unreachable states.

**Comment convention (human + AI readable).** Adopt a small, greppable tag
vocabulary so both people and models can navigate intent:
- `// INVARIANT:` — a condition that must always hold here (state it, don't assume).
- `// SECURITY:` — why this guard exists and what breaks if removed.
- `// SPEC: OIDF <section name>` — link the line to the OpenID Federation 1.1
  clause it implements (e.g. *Trust Marks*, *Subordinate Statements*,
  *Resolving Trust Chains*). Spec: https://openid.net/specs/openid-federation-1_1.html
- `// WHY:` — rationale for a non-obvious choice (so nobody "simplifies" it back
  into a bug).
- `// AI-NOTE:` — a hint to future automated readers about a cross-file contract
  (e.g. "field names must match `IssueRequestSchema` in tmi-server").

---

## Findings index

| # | Severity | Location | One-line |
|---|----------|----------|----------|
| 1 | High | `fedmgr-mcp/src/openid-ops.ts` | Required trustmark read from subordinate metadata, never from the issued invocation JWT |
| 2 | High | `fedmgr-mcp/src/index.ts` | `issue_trustmark` sends `ttl`/`id`; TMI expects `ttl_s`/`trustmark_id` (silently dropped) |
| 3 | High | `src/fedmgr/auth-commands.js` | Password-grant request dropped its client (Basic) authentication |
| 4 | Med-High | `fedmgr-mcp/src/openid-ops.ts` | Subordinate-statement audience check silently bypassed by catch-retry |
| 5 | Med-High | `fedmgr-mcp/src/openid-ops.ts` | Hardcoded RS256 while the whole stack signs ES256 |
| 6 | Med | `ta-server/src/management/index.ts` | Management API unauthenticated by default |
| 7 | Med | `fedmgr-mcp/src/index.ts` | `verify_trustmark` fetches JWKS from the TA, but trustmarks are TMI-signed |
| 8 | Med-Low | `fedmgr-mcp/src/openid-ops.ts` | Unguarded deref + unhandled verify rejections crash the validator |
| 9 | Low | `src/fedmgr/auth-commands.js` | Error path re-parses a possibly non-JSON body and masks the real failure |
| 10 | Low | `validate-url.ts` ×3 | SSRF guard triplicated and already drifting |

**Refuted during verification (not bugs):** `chain-verifier.ts` `clockTolerance:"60s"`
(jose accepts the string form); `importFirstKey` hardcoded ES256 (matches SoftKMS
signing alg, correct in current scope); permissive-policy-passes-INVALID (documented
intended behaviour of `trust-validator`, not a defect — revisit as a design choice).

---

## Phase 0 — Shared test scaffolding (do first; everything depends on it)

The biggest latent bug (#5) exists because tests used RS256 keys while production
signs ES256. Fix the test substrate before the code.

- **New shared fixture helper** (e.g. `packages/*/test/fixtures/federation-fixtures.mjs`
  or a small internal `@letsfederate/test-fixtures`): mints a realistic
  mini-federation using **the same SoftKMS ES256 path production uses** — a TA key,
  a TMI key, one MCP leaf key, and helpers to produce a signed entity statement,
  subordinate statement, trustmark JWS, and invocation token.
- Assert in the fixture itself that the generated JWS header `alg === "ES256"` — an
  `// INVARIANT:` that pins tests to production reality and prevents silent drift
  back to RS256.
- This fixture becomes the backbone for the `validateMcpInvocation`, trustmark, and
  chain tests below, and for the Phase 6 demonstration.

**Definition of done:** a single import gives any test a coherent, ES256-signed
trust fabric.

### ✅ Done — 2026-06-11

**Environment:** this dev container shipped without a Node toolchain (the
`00-bootstrap.sh` script provisions only the Claude CLI). Installed Node 22.22.3
+ npm 10.9.8 (NodeSource) and ran `npm install --ignore-scripts` — `--ignore-scripts`
because the optional `pkcs11js` native HSM dep fails `node-gyp` without build
headers and is irrelevant to Phases 0–1. *Follow-up:* consider adding Node + a
guarded `pkcs11js` build to the devcontainer bootstrap.

**Delivered:**
- `packages/fedmgr-mcp/test/fixtures/federation-fixtures.mjs` — `Es256MemoryProvider`
  (an in-memory, ephemeral analogue of `SoftKmsProvider`: same EC P-256 / ES256
  contract, same `KeyProvider` surface `kid/jwks/signJwt`), plus `makeEs256Provider`,
  `makeEs256ProviderFactory` (for `entityKmsFactory`), and `protectedHeaderAlg`.
  Commented with the `INVARIANT / SECURITY / WHY / AI-NOTE` vocabulary.
- `packages/fedmgr-mcp/test/federation-fixtures.test.mjs` — 5 invariant tests
  (alg is ES256; JWKS is EC P-256 and never leaks `d`; signed header is ES256 +
  round-trips; distinct/stable kids; factory wiring).

**Design choice:** the fixture is **decoupled from `dist/`** (pure `jose`) so Phase 0
verifies without a full TS build. The convenience of building a whole circle is left
to Phase 1 tests, which call the real `provisionMcpTrustCircle` with the fixture's
provider factory.

**Verification (all green):**
- `node --test test/federation-fixtures.test.mjs` → 5/5 pass.
- Built `@letsfederate/kms` and `@letsfederate/fedmgr-mcp` (`tsc -b`, exit 0).
- Compose smoke test: `provisionMcpTrustCircle` driven by the ES256 fixture emits a
  **subordinate statement and invocation token both signed ES256** (vs the RS256 the
  in-memory OpenBao path produces) — exactly the real-TA/TMI condition Phase 1 needs.
- Full `fedmgr-mcp` suite (existing 2 + new 5) → 7/7 pass.

**Confirmed Phase 1 red condition:** calling `validateMcpInvocation` against this
ES256 circle will throw at `importJWK(opts.trustAnchorJwks.keys[0], "RS256")`
(openid-ops.ts:182) — the latent interop bug (Finding #5) the fixture now makes
testable.

---

## Phase 1 — Core trust-verdict correctness (`openid-ops.ts`)

Findings **#1, #4, #5, #8** all live in `validateMcpInvocation`. Treat as one
coordinated, test-driven rewrite of that function's verification spine.

**Tests to write first** (all using the Phase 0 ES256 fixture):
- ✅ valid invocation with required trustmark in the **invocation JWT** ⇒ `trusted:true`.
- ❌ **#1** invocation JWT missing `trust_marks` (even though subordinate metadata
  lists the mark) ⇒ `trusted:false`, `checks.requiredTrustMarkPresent:false`.
- ❌ **#4** subordinate `aud` does not include the endpoint ⇒ rejected (no silent
  retry-without-audience).
- ❌ **#5** TA/TMI keys are ES256 (the real path) ⇒ verification succeeds
  (this test fails today, proving the RS256 hardcode).
- ❌ **#8** `subordinate.payload.jwks` absent / `keys: []` ⇒ returns `trusted:false`,
  not a `TypeError`.
- ❌ **#8** tampered subordinate signature / expired invocation token ⇒ returns a
  `trusted:false` verdict, not an uncaught throw.

**Fix:**
- **#1** Read required trust marks from the **invocation token payload**
  (`access.payload.trust_marks`) — the authoritative source per OIDF *Trust Marks*
  (the `trust_marks` claim the issuer stamps). Keep the subordinate-metadata check
  only as a secondary "issuer is *entitled* to assert this mark" signal if desired,
  but the gating decision is the JWT claim.
  Comments: `// SPEC: OIDF Trust Marks — the relying party enforces the mark present
  in the presented token` and `// SECURITY: gating on subordinate metadata instead
  of the invocation JWT lets a token with no marks pass.`
- **#4** Remove the `.catch(() => verify-without-audience)` fallback. Audience is a
  hard constraint; if it fails, the verdict is `false`. Replace the hardcoded
  `subordinateSignatureValid:true` with the actual result.
  `// SECURITY: audience binding must not be downgraded on failure.`
- **#5** Replace `importJWK(key, "RS256")` with an algorithm derived from the JWK
  (reuse the `key.alg ?? infer-from-kty` logic already present at line 188; better,
  extract a tiny `importVerifyKey(jwk)` helper and use it for *all three* keys).
  `// AI-NOTE: signing alg is ES256 across the stack (SoftKMS); do not hardcode RS256.`
- **#8** Add runtime guards before every `as` cast: assert `jwks?.keys?.length`
  before indexing; wrap the `entity`/`access` verifications so a verification failure
  becomes `trusted:false` with a populated `checks` map and an `error` field, not a
  throw.
  `// INVARIANT: validateMcpInvocation returns a verdict for all well-formed inputs;
  only programmer error throws.`

### ✅ Done — 2026-06-11

**Tests first (`packages/fedmgr-mcp/test/validate-mcp-invocation.test.mjs`, 7 cases).**
Run against the *unfixed* build first to confirm red for the right reasons:
- `#5` ES256 happy path → threw on `importJWK(taKey, "RS256")`.
- `#1` no mark / wrong mark in the invocation JWT → old code returned `trusted:true`
  (it read the mark from subordinate metadata).
- `#4/#8` endpoint absent from `aud` → threw `unexpected "aud" claim value`.
- `#8` empty TA JWKS → `TypeError` on `keys[0]`.
- `#8` tampered invocation token → threw.
- RS256 OpenBao regression guard → already green (must stay green).
Result before fix: 1/7 pass (only the regression guard).

**Fix (`packages/fedmgr-mcp/src/openid-ops.ts`).** Rewrote `validateMcpInvocation`
and added two helpers:
- `jwsAlgForJwk()` / `importVerifyKey()` — derive the verify alg from the JWK
  (`alg` then kty/crv inference). **#5**: works for ES256 (real TA/TMI) *and*
  RS256 (OpenBao), no hardcode.
- **#1**: `requiredTrustMarkPresent` now reads `access.payload.trust_marks` from the
  **issued invocation JWT**, not subordinate metadata. This is the empirical proof
  of the "mark must be in the JWT we issued" rule.
- **#4**: dropped the bogus `audience:`-on-subordinate + `.catch(retry)` (subordinate
  statements have no `aud`); audience is enforced solely on the invocation token as a
  *check*, not a hard throw.
- **#8**: guarded every array deref (`keys?.[0]`), wrapped the whole body in
  try/catch → returns `{ trusted:false, checks, error }` for any
  well-formed-but-invalid input. `trusted` is now the conjunction of five
  independently-reported checks. Return type widened: `entityId: string | null`,
  added `error?: string`.

**Contract change:** updated the existing `openid-ops.test.mjs` "denies an MCP
endpoint absent from the aud claim" test from `assert.rejects(...)` to asserting the
fail-closed verdict (`trusted:false`, `invocationAudienceValid:false`).

**Verification (all green):**
- `tsc -b` across `@letsfederate/kms`, `fedmgr-mcp`, and the whole workspace `npm run
  build` → exit 0.
- `node --test test/*.test.mjs` (fedmgr-mcp) → **14/14 pass** (5 fixture + 2 existing
  openid-ops + 7 new Phase 1).
- Confirmed no other caller depends on the old throw-based contract (grep: the only
  reference is the definition; not yet exposed as an MCP tool — that's Phase 6).

---

## Phase 2 — MCP ↔ TMI/TA contract drift (`fedmgr-mcp/src/index.ts`)

**Findings #2 and #7.** Root cause: the MCP client and the server schemas drift
silently because nothing tests them together.

**Tests first:**
- **#2** A contract test asserting the body `toolIssueTrustmark` builds
  **schema-validates against the actual `IssueRequestSchema`** imported from
  tmi-server (or a shared schema module). Cases: `ttl_seconds` actually shapes
  `ttl_s`; `trustmark_id` actually shapes `trustmark_id`. Fails today because
  `ttl`/`id` get stripped.
- **#7** `verify_trustmark` with a TMI-signed trustmark resolves the **TMI** JWKS and
  verifies; a test that points it at the TA must *fail to verify* (proving we target
  the right issuer).

**Fix:**
- **#2** Rename the emitted fields to `ttl_s` and `trustmark_id`. Best structural fix
  (altitude): **extract `IssueRequestSchema` into a shared module** both tmi-server
  and fedmgr-mcp import, so the client builds the request *through the schema* and
  drift becomes a compile/test failure forever after.
  `// AI-NOTE: this body is validated by IssueRequestSchema in tmi-server; keep field
  names in lockstep — prefer importing the schema.`
- **#7** Resolve trustmark JWKS from the TMI (or trust the JWS `jku` after the SSRF
  check), not the TA.
  `// SPEC: trust marks are signed by the Trust Mark Issuer, not the Trust Anchor.`

### ✅ Done — 2026-06-11

**Structural fix (single source of truth).** Extracted the TMI request schema into
`packages/tmi-server/src/schemas.ts` (`IssueRequestSchema` + `IssueRequest` type) —
its own side-effect-free module, because `tmi-server/index.ts` self-starts an HTTP
server on import and so cannot be imported just to reuse a schema. `index.ts` now
imports the schema from there. The fedmgr-mcp contract test imports the **same**
schema, so any field drift is a test failure, not a silent 400.

**fedmgr-mcp (`src/index.ts`).** Extracted two exported, pure, unit-testable helpers
from the tool handlers (the handlers themselves still do the network I/O):
- `buildIssueTrustmarkBody(args)` — **#2**: emits `ttl_s` (not `ttl`) and
  `trustmark_id` (not `id`), matching `IssueRequestSchema`. Before the fix Zod
  silently stripped `ttl`/`id` and applied defaults, so the caller's TTL and
  trustmark type were dropped.
- `resolveTrustmarkVerifyJwksUrl(args)` — **#7**: any JWKS override now targets the
  **TMI** (`tmi_url`), not the TA; default is `undefined` so `validateTrustmark`
  uses the trustmark's own (SSRF-checked) `jku`. Renamed the `verify_trustmark`
  tool input `ta_url` → `tmi_url` with an updated description.

**Wiring.** Added `@letsfederate/tmi-server` as a fedmgr-mcp devDependency and a
build-only tsconfig project reference, so `tsc -b` (and `pretest`) always produce
`tmi-server/dist/schemas.js` for the contract test.

**Tests first (`test/issue-trustmark-contract.test.mjs`, 4 cases).** Verified red on
the buggy build (3/4 failing: `ttl_s` defaulted to 3600 not 7200, `trustmark_id`
dropped, verify override returned `undefined` for `tmi_url`), then green after the
fix.

**Verification (all green):**
- Whole-workspace `npm run build` (`tsc -b` ×5) → exit 0.
- fedmgr-mcp suite → **18/18** (added 4 contract cases).
- tmi-server suite → **10/10** (schema extraction is behaviour-preserving).

---

## Phase 3 — OIDC client auth regression (`src/fedmgr/auth-commands.js`)

**Findings #3 and #9.**

**Tests first** (mock the token endpoint):
- **#3** With `OIDC_CLIENT_SECRET` set and an OP that requires client auth, the token
  request must carry `Authorization: Basic …`. Assert the header is present. Add a
  complementary case for a public client where it's legitimately absent, so the fix
  is conditional, not blanket.
- **#9** A non-JSON error body (e.g. `502 text/plain`) on the failure path must still
  produce an informative error, not a JSON-parse throw that masks the HTTP status.

**Fix:**
- **#3** Restore the Basic auth header, gated on a client secret being present.
  Don't unconditionally send it — that's the defensive version.
  `// WHY: confidential clients must authenticate to the token endpoint; public
  clients omit this.`
- **#9** Read the body once as text, attempt `JSON.parse` in a try/catch, fall back
  to raw text + status.
  `// SECURITY/UX: never let error-body parsing hide the underlying HTTP failure.`

### ✅ Done — 2026-06-11

**Fix (`src/fedmgr/auth-commands.js`, `localOidcLogin`).**
- **#3** Restore the HTTP Basic header, **gated on a client secret**: confidential
  clients authenticate; public clients (empty secret) omit it. (`clientCredentialsLogin`
  already sent it unconditionally and was left untouched — correct for that grant.)
- **#9** New `describeTokenError(res)` helper reads the error body once as text,
  tries `JSON.parse`, and falls back to `HTTP <status>: <raw text>` — a plain-text
  502 no longer throws a JSON parse error that masks the real failure.

**Tests first (`scripts/tests/unit/cli/auth-commands.test.js`, Jest).** Updated the
two tests that encoded the bug (happy path now asserts the `Authorization: Basic`
header; the token-error mock now exposes `.text()` like a real response) and added
two cases: public-client omits the header, and a non-JSON error body surfaces
`502 … upstream is down`. Verified red on the unfixed code (3 failing), green after.

**Verification:** `auth-commands.test.js` 10/10 (+1 pre-existing skip); full
`scripts/tests/unit/cli` suite 18/18. Only other `localOidcLogin` caller is the
internal login dispatcher (awaits the token) — unaffected.

---

## Phase 4 — Fail-closed management API (`ta-server/src/management/index.ts`)

**Finding #6.**

**Tests first:**
- Unset `ADMIN_TOKEN` + a "production" signal (e.g. `NODE_ENV=production` or an
  explicit `TA_REQUIRE_ADMIN_AUTH`): server startup **refuses** (throws/exits
  `EX_CONFIG`), or every management route returns `401`.
- Token set + correct Bearer ⇒ `200`; wrong/absent Bearer ⇒ `401`.
- Dev/test mode with no token ⇒ allowed **but emits the existing `[TRUST:WARN]`**
  (preserve local DX).

**Fix:** Make the middleware fail-closed when a production/strict flag is set; keep
the permissive dev path explicit and loud.
`// SECURITY: management endpoints mutate trust (revoke subordinates/trustmarks);
unauthenticated access in production is a trust-fabric compromise.`
`// INVARIANT: in strict mode, no admin route is reachable without a valid bearer
token.`

### ✅ Done — 2026-06-11

**Policy decision (altitude).** Chose **surgical fail-closed** over fail-at-startup:
when admin auth is required but `ADMIN_TOKEN` is unset, the admin plane is sealed
(every management route → `503 admin_disabled`) while the rest of the TA keeps
serving federation. An admin-plane misconfig must not become a full federation
outage. "Required" = `NODE_ENV=production` **or** `TA_REQUIRE_ADMIN_AUTH` truthy.

**Fix (`packages/ta-server/src/management/index.ts`).**
- Added `adminAuthRequired()` (exported) + `isTruthy()` env helpers.
- Reworked `adminAuth({ adminToken, authRequired })`: token set → 401 without a
  valid bearer; no token + required → **503** (sealed); no token + not required →
  allow (dev). Factory now logs three states (`enabled` / `[TRUST:FAIL]` sealed /
  `[TRUST:WARN]` open-dev).

**Tests first (`packages/ta-server/test/management-auth.test.mjs`, supertest, 5 cases):**
production-no-token → 503 (GET + revoke), `TA_REQUIRE_ADMIN_AUTH`-no-token → 503,
token set → 401/401/200, dev → 200, and `adminAuthRequired()` env matrix. Verified
red via a throwaway probe against the stashed old source (returned 200 where the
test demands 503), green after restoring the fix.

**Verification:** ta-server suite **59/59** (54 existing + 5 new); whole-workspace
`tsc -b` clean. Added `supertest` to ta-server devDependencies (one-line lockfile
change).

---

## Phase 5 — Consolidate the SSRF guard (`validate-url.ts` ×3)

**Finding #10** (cleanup, but security-sensitive).

**Tests first:** move/centralize the existing URL-safety tests against the single
shared module; add cases for the ta-server-only behaviours (loopback hostname set,
`[TRUST:FAIL]` prefix) so consolidation can't regress them.

**Fix:** Promote one canonical `assertSafeUrl`/`UrlSafetyError` into a shared package
(`@letsfederate/kms` is the natural home), delete the two copies, re-export.
`// SECURITY: single source of truth for SSRF protection — DNS-rebinding / IP-range
fixes must land in exactly one place.`
`// AI-NOTE: do not re-inline this; three copies previously drifted.`

### ✅ Done — 2026-06-11

**Canonical home.** `@letsfederate/kms` already re-exported `assertSafeUrl`/
`UrlSafetyError`, so it was the natural single source of truth. Enhanced
`packages/kms/src/validate-url.ts` to the **superset** of the three copies' behaviour
(added the trailing-dot loopback form `localhost.` that only ta-server blocked — a
strict increase in protection, never a decrease) and documented it as the one place
SSRF fixes land.

**Deleted the two duplicates** (`packages/fedmgr-mcp/src/validate-url.ts`,
`packages/ta-server/src/utils/validate-url.ts`) and repointed their imports to
`@letsfederate/kms`. fedmgr-cli already imported from kms. Preserved ta-server's
client-facing `[TRUST:FAIL]` enrollment-error signal by prefixing at its response
boundary (the shared validator stays prefix-free — presentation is the caller's job).

**Tests first (`packages/kms/test/validate-url.test.mjs`, 7 cases):** pin the union
of behaviours (scheme, http-in-prod-vs-dev, loopback incl. `localhost.`, private
IPv4 ranges, 127.x dev-only, IPv6 link-local, public allow). `localhost.` was red
against the pre-merge kms validator, green after.

**Verification:** whole-workspace `tsc -b` clean; kms guard 7/7; regressions all
green — kms (0 fail), fedmgr-mcp 18/18, ta-server 59/59, fedmgr-cli 8/8. No dangling
references to the deleted copies remain.

---

## Sequencing & rationale

| Phase | Findings | Why this order |
|------|----------|----------------|
| 0 | — | ES256 fixture unblocks correct tests for #1/#4/#5 |
| 1 | #1 #4 #5 #8 | Core verdict; highest impact, one file |
| 2 | #2 #7 | Contract drift; independent of Phase 1 |
| 3 | #3 #9 | Isolated, legacy JS path |
| 4 | #6 | Isolated server middleware |
| 5 | #10 | Pure refactor; do last to avoid churn under the others |
| 6 | demo | Depends on Phases 1–2 landing (see below) |

Phases 1–4 are independent and can be parallelized once Phase 0 lands. Phase 5 goes
last so consolidation doesn't collide with edits in the other files.

---

## Phase 6 — Demonstrate & self-validate an MCP participating in OpenID Federation

> Goal: "the fedmgr CLI experience, but over MCP" — stand up the trust fabric, have
> an MCP server **enroll into it, receive a trustmark, and be admitted**, then have
> the verdict checked end-to-end. This is the headline demo of cross-domain MCP trust.

### What already exists (the building blocks)

`packages/fedmgr-mcp` is a **stdio MCP server** (`StdioServerTransport`) that already
exposes the trust-fabric operations as MCP tools — effectively the CLI-but-MCP:

| MCP tool | Maps to OIDF / fedmgr concept |
|----------|-------------------------------|
| `initialize_local_ca` | Stand up the local Trust Anchor / circle of trust |
| `enroll_server` | Begin enrollment of an MCP entity under the TA |
| `complete_enrollment` | Proof-of-key, nonce, activation → subordinate becomes active |
| `federation_status` | TA / TMI health + posture |
| `list_subordinates` | `federation_list` — who is in the circle |
| `check_trust_chain` | Resolve leaf → (intermediate) → TA |
| `issue_trustmark` | TMI issues a signed trustmark JWS |
| `verify_trustmark` | Verify a trustmark's signature/expiry |
| `provision_mcp_trust_circle` | Build the in-memory MCP circle + invocation token |
| `get_signed_config` | Signed entity configuration for an MCP |
| `revoke_subordinate` | Tear down a trust relationship |

Defaults: TA `http://localhost:8090`, TMI `http://localhost:8080` (the
`examples/lab/docker-compose.yml` lab), matching the earlier endpoint discussion.

### The gap that blocks the demo

- **No `validate_mcp_invocation` MCP tool exists.** `validateMcpInvocation()` lives in
  `openid-ops.ts` but is **not wired into the tool switch** (`provision_mcp_trust_circle`
  is exposed; the *verdict* is not). So an MCP can be provisioned, but admission
  cannot be exercised/observed over MCP.
- The verdict it would produce is currently wrong (Finding #1) and can't read real
  ES256 keys (Finding #5), and `issue_trustmark` can't actually set the mark type
  (Finding #2). **So the demo depends on Phases 1–2 landing first.**

### Plan

1. **Expose the verdict as a tool — `validate_mcp_invocation`** (new tool in
   `fedmgr-mcp/src/index.ts`). Inputs: the MCP's invocation token, the target
   endpoint, and the TA reference; output: the `{ trusted, entityId, endpoint, checks }`
   verdict from the (now-fixed) `validateMcpInvocation`. This is the piece that makes
   admission *observable* over MCP.
   `// AI-NOTE: this tool is the empirical proof of the "trustmark must be present in
   the issued JWT" rule — keep it gating on access.payload.trust_marks.`

2. **Scenario test — the happy path, driven through the MCP CallTool path**
   (`packages/fedmgr-mcp/test/mcp-demo-scenario.test.mjs`, TDD, ES256 fixture):
   `initialize_local_ca` → `enroll_server` → `complete_enrollment` →
   `issue_trustmark` → `check_trust_chain` (leaf → TA) → `verify_trustmark` →
   `validate_mcp_invocation` ⇒ `trusted:true`. Each step asserts the OIDF artefact it
   produced (signed statement, active subordinate, signed trustmark, resolved chain).

3. **Negative scenarios (the proof it's "rock solid"), same harness:**
   - invocation JWT **missing the required trustmark** ⇒ `trusted:false`
     (proves Finding #1's rule).
   - endpoint **absent from `aud`** ⇒ `trusted:false` (proves Finding #4).
   - trustmark **revoked** via `/trust-mark-status` ⇒ `trusted:false`.
   - MCP enrolled under a **different/unaccepted TA** ⇒ `trusted:false`.

4. **Cross-domain capstone (separate follow-on):** two TAs / two circles; an MCP
   trusted in circle A is **denied** in circle B unless B explicitly accepts A's
   anchor. This is the cross-domain MCP-trust illustration the earlier assessment
   called for.

5. **Walkthrough doc** (`docs/walkthroughs/mcp-openid-federation-demo.md`): the
   `docker compose up` lab + the exact MCP tool-call sequence and expected verdicts,
   so a human or an agent can reproduce it.

### Can Claude validate this directly (CLI-but-MCP)?

**Yes — two complementary ways:**

- **As a scenario/CallTool test (always available, CI-friendly).** The harness in
  step 2 drives the real MCP request handlers and asserts verdicts. This is the
  authoritative, repeatable proof and runs without a live model in the loop.

- **As an interactive MCP client (Claude in the loop).** Because `fedmgr-mcp` speaks
  stdio MCP, it can be registered as an MCP server in a Claude Code / agent session.
  Claude then calls `initialize_local_ca`, `enroll_server`, …, `validate_mcp_invocation`
  as tools and narrates/validates each step — literally "the fedmgr CLI experience,
  but over MCP." This requires the server to be added to the session's MCP config and
  the lab (TA/TMI) to be running; it is a live demo, with the scenario test as its
  deterministic backstop.

**Bottom line:** the MCP surface to do this already exists; what's missing is (a) the
`validate_mcp_invocation` tool to make admission observable, and (b) the Phase 1–2
fixes so the verdict and trustmark issuance are actually correct. After those, both
the automated scenario test and a live Claude-driven walkthrough become a citable,
rock-solid demonstration of cross-domain MCP trust via OpenID Federation.

---

## Phase 6 — expanded plan (decisions locked 2026-06-11)

The section above is the *core mechanic*. This section is the agreed, decision-locked
build plan: a user runs **their own** HSM-rooted trust ecosystem, **signs** their
containers end-to-end through a local registry, **enrolls the MCPs they already use**,
and has a **gateway** admit only attested MCPs — with revocation kill-switches and
cross-org trust. Everything is TDD (red→green, plus negative tests). No silent caps.

### Architecture decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Root of trust | **HSM-rooted TA** (SoftHSM/PKCS#11 in compose) | Non-exfiltratable root key; the *same* HSM key also signs cosign images (`cosign --key pkcs11:…`) — one hardware root for statements + artifacts |
| Container signing | **cosign signature + digest-bound trustmark (both)** | cosign = "real bits"; trustmark = "passed *our* policy" |
| Evidence | **SBOM + build provenance**, stored in the local registry | Referenced from the trustmark `evidence`/`adopted_from_jws` fields (already exist) |
| Registry | **Local OCI registry promoted into the demo compose** | 100% offline round trip (`examples/lab` already runs `registry:2` on `:5000`) |
| cosign mode | **Key-based using the HSM key** (keyless/Fulcio noted as a connected variant) | Offline-first demo, no external CA |
| Catalogue/inventory | **SQLite** as a compose resource (volume-backed) | `ta-server` already uses `better-sqlite3` (`sqlite-store.ts`); reuse the pattern for the MCP catalogue |
| "Signed back" UX | Self-signed entity statement / PoP nonce | The "I signed something and can prove it" moment — already in enrollment (`proof_jws`) |
| Keyless stdio MCPs | fedmgr **mints & holds keys on their behalf** | Matches `provisionMcpTrustCircle`'s `entityKmsFactory` pattern |

### The gateway as Policy Enforcement Point (PEP)

`federation-admin` (`:3001`) is already an OAuth broker: GitHub sign-in → `/token-exchange`
→ a federation JWT with `aud: ['mcp-demo','mcp-server']` (`token-exchange-service.js`,
`oauth-handler.js`). The enhancement: **before** minting a per-MCP audience, the gateway
resolves that MCP's trust chain to an accepted anchor and checks its trustmark. Only
attested MCPs land in the token `aud`. This unifies **human identity (GitHub SSO)** with
**machine trust (OIDF chain + trustmark)** in one admission decision; `validate_mcp_invocation`
at the MCP boundary is then defense-in-depth.
- *TDD:* token-exchange issues `aud` only for MCPs that pass trust validation; a
  revoked/untrusted MCP is excluded from `aud` (and later denied by the validator too).

### How MCP extensions plug in (retrofit story)

MCP extensions are negotiated at the `initialize` handshake via `capabilities.extensions`
(`{vendor}/{name}` + a settings object; opt-in, graceful degradation). Two tiers:

- **Tier 1 — extension-aware (in-band).** Define `org.letsfederate/oidf-trust`: at
  `initialize` the MCP server advertises `{ entityId, federationConfigUrl, trustMarks?,
  trustChainHint? }`; the client/gateway resolves the chain to an accepted anchor and
  checks the marks before trusting the server. **Our E1 example MCP is the reference
  implementation** ("our example MCPs are the example"). Maps onto the official
  `io.modelcontextprotocol/oauth-client-credentials` (the gateway is the M2M auth server)
  and **Enterprise-Managed Authorization** (central governance → the intermediate model
  in E5b).
- **Tier 2 — legacy (out-of-band).** MCPs that don't speak the extension (most stdio
  servers) are wrapped: the **walker (E9)** discovers and enrolls them, fedmgr holds
  their keys, and trust is asserted *about* them in the catalogue + enforced at the
  gateway boundary. Graceful degradation, no MCP code changes required.

### Demonstration set, ordered (lowest-effort first)

| Step | Demo | Proves | Effort | Deps |
|---|---|---|---|---|
| **6.0** | `validate_mcp_invocation` MCP tool | admission is observable over MCP | Low | Phases 1–2 ✅ |
| **6.1** | **E1 enriched** | HSM TA bootstrap → discovery → PoP self-sign → push→cosign→SBOM→digest-bound trustmark→verify→admit (offline round trip); example MCP = `oidf-trust` extension reference impl | Med | 6.0, lab compose |
| **6.2** | **E8 rogue gauntlet** | forged / expired / wrong-anchor / swapped-JWKS / wrong-digest / missing-mark / wrong-aud → each **denied** with the exact failing check | Low–Med | 6.1 |
| **6.3** | **E9 walker + SQLite catalogue** | walk Claude Code `.mcp.json` → inventory in SQLite → enroll into circle → **drift detection** (signed baseline diff) | Med | 6.0 |
| **6.4** | **Gateway PEP** | GitHub SSO + trust admission unified; token `aud` scoped to attested MCPs | Med | 6.0 |
| **6.5** | **E5b large-org intermediates** | root TA delegates to department intermediates (delegated capability, central governance); revoke a department at the root → all its leaves go INVALID | Med | 6.1 |
| **6.6** | **E5a vendor accepted-anchor** | accept a vendor's sovereign TA so its signed images/MCPs are permitted; drop the anchor → instant distrust | Med | 6.1 |

Recommended order: **6.0 → 6.1 → 6.2** (the low-effort headline block) → **6.3** (your
inventory/hardening tool) → **6.4** (gateway) → **6.5 / 6.6** (cross-org trust).

### TDD outcomes per step (what "done" asserts)

- **6.0** — tool appears in `ListTools`; `CallTool` returns the verdict JSON; gates on
  `access.payload.trust_marks`. Red: tool absent.
- **6.1** — `init_local_ca` on the HSM provider publishes entity config + JWKS (no private
  `d`); MCP discovers + fetches the TA; PoP/self-sign verifies against its own JWKS
  ("I signed something and can prove it"); round-trip integration script: image pushed to
  `:5000`, cosign sign+verify (HSM key), SBOM attached, TMI issues a **digest-bound**
  trustmark (evidence → SBOM ref), verify ⇒ admit. *(Unit tests where pure; a scripted
  compose-e2e for the cosign/registry leg, clearly labelled — no pretending a mock is the
  round trip.)*
- **6.2** — each attack returns `trusted:false` with the specific failed check (reuses the
  Phase 1 negatives + adds wrong-digest and cosign-signature-invalid cases).
- **6.3** — parser enumerates servers from a sample `.mcp.json`; enroll creates catalogue
  rows + trustmarks; **drift**: add/remove/modify a server → diff reports it against the
  *signed* baseline; unchanged re-scan → no drift; discovery is read-only, enroll explicit.
- **6.4** — token-exchange includes a per-MCP `aud` only when trust validation passes;
  revoked MCP excluded.
- **6.5** — chain leaf→dept→root resolves VALID; revoke dept at root → leaf chain INVALID.
- **6.6** — vendor mark accepted iff vendor TA is in the accepted-anchor list; remove it →
  previously-allowed image now denied. New: a small **accepted-anchor policy** module
  (unit-tested) — the one genuinely new mechanism.

### `/examples` layout + per-example doc template

```
examples/
  lab/                      # existing TA+TMI+OCI(:5000) substrate (+ SoftHSM, +catalogue.db volume)
  01-trust-circle/          E1   06-vendor-accepted-anchor/  E5a
  02-rogue-gauntlet/        E8   07-gateway-pep/             6.4
  03-mcp-inventory/         E9   (extension ref impl lives with 01)
  05-org-intermediates/     E5b
```
Each folder = a **succinct README** with five headings: **Why** (rationale) · **What it
proves** · **Run it** (`docker compose … up` + the tool-call sequence) · **What to look
for** (expected verdicts) · **The failure case** (the deny). Plus a compose overlay on
`examples/lab` and one scenario test.

### Outcomes / pragmatic leverage

A regular user can: run **their own** HSM-rooted trust ecosystem; **sign** what they ship
(cosign + trustmark + SBOM, fully local); **enroll the MCPs they already use** and get
alerted on config drift; have a **gateway** admit only attested MCPs after they sign in;
**revoke** trust instantly; and **accept a vendor's** or **delegate to a department's** TA
under explicit policy. The `org.letsfederate/oidf-trust` extension + the example MCPs give
third parties a concrete retrofit path; the legacy walker covers everything that can't be
changed.

### Risks / notes

- **`pkcs11js` native build** must be baked into the HSM demo image (it fails under
  `--ignore-scripts`); `examples/lab/Dockerfile.softhsm-test` is the place.
- **cosign offline** ⇒ key-based with the HSM key (keyless needs Fulcio/internet).
- **MCP config locations** vary by client; target Claude Code `.mcp.json` first, Desktop
  config (`claude_desktop_config.json`) as a follow-on.
- **SQLite as a compose "resource"** = a persistent volume holding `catalogue.db`, owned by
  the catalogue/TA service (SQLite is embedded, not a server).

---

## Definition of done (whole effort)

- Every finding has a red test that now passes green, **plus** a negative/attack test
  that stays red→reject.
- `validateMcpInvocation` enforces the trustmark from the invocation JWT — the
  empirical proof of the "MCP must present the mark in the JWT we issued" requirement,
  now a citable test.
- A `validate_mcp_invocation` MCP tool exists and is exercised by the Phase 6 scenario.
- No `as` cast in the trust path without a preceding runtime guard.
- All three duplicated SSRF guards collapsed to one.
- New comments use the `INVARIANT / SECURITY / SPEC / WHY / AI-NOTE` vocabulary so the
  next reader (human or model) inherits the intent.
