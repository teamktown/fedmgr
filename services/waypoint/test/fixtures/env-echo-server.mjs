// Minimal MCP server fixture: one tool, `echo_env`, which returns the value of
// the env var named by {key}. Used to prove DownstreamConfig.env reaches the
// spawned downstream (the SDK strips parent env by default).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "env-echo", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo_env",
      description: "Return the value of the named environment variable",
      inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: String(process.env[req.params.arguments?.key] ?? "<unset>") }],
}));
await server.connect(new StdioServerTransport());
