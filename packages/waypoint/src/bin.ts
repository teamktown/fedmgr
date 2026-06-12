#!/usr/bin/env node
/**
 * waypoint entrypoint — load config, admit downstreams, serve a single MCP server
 * to the client that re-exposes only trusted tools.
 *
 * Config: set WAYPOINT_CONFIG to a JSON file:
 *   {
 *     "downstreams": [
 *       { "name": "fedmgr", "command": "node", "args": ["/abs/packages/fedmgr-mcp/dist/bin.js"],
 *         "entityId": "https://trust.letsfederate.org/mcp/fedmgr-mcp",
 *         "trustAnchor": "https://trust.letsfederate.org" }
 *     ],
 *     "policy": { "acceptedAnchors": ["https://trust.letsfederate.org"] }
 *   }
 */
import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Waypoint } from "./mux.js";
import { sdkConnector } from "./connector.js";
import { log, initTelemetrySdk } from "./telemetry.js";
import type { WaypointConfig } from "./types.js";

async function loadConfig(): Promise<WaypointConfig> {
  const path = process.env["WAYPOINT_CONFIG"];
  if (!path) {
    throw new Error("[TRUST:FAIL] WAYPOINT_CONFIG must point to a waypoint config JSON file");
  }
  const cfg = JSON.parse(await readFile(path, "utf8")) as WaypointConfig;
  if (!Array.isArray(cfg.downstreams) || !cfg.policy || !Array.isArray(cfg.policy.acceptedAnchors)) {
    throw new Error("[TRUST:FAIL] invalid config: need { downstreams: [...], policy: { acceptedAnchors: [...] } }");
  }
  return cfg;
}

async function main(): Promise<void> {
  await initTelemetrySdk();
  const waypoint = new Waypoint(await loadConfig(), sdkConnector);
  await waypoint.start();

  const admitted = waypoint.admissions().filter((a) => a.admit).map((a) => a.name);
  const denied = waypoint.admissions().filter((a) => !a.admit).map((a) => a.name);
  log.info("waypoint ready", { admitted, denied, tools: waypoint.listTools().length });

  const server = new Server({ name: "waypoint", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: waypoint.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      return (await waypoint.callTool(name, args as Record<string, unknown>)) as {
        content: { type: "text"; text: string }[];
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `[waypoint] ready — ${waypoint.listTools().length} trusted tools from [${admitted.join(", ")}]` +
      (denied.length ? `; denied [${denied.join(", ")}]` : "") +
      "\n"
  );
}

main().catch((err) => {
  process.stderr.write(`[waypoint] fatal: ${String(err)}\n`);
  process.exit(1);
});
