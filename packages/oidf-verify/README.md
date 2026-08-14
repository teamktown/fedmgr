# @letsfederate/oidf-verify

OpenID Federation **§10** trust-chain and trust-mark verification. The single,
spec-correct verifier that every trust decision in [fedmgr](https://github.com/letsfederate/fedmgr)
routes through.

- **Chain** (`verifyTrustChain`) — walks a leaf up to a **pinned** trust anchor, binding each
  entity's configuration-signing key to its superior's subordinate-statement `jwks` at every hop;
  checks `iss`/`sub`/`typ`/`exp`; follows **all** `authority_hints`; bounded against cycles. No
  trust-on-first-use in the core — the anchor key is supplied out of band.
- **Trust mark** (`verifyTrustMark`) — resolves the mark's issuer through a chain to a pinned anchor,
  verifies it with the issuer's **chain-resolved** keys (never the mark's `jku`), and requires the
  `(trust_mark_type, issuer)` pair to be authorized by the anchor's `trust_mark_issuers`.

Fail-closed and binary (`VALID` / `INVALID`). Zero dependencies beyond `jose`.

```ts
import { verifyTrustChain, verifyTrustMark, resolvePinnedAnchor } from "@letsfederate/oidf-verify";

const anchor = { entityId: "https://ta.example", jwks: pinnedJwks };
const chain = await verifyTrustChain("https://mcp.example", { trustAnchors: [anchor] });
if (chain.state === "VALID") { /* trusted, rooted in your pinned anchor */ }
```

See [`docs/adr/0002`](https://github.com/letsfederate/fedmgr/blob/main/docs/adr/0002-oidf-operational-model-issuance-and-verification.md)
for the operational model and `docs/dev/trust-verification.md` for anchor pinning.

MIT.
