# ADR 0002 — OIDF operational model: entity issuance, hosting, and §10 verification

- **Status:** Proposed
- **Date:** 2026-07-05
- **Context:** Deep re-assessment finding #1/#2 (critical) — trust marks verified against a
  presenter-supplied `jku`; chain walk skips §10 key-binding. Reviewer (repo owner) raised that
  we may be **missing the issuing step**: an MCP leaf should hold its own key, enroll, pass
  governance, and be *identified* by a statement the trust anchor signs. This ADR reconciles that
  model against OpenID Federation 1.0 and against the code as it stands, and defines the operational
  elements the shared verifier depends on.

## The one distinction that resolves the confusion

OpenID Federation has **two** kinds of signed JWT, both loosely called "entity statements". Conflating
them is the root of finding #1/#2:

| | **Entity Configuration** | **Subordinate Statement** |
|---|---|---|
| Who signs | the entity, about **itself** | the **superior** (TA/intermediate), about a subordinate |
| `iss` / `sub` | `iss == sub == entity` | `iss == superior`, `sub == subordinate` |
| Hosted at | `<entity>/.well-known/openid-federation` | superior's `federation_fetch?sub=<entity>` |
| Carries | the entity's own `jwks`, `metadata`, `authority_hints`, its `trust_marks` | **the subject's `jwks`** (+ optional metadata), signed by the superior |
| Proves | "I claim these are my keys" | "I, the superior, vouch that these are the subordinate's keys" |

A leaf's **identity in the federation is the _binding_ of the two**: the subordinate statement says
"leaf's legitimate keys are X (per me, the TA)"; the leaf's Entity Configuration is signed by X;
therefore the leaf is the entity the TA vouched for, up to a trust anchor the verifier pinned
out-of-band. **Neither document alone is sufficient**, and — importantly — **the TA does not issue the
leaf's Entity Configuration**. The leaf self-issues that. The TA issues a *statement about* the leaf.

So the reviewer's model is correct with one refinement: "issued an entity statement signed by the
trust anchor which identifies it" = the **subordinate statement**; the leaf must *additionally*
self-publish its own Entity Configuration for the binding to be checkable.

## What the code already does (credit where due)

- **Enrollment with proof-of-key** (`ta-server/src/enrollment/index.ts`): leaf proves possession of
  its key against a nonce; on success the TA stores the leaf's `jwks` and **issues a subordinate
  statement** via `signSubordinateStatement` (iss=TA, sub=leaf, embeds leaf jwks, `typ:
  entity-statement+jwt`). Origin-binding + SSRF guards are present.
- **Serving** (`ta-server` `GET /federation_fetch?sub=`): returns that subordinate statement, and
  **404/403s for pending/revoked/decommissioned** subordinates — i.e. entity-level revocation already
  breaks chain resolution today (the audit under-credited this).
- **Provisioning helper** (`fedmgr-mcp/src/openid-ops.ts` `registerMcpEntity`): generates *both* a
  leaf **Entity Configuration** (`signEntityStatement`, `authority_hints:[TA]`) and the subordinate
  statement — proving the intended shape end to end.
- **Intermediate tier scaffolding**: `isIntermediate()` + `GET /intermediates` exist, so the
  offline-root → intermediate → leaf hierarchy is anticipated.

## The gaps (this is the missing "issuing step", precisely located)

- **G1 — the leaf never *hosts* its Entity Configuration.** The real enrollment path produces only the
  subordinate statement; the leaf EC is generated solely inside a helper that holds every key, and
  nothing serves it at `<leaf>/.well-known/openid-federation`. A §10 verifier that starts at the leaf
  has nothing to fetch. (This is the half the reviewer sensed was missing.)
