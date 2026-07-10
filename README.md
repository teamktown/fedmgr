# fedmgr — an OpenID Federation trust backplane for MCP

`fedmgr` lets an AI assistant (and the human beside it) **verify** which MCP tool servers to trust
instead of assuming them. It uses [OpenID Federation](https://openid.net/specs/openid-federation-1_0.html)
to resolve a signed trust chain from a tool server up to an anchor **you** choose, carrying trust marks
that prove the server passed your supply-chain gate.

> **Status:** active development, moving toward a stable home. The published front door is
> `npx @letsfederate/fedmgr`. Until it's on npm, run it from a checkout (below).

## What's in here

This is an npm-workspaces TypeScript monorepo (Node ≥ 24). The pieces:

| Package | Role |
|---|---|
| `packages/fedmgr` | the umbrella CLI (`fedmgr <verb>`) — the front door |
| `packages/oidf-verify` | the OpenID Federation **§10 verifier** — every trust decision routes through it (pinned anchors, per-hop key binding, no `jku`) |
| `packages/ssc-attest` | signed supply-chain evidence — binds artifact digest + SBOM + scan verdict + gate into one in-toto statement |
| `services/ta-server` | Trust Anchor — subordinate registry, proof-of-key enrollment, `federation_fetch` |
| `services/tmi-server` | Trust Mark Issuer — issues marks, gated on passing SSC evidence |
| `services/waypoint` | trust-enforcing MCP gateway — admits a downstream only if it chains to your anchor |
| `packages/kms` | pluggable signing (SoftKMS / PKCS#11 / OpenBao) + trust policy |
| `packages/obs` | structured logging + OpenTelemetry |
| `packages/fedvec` | local semantic search over federation entities (RuVector RVF) |
| `site/` | letsfederate.org — the advocacy site (static, in-browser Q&A + readiness scorecard) |

## Quick start

```sh
npm ci
npm test          # the whole suite (node --test)
npm run build     # tsc -b across the workspace

# run the CLI from the checkout (until it's published to npm):
node packages/fedmgr/dist/bin.js doctor     # preflight: what's installed, what's missing
node packages/fedmgr/dist/bin.js --help     # all commands
```

CLI verbs: `init` · `doctor` · `keys` · `entity` · `trustmark` · `oci` · `cbom` · `search`.

**Stand up a local trust lab** (Trust Anchor + Trust Mark Issuer + registry in Docker):

```sh
./deploy/lab/up.sh          # brings the lab up with health checks
./deploy/lab/down.sh        # tears it down
```

## Where to start reading

- **[docs/walkthroughs/trust-lab-quickstart.md](docs/walkthroughs/trust-lab-quickstart.md)** — the
  fastest path to a working lab and a verified trust chain.
- **[docs/architecture.md](docs/architecture.md)** — what the system actually is today.
- **[docs/dev/running.md](docs/dev/running.md)** — invoking the CLI locally from a checkout.
- **[docs/dev/trust-verification.md](docs/dev/trust-verification.md)** — the one verifier, and how to
  pin your trust anchor on every surface.
- **[docs/adr/](docs/adr/)** — architecture decisions (0002 is the OIDF operational model:
  issuance, hosting, and §10 verification).

## The trust model in one paragraph

Every entity publishes a signed **entity configuration** at
`/.well-known/openid-federation`. A **Trust Anchor** issues **subordinate statements** vouching for the
entities enrolled under it. A verifier walks from a leaf up to a **pinned** anchor, binding each entity's
signing key to its superior's subordinate statement at every hop — so "trusted" means cryptographically
chained to an anchor you chose, not "someone served a plausible URL". A **Trust Mark Issuer** the anchor
authorizes (via its `trust_mark_issuers` claim) mints marks; a supply-chain mark is only issued with
signed evidence that the artifact passed the zero-HIGH/CRITICAL gate. **waypoint** enforces all of this
at admission before exposing any downstream tool.

## License

MIT (per-package). Authored by Chris Phillips.
