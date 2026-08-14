# Trust verification — one engine, pinned anchors

Every trust decision in fedmgr goes through **`@letsfederate/oidf-verify`** — the OpenID Federation
§10 verifier. There is no second, weaker path: the old `validateTrustmark` / `validateTrustChain`
(which trusted a mark's `jku` and skipped chain key-binding) were removed from `@letsfederate/kms`.

## What the engine guarantees

- **Chain (`verifyTrustChain`)** — starts at the subject's self-signed entity configuration, follows
  **every** `authority_hint`, and at each hop verifies the superior's subordinate statement with the
  superior's keys, checks `iss`/`sub`/`typ`/`exp`, and **binds** the subject's configuration-signing key
  to the `jwks` in that subordinate statement. It terminates only at a **pinned** trust anchor. Cycles
  and depth are bounded. Anything else is `INVALID` (fail-closed; there is no `WARN`).
- **Trust mark (`verifyTrustMark`)** — resolves the mark's **issuer** through a `verifyTrustChain` to a
  pinned anchor, verifies the mark with the issuer's **chain-resolved** keys (never the mark's `jku`),
  and requires the `(trust_mark_type, issuer)` pair to be authorized by the anchor's
  `trust_mark_issuers`. `trust_mark_type` is read, with the legacy `id` claim accepted for migration.

## Pinning the anchor (do this in production)

The anchor's key must be pinned **out of band** — fetching it from the network and trusting whatever
comes back is not verification. Every surface accepts a hard pin:

| Surface | How to hard-pin |
|---|---|
| waypoint admission | `WAYPOINT_ANCHOR_JWKS='{"<anchor entity id>":{"keys":[…]}}'` |
| TMI self-gate | `TMI_ANCHOR_JWKS='{"keys":[…]}'` (anchor = `TMI_AUTHORITY_HINTS[0]`) |
| `fedmgr trustmark check` / `adopt` | `--anchor-jwks <file>` (JWKS JSON) |
| `fedmgr oci verify-trustmark` | `--anchor-jwks <file>` |
| MCP tools `verify_trustmark` / `check_trust_chain` | `trust_anchor_jwks` argument |

Without a hard pin, the consumer falls back to **trust-on-first-use** (fetch the anchor entity
configuration once and cache it) and logs a `[TRUST:WARN]`. TOFU is a bootstrap convenience, not a
production posture.

## The TA must declare its issuers

A trust mark only verifies if the anchor authorizes its issuer. Set on the TA:

```
TA_TRUST_MARK_ISSUERS='{"https://letsfederate.org/tm/mcp":["https://tmi.example"]}'
```

This is published as the top-level `trust_mark_issuers` claim in the TA entity configuration.

## Making an MCP server a resolvable leaf

```
fedmgr entity config \
  --entity-id https://mcp.example \
  --authority https://ta.example \
  --endpoint https://mcp.example/mcp \
  --key-out ./keys --out ./ec.jwt
```

Host `ec.jwt` at `https://mcp.example/.well-known/openid-federation` (Content-Type
`application/entity-statement+jwt`), then enroll with the TA (proof-of-key) so it serves a subordinate
statement binding your key. A verifier can then resolve you. See ADR 0002 for the full model.

## cosign attestation verification

`fedmgr oci verify-trustmark` requires a **specific** signer — `--certificate-identity` and
`--certificate-oidc-issuer` (a bounded regexp is allowed; `.+` is refused). After cosign verifies the
signature, the embedded trustmark JWS is verified chain-rooted and bound to the image digest (from a
`repo@sha256:…` ref or `--expect-digest`). A valid mark for a different image is rejected.
