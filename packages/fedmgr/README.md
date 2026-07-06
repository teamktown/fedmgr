# @letsfederate/fedmgr

One front door for **OpenID Federation trust in MCP**. `fedmgr` lets you mint a local trust ecosystem,
manage keys, make an MCP server a resolvable federation leaf, issue and verify trust marks, attest OCI
artifacts, and search a federation — so an AI assistant can **verify** which tool servers to trust
instead of assuming them.

```sh
npx @letsfederate/fedmgr doctor        # preflight — what's installed, what's missing
npx @letsfederate/fedmgr --help        # all commands
```

## Commands

| Verb | Does |
|---|---|
| `init` | mint a local trust ecosystem (CA, anchor, issuer, self-provenance, SSC gate) |
| `doctor` | preflight the toolchain (human + `--json`) |
| `keys` | initialize signing keys (SoftKMS) |
| `entity` | mint a hostable OpenID Federation entity configuration for a leaf (e.g. an MCP server) |
| `trustmark` | issue / verify (chain-rooted) / adopt trust marks |
| `oci` | attach + verify trustmark attestations on OCI images (pinned signer, digest-bound) |
| `cbom` | emit a signed Cryptographic Bill of Materials (CycloneDX 1.6) |
| `search` | semantic search over federation entities |

## Trust, verified

Every trust decision routes through [`@letsfederate/oidf-verify`](https://www.npmjs.com/package/@letsfederate/oidf-verify):
§10 chain validation with per-hop key binding, **pinned** trust anchors, and trust marks verified via
chain-resolved issuer keys + the anchor's `trust_mark_issuers` — never a mark's `jku`. Supply-chain
marks are gated on signed [`@letsfederate/ssc-attest`](https://www.npmjs.com/package/@letsfederate/ssc-attest)
evidence that the artifact passed a zero-HIGH/CRITICAL scan.

See the [repo](https://github.com/teamktown/fedmgr) for the full trust model, the local lab, and ADRs.

MIT.
