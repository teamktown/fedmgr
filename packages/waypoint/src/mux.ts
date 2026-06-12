/**
 * Waypoint — the trust-enforcing MCP multiplexer.
 *
 * One MCP server faces the client; behind it, N downstream MCP servers. At
 * start(), each downstream is run through the accepted-anchor policy; only
 * ADMITTED downstreams are connected and their tools re-exposed (namespaced as
 * `<name>__<tool>`). Every tool call is routed only if it maps to an admitted
 * downstream — fail-closed. This makes "trusted connection" the default: the
 * client never gets a path to an untrusted MCP.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { WaypointConfig } from "./types.js";
import type { Connector, DownstreamConnection } from "./connector.js";
import { evaluateDownstream } from "./policy.js";
import { log, withSpan } from "./telemetry.js";

/** Separator between a downstream name and its tool name in the exposed namespace. */
export const QUALIFIER = "__";
export function qualify(downstream: string, tool: string): string {
  return `${downstream}${QUALIFIER}${tool}`;
}

export interface Admission {
  name: string;
  admit: boolean;
  reasons: string[];
  toolCount: number;
}

export class Waypoint {
  readonly #config: WaypointConfig;
  readonly #connector: Connector;
  readonly #conns = new Map<string, DownstreamConnection>();
  readonly #tools = new Map<string, { downstream: string; tool: Tool }>();
  readonly #admissions: Admission[] = [];

  constructor(config: WaypointConfig, connector: Connector) {
    this.#config = config;
    this.#connector = connector;
  }

  async start(): Promise<void> {
    for (const d of this.#config.downstreams) {
      const decision = evaluateDownstream(d, this.#config.policy);
      if (!decision.admit) {
        // SECURITY: fail-closed — a downstream that fails the accepted-anchor
        // policy is never connected and its tools are never exposed.
        log.warn("downstream DENIED", { name: d.name, reasons: decision.reasons });
        this.#admissions.push({ name: d.name, admit: false, reasons: decision.reasons, toolCount: 0 });
        continue;
      }

      let conn: DownstreamConnection;
      try {
        conn = await this.#connector.connect(d);
      } catch (err) {
        // A downstream that can't be reached is excluded; it must not take the
        // whole waypoint down or be silently treated as trusted.
        const msg = err instanceof Error ? err.message : String(err);
        log.error("downstream connect failed; skipping", { name: d.name, error: msg });
        this.#admissions.push({ name: d.name, admit: false, reasons: [`connect failed: ${msg}`], toolCount: 0 });
        continue;
      }

      this.#conns.set(d.name, conn);
      const tools = await conn.listTools();
      for (const t of tools) {
        this.#tools.set(qualify(d.name, t.name), { downstream: d.name, tool: t });
      }
      log.info("downstream ADMITTED", { name: d.name, anchor: d.trustAnchor, tools: tools.length });
      this.#admissions.push({ name: d.name, admit: true, reasons: [], toolCount: tools.length });
    }
  }

  /** Admission outcome per configured downstream (for diagnostics / the dashboard). */
  admissions(): Admission[] {
    return [...this.#admissions];
  }

  /** The namespaced tools exposed to the client (admitted downstreams only). */
  listTools(): Tool[] {
    return [...this.#tools.entries()].map(([qualified, { tool }]) => ({ ...tool, name: qualified }));
  }

  /** Route a (namespaced) tool call to its downstream. Fail-closed. */
  async callTool(qualified: string, args: Record<string, unknown>): Promise<unknown> {
    return withSpan(
      "waypoint.callTool",
      async (span) => {
        const entry = this.#tools.get(qualified);
        // INVARIANT: only tools from admitted, connected downstreams are routable.
        if (!entry) throw new Error(`[TRUST:FAIL] unknown or untrusted tool: ${qualified}`);
        const conn = this.#conns.get(entry.downstream);
        if (!conn) throw new Error(`[TRUST:FAIL] downstream not connected: ${entry.downstream}`);
        span.setAttribute("waypoint.downstream", entry.downstream);
        log.debug("routing tool call", { tool: qualified, downstream: entry.downstream });
        return conn.callTool(entry.tool.name, args);
      },
      { "waypoint.tool": qualified }
    );
  }

  async close(): Promise<void> {
    for (const c of this.#conns.values()) {
      try {
        await c.close();
      } catch {
        /* best-effort shutdown */
      }
    }
  }
}
