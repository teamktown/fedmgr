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
import type { WaypointConfig, DownstreamConfig } from "./types.js";
import type { Connector, DownstreamConnection } from "./connector.js";
import type { TrustValidator } from "./trust-validator.js";
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
  /** Cryptographic chain state when policy.requireValidChain was applied. */
  chainState?: string;
}

export interface WaypointOptions {
  /** Cryptographic chain validator (required when policy.requireValidChain). */
  trustValidator?: TrustValidator;
}

export class Waypoint {
  readonly #config: WaypointConfig;
  readonly #connector: Connector;
  readonly #trustValidator: TrustValidator | undefined;
  readonly #conns = new Map<string, DownstreamConnection>();
  readonly #tools = new Map<string, { downstream: string; tool: Tool }>();
  readonly #admissions: Admission[] = [];

  constructor(config: WaypointConfig, connector: Connector, opts: WaypointOptions = {}) {
    this.#config = config;
    this.#connector = connector;
    this.#trustValidator = opts.trustValidator;
  }

  /**
   * Cryptographic admission: require the downstream's chain to resolve VALID to
   * its anchor. Fail-closed — missing validator/url, WARN/INVALID, or a thrown
   * error all return a denial reason. Returns null when admitted.
   */
  async #chainDenial(d: DownstreamConfig): Promise<{ reason: string; state?: string } | null> {
    if (!this.#config.policy.requireValidChain) return null;
    if (!this.#trustValidator) {
      return { reason: "cryptographic admission required but no trust validator configured" };
    }
    if (!d.trustAnchorUrl) {
      return { reason: "requireValidChain set but downstream has no trustAnchorUrl" };
    }
    try {
      const v = await this.#trustValidator.validateChain(d.entityId, d.trustAnchorUrl);
      if (!v.valid) return { reason: `trust chain ${v.state}: ${v.message}`, state: v.state };
      return null;
    } catch (err) {
      return { reason: `trust chain validation error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async start(): Promise<void> {
    for (const d of this.#config.downstreams) {
      const decision = evaluateDownstream(d, this.#config.policy);
      if (!decision.admit) {
        // SECURITY: fail-closed — a downstream that fails the accepted-anchor
        // policy is never connected and its tools are never exposed.
        log.warn("downstream DENIED (policy)", { name: d.name, reasons: decision.reasons });
        this.#admissions.push({ name: d.name, admit: false, reasons: decision.reasons, toolCount: 0 });
        continue;
      }

      // SECURITY: cryptographic admission — the chain must resolve VALID.
      const chainDenial = await this.#chainDenial(d);
      if (chainDenial) {
        log.warn("downstream DENIED (chain)", { name: d.name, reason: chainDenial.reason });
        this.#admissions.push({
          name: d.name,
          admit: false,
          reasons: [chainDenial.reason],
          toolCount: 0,
          ...(chainDenial.state ? { chainState: chainDenial.state } : {}),
        });
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
      log.info("downstream ADMITTED", {
        name: d.name,
        anchor: d.trustAnchor,
        tools: tools.length,
        ...(this.#config.policy.requireValidChain ? { chain: "VALID" } : {}),
      });
      this.#admissions.push({
        name: d.name,
        admit: true,
        reasons: [],
        toolCount: tools.length,
        ...(this.#config.policy.requireValidChain ? { chainState: "VALID" } : {}),
      });
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
