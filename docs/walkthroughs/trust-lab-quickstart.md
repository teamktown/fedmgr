# Trust Lab Quickstart — run it, then drive it from Claude Code

A 5-minute path to a working OpenID-Federation trust lab: a **Trust Anchor (TA)**,
a **Trust Mark Issuer (TMI)**, and a local **OCI registry** — then sign a container,
bind a trustmark to it, and verify the whole chain. Finally, wire it into **Claude
Code** so you (or an AI assistant) can drive the trust operations conversationally.

Audience: a developer new to OpenID Federation, lightly comfortable with crypto.

## What you get

```
trust.letsfederate.org  ← canonical Trust Anchor identity (entity id)
   │  (in the lab it resolves to https://localhost:9443)
   ├── TMI  https://localhost:9444   issues signed, digest-bound trustmarks
   └── registry localhost:5000      stores your images + cosign signatures + SBOMs
```

## Prerequisites

- **Docker** (the lab runs in containers). That's all you need to start it.
- For the container round trip you also need **cosign**, **syft**, and **jq**.
  Install hints are printed by the script if any are missing — it never fakes a step.

## 1. Start the lab (one command)

```bash
./deploy/lab/up.sh
```

This generates EC P-256 keys (encrypted at rest — no host `step` CLI needed),
builds the TA/TMI images on first run, starts everything, and waits for health.
You should see:

```
[lab] TMI healthy
[lab] TA healthy
[lab] UP  →  TA=https://localhost:9443  TMI=https://localhost:9444  statements=https://localhost:9445
[lab] TA subordinates: ["https://localhost:9444"]
```

The last line means the TA already vouches for the TMI — a real trust chain.

Stop and clean up anytime with `./deploy/lab/down.sh`.

## 2. The container round trip

```bash
./examples/01-trust-circle/round-trip.sh
```

build → push to the local registry → **cosign sign** → **syft SBOM** → the **live
TMI issues a digest-bound trustmark** → cosign verify + trustmark digest binding.
A green run ends with `[TRUST:VALID] round trip complete`. See
[`examples/01-trust-circle/README.md`](../../examples/01-trust-circle/README.md) and
the captured evidence in [`docs/history/evidence/`](../evidence/).

> Note on HSM-rooted signing: the lab uses a key-based cosign signature. Signing the
> image *directly* with a SoftHSM/PKCS#11 key needs a cosign built with the
> `pkcs11key` tag (the release binary returns "unimplemented") or a cloud-KMS key.

## 3. Use it from Claude Code

`@letsfederate/fedmgr-mcp` is a stdio MCP server. Build it, then register it.

```bash
npm ci
npm run build -w @letsfederate/fedmgr-mcp

# Register the local build with Claude Code (project scope):
claude mcp add fedmgr -- node "$(pwd)/packages/fedmgr-mcp/dist/bin.js"
# (once published, instead: claude mcp add fedmgr -- npx -y @letsfederate/fedmgr-mcp)
```

Or commit a project `.mcp.json`:

```json
{
  "mcpServers": {
    "fedmgr": { "command": "node", "args": ["packages/fedmgr-mcp/dist/bin.js"] }
  }
}
```

In Claude Code, run `/mcp` — you should see **waypoint** exposing 13 `fedmgr__*` tools (via the trust-enforcing mux). The tools
default to the lab URLs (`ta_url=https://localhost:9443`, `tmi_url=https://localhost:9444`),
so with the lab up they "just work". Try prompts like:

- “Using fedmgr, provision an MCP trust circle and then validate the invocation.”
- “Issue a trustmark for `https://trust.letsfederate.org/mcp/fedmgr-mcp` bound to image
  digest `<sha256:…>`, then verify it.”
- “Check the trust chain for the TMI up to the trust anchor.”

Key tools: `validate_mcp_invocation` (the fail-closed admission verdict),
`provision_mcp_trust_circle`, `issue_trustmark`, `verify_trustmark`,
`check_trust_chain`. See
[`docs/walkthroughs/validate-mcp-invocation.md`](validate-mcp-invocation.md).

## 4. About the `org.letsfederate/oidf-trust` extension

When Claude Code connects, fedmgr-mcp **advertises** an MCP extension at the
`initialize` handshake declaring its OIDF identity:

```json
"capabilities": { "extensions": {
  "org.letsfederate/oidf-trust": {
    "entityId": "https://trust.letsfederate.org/mcp/fedmgr-mcp",
    "trustAnchor": "https://trust.letsfederate.org",
    "trustMarks": ["https://letsfederate.dev/trust-mark/mcp-server/v1"]
}}}
```

**Honest scope:** a *generic* MCP client (Claude Code today) does not act on a custom
extension — per the MCP spec, unknown extensions are ignored (graceful degradation).
The advertisement is meant for **trust-aware clients / gateways** that implement the
extension and apply an **accepted-anchor policy** (see `evaluateOidfTrust` in
`packages/fedmgr-mcp/src/oidf-trust-extension.ts`). So with Claude Code today you:

1. **exercise the trust logic through the tools** (works now — `validate_mcp_invocation`
   is the cryptographic verdict), and
2. **inspect the advertised extension** to see the in-band identity hand-off that a
   gateway would enforce.

You can see the raw advertisement yourself:

```bash
printf '%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 | node packages/fedmgr-mcp/dist/bin.js 2>/dev/null | head -1 | jq '.result.capabilities.extensions'
```

The roadmap (`docs/proposed-workplan.md`, Phase 6.4) puts enforcement in the
**gateway** (GitHub sign-in → only attested MCPs get a token) and in the **E9 walker**
that enrolls the MCPs you already run.

## References

- OpenID Federation 1.1 — https://openid.net/specs/openid-federation-1_1.html
- MCP extensions — https://modelcontextprotocol.io/extensions/overview
- Plan & status — [`docs/proposed-workplan.md`](../proposed-workplan.md)
