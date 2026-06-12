# @letsfederate/fedmgr-mcp

An MCP (Model Context Protocol) server that exposes fedmgr trust infrastructure operations to AI assistants such as **Claude Code** and Claude Desktop. Connect it once and let your AI assistant manage federation enrollment, trustmark lifecycle, and chain validation without leaving the conversation.

> New here? The fastest path is [docs/walkthroughs/trust-lab-quickstart.md](../../docs/walkthroughs/trust-lab-quickstart.md): one command to start a local TA/TMI lab, then drive it from Claude Code.

## Add to Claude Code

```bash
npm run build -w @letsfederate/fedmgr-mcp     # produces dist/bin.js
claude mcp add fedmgr -- node "$(pwd)/packages/fedmgr-mcp/dist/bin.js"
# once published:  claude mcp add fedmgr -- npx -y @letsfederate/fedmgr-mcp
```

Or commit a project `.mcp.json`:

```json
{ "mcpServers": { "fedmgr": { "command": "node", "args": ["packages/fedmgr-mcp/dist/bin.js"] } } }
```

Run `/mcp` in Claude Code to confirm **fedmgr** appears with its tools. The tools
default to the lab URLs (`ta_url=http://localhost:8090`, `tmi_url=http://localhost:8080`).

## Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent path on your platform:

```json
{
  "mcpServers": {
    "fedmgr": {
      "command": "npx",
      "args": ["-y", "@letsfederate/fedmgr-mcp"]
    }
  }
}
```

If you are running a local build:

```json
{
  "mcpServers": {
    "fedmgr": {
      "command": "node",
      "args": ["/path/to/fedmgr/packages/fedmgr-mcp/dist/bin.js"]
    }
  }
}
```

Restart Claude Desktop after editing the config. You should see "fedmgr" appear in the tools list.

## Tools

| Tool | Description |
|------|-------------|
| `federation_status` | Check health of the Trust Anchor (TA) and Trust Mark Issuer (TMI) servers |
| `list_subordinates` | List all registered entities in the federation, optionally filtered by type |
| `enroll_server` | Begin enrollment of a new MCP server or entity into the federation |
| `complete_enrollment` | Finish an enrollment challenge by submitting the signed proof JWS |
| `issue_trustmark` | Issue a signed trustmark for a subject entity via the TMI |
| `verify_trustmark` | Verify a trustmark JWS — checks signature, expiry, and chain-of-trust |
| `check_trust_chain` | Walk and validate the full OIDF trust chain from a subject to the trust anchor |
| `validate_mcp_invocation` | The fail-closed admission **verdict**: verifies the subordinate + entity statements and the invocation token (signature, audience, required trust mark *in the JWT*) → ALLOWED/DENIED |
| `provision_mcp_trust_circle` | Provision an MCP trust circle (entity/subordinate statements + endpoint-scoped invocation token) for demos/tests |
| `revoke_subordinate` | Revoke and decommission a subordinate entity from the federation |
| `get_signed_config` | Fetch and decode the signed entity configuration for any OIDF entity |
| `initialize_local_ca` | Get setup instructions and key file status for a local CA lab environment |

## OIDF trust extension

At the `initialize` handshake this server advertises the `org.letsfederate/oidf-trust`
MCP extension — its OIDF entity id, trust anchor, and trust marks (see
`src/oidf-trust-extension.ts`). Trust-aware clients/gateways apply an **accepted-anchor
policy** (`evaluateOidfTrust`) to admit/deny it *before* use; generic clients ignore the
extension (graceful degradation) and instead drive trust via the tools above. Details:
[trust-lab-quickstart.md §4](../../docs/walkthroughs/trust-lab-quickstart.md).

## Resources

| Resource URI | Description |
|---|---|
| `federation://status` | Live JSON snapshot of TA and TMI health state |

## Example prompts

Once connected, you can ask Claude things like:

- "Is the federation healthy? Check both TA and TMI."
- "List all leaf entities registered in the federation at http://ta.example.com."
- "Enroll https://my-mcp-server.example.com into the federation. Its JWKS is at https://my-mcp-server.example.com/.well-known/jwks.json."
- "Verify this trustmark token: eyJ..."
- "Check the full trust chain for https://tmi.example.com back to the trust anchor at https://ta.example.com."
- "Revoke https://old-server.example.com from the federation. Reason: decommissioned."
- "Show me the signed entity configuration for https://tmi.example.com."
- "I haven't set up my local CA yet — walk me through it."

## Development

```bash
# From the repo root
npm install
npm run build -w @letsfederate/fedmgr-mcp

# Run directly (requires local TA/TMI running)
npm run dev -w @letsfederate/fedmgr-mcp
```

## License

MIT
