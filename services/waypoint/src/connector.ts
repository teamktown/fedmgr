/**
 * Downstream connector — the thin MCP-client adapter waypoint uses to reach a
 * downstream server. Abstracted behind an interface so the multiplexer can be
 * unit-tested with a fake connector (no real processes) and integration-tested
 * with the real SDK connector against an actual MCP server.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamConfig } from "./types.js";

export interface DownstreamConnection {
  readonly name: string;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface Connector {
  connect(d: DownstreamConfig): Promise<DownstreamConnection>;
}

/** Real connector: spawns the downstream over stdio and speaks MCP to it. */
export const sdkConnector: Connector = {
  async connect(d: DownstreamConfig): Promise<DownstreamConnection> {
    const client = new Client({ name: "waypoint", version: "0.0.1" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: d.command,
      args: d.args ?? [],
      ...(d.env ? { env: { ...getDefaultEnvironment(), ...d.env } } : {}),
    });
    await client.connect(transport);
    return {
      name: d.name,
      async listTools(): Promise<Tool[]> {
        return (await client.listTools()).tools as Tool[];
      },
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return client.callTool({ name, arguments: args });
      },
      async close(): Promise<void> {
        await client.close();
      },
    };
  },
};