- **G2 — no key-binding verifier.** No verifier checks that the key which signed the leaf's EC appears
  in the superior's subordinate-statement `jwks`, nor checks `iss/sub/typ/exp` per hop, nor pins the
  TA key out-of-band, nor follows more than `authority_hints[0]`. (finding #2)
- **G3 — the TA doesn't declare its issuers.** `trustAnchorMetadata` omits `trust_mark_issuers`
  (confirmed at `ta-server/src/index.ts:295`), so a verifier can't discover which TMI the anchor
  authorizes — and trust-mark verification currently trusts the mark's own `jku`. (findings #1, #4)
  This is the reviewer's "the TMI needs to be *within* the trust anchor": in OIDF that means the TMI is
  (a) enrolled as a subordinate of the TA and (b) named in the TA's `trust_mark_issuers` for the mark
  types it may mint.
- **G4 — trust-mark (not entity) revocation isn't consulted at verify.** Entity revocation already
  breaks fetch; per-mark status via `trust-mark-status` is not checked.
- **Naming trap:** enrollment returns the subordinate statement under the field
  `signed_entity_statement` — the exact conflation above. Rename to `signed_subordinate_statement`.

## Decision — the reconciled operational model

Adopt the full OIDF chain-of-trust, with an explicit offline-root option:

```
Root Trust Anchor (key pinned out-of-band; may be kept OFFLINE)
  · EC: authority_hints:[]  · metadata.federation_entity.trust_mark_issuers:{ <type>: [<tmi>] }
  · periodically signs subordinate statements about its intermediates (long TTL)
        │
        ▼
Intermediate (optional, for scale — the "subordinate CA" analog; ONLINE)
  · EC: authority_hints:[TA]  · runs federation_fetch + enrollment for leaves
        │
        ├──────────────────────────────┐
        ▼                              ▼
Trust-Mark Issuer (TMI)            MCP leaf
  · enrolled subordinate          · own keypair
  · listed in TA trust_mark_issuers · EC self-hosted at /.well-known/openid-federation
  · issues trust-mark+jwt           ·   authority_hints:[TA|intermediate], jwks, metadata,
    (trust_mark_type) to leaves     ·   trust_marks:[{trust_mark_type, trust_mark}]
                                    · enrolled (proof-of-key) → superior serves its subordinate stmt
```

**Verification (waypoint / `fedmgr trustmark verify`), the shared §10 engine:**
1. Fetch the leaf's Entity Configuration; verify its self-signature with its own `jwks`; check
   `iss==sub`, `typ`, `exp`.
2. For each `authority_hint`, fetch the superior's subordinate statement about the current entity;
   verify it with the superior's keys; check `iss==superior`, `sub==current`, `typ`, `exp`; **bind**:
   the current entity's EC-signing key MUST be in that statement's `jwks`.
3. Recurse up until an `authority_hint` is a **pinned** trust anchor (key from config, never network).
4. Trust marks: for each mark in the leaf's `trust_marks`, require its `trust_mark_type` to be one the
   relying party requires, its `iss` to be authorized in the anchor's `trust_mark_issuers`, verify the
   mark's signature with the **issuer's chain-resolved federation keys (never `jku`)**, and check the
   issuer's `trust-mark-status` for that mark.

Roles map to PKI intuition: **TA = offline root**, **intermediate = subordinate CA**, **subordinate
statement = the cert the CA issues**, **entity configuration = the leaf's CSR-signed self-assertion**,
**trust_mark_issuers = the CA policy naming who may issue which attribute certificates**.

## Consequences

- The shared verifier (finding #1/#2 fix) is necessary but **not sufficient** alone — it must be paired
  with **G1 (leaf EC hosting)** and **G3 (TA `trust_mark_issuers`)** or there is nothing correct to
  verify against. This ADR expands the finding-#1 workstream to include the issuance/hosting side.
- Backwards-compat: keep reading the legacy `id` trust-mark claim and the `jku` header as a
  *non-authoritative hint* during migration, but never as the root of trust.
- Offline root is a deployment posture, not new code: the TA's signing key can live in an offline KMS
  and sign intermediate subordinate statements periodically; the online surface serves cached
  statements. `isIntermediate()` + `/intermediates` already anticipate the tier.

## Implementation status (2026-07-05)

**Done.** The shared `@letsfederate/oidf-verify` engine ships (§10 key binding, pinned anchors, all
authority_hints, trust marks via chain-resolved keys + `trust_mark_issuers`, never `jku`).
**Every trust decision routes through it** — waypoint admission, the `verify_trustmark` /
`check_trust_chain` MCP tools, the CLI `trustmark check` / `adopt`, and the TMI self-gate. The weak
`validateTrustmark` / `validateTrustChain` were **removed from kms** (zero consumers first), so no weak
path remains. G1 (`fedmgr entity config` mints a hostable leaf configuration) and G3 (TA
`trust_mark_issuers`, TMI `trust_mark_type` + `typ: trust-mark+jwt`, field rename) landed. `oci
verify-trustmark` now pins the cosign signer and verifies the embedded mark bound to the image digest.

**Anchor pinning.** All consumers resolve their anchor via `resolvePinnedAnchor`: a hard-pinned JWKS
(preferred) from config — `WAYPOINT_ANCHOR_JWKS`, `TMI_ANCHOR_JWKS`, the CLI `--anchor-jwks <file>`, or
inline `trust_anchor_jwks` on the MCP tools — else trust-on-first-use (fetch the anchor EC once) with a
logged warning. Hard-pinning is strongly recommended for production.

**Not yet done (Tier 2/3):** per-mark revocation-at-verify (G4 — entity revocation already fails the
chain via a 403 on `federation_fetch`); binding SBOM+scan+trustmark into one signed in-toto statement +
making the SLA a hard gate on issuance; the resolve endpoint and metadata policy.

## Scope of the first implementation pass (proposed)

1. **Shared `@letsfederate/oidf-verify`** module: the §10 algorithm above (pin TA, bind keys,
   iss/sub/typ/exp, all authority_hints), plus trust-mark verification via `trust_mark_issuers` +
   chain-resolved keys. TDD: the five named red tests first (forged chain, key-substitution, expired
   statement, jku-forgery rejected, revoked→INVALID).
2. **G1**: a `fedmgr`-side capability to emit/host a leaf Entity Configuration at
   `/.well-known/openid-federation` (waypoint can serve it for co-located servers; a `fedmgr entity
   config` command emits it for externally-hosted ones).
3. **G3**: add `trust_mark_issuers` to `trustAnchorMetadata`; rename the enrollment response field.
4. Rewire waypoint admission + `fedmgr trustmark verify` + fedmgr-mcp onto the shared engine; delete
   the `fakeValidator` mock so tests exercise the real engine.
5. Follow-ups (separate pass): per-mark revocation-at-verify (G4), resolve endpoint, metadata policy.
