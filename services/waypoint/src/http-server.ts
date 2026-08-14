/**
 * waypoint HTTP/SSE transport + OAuth edge.
 *
 * Serves the waypoint MCP over **Streamable HTTP** (the modern remote transport)
 * so cloud/web assistants (Claude.ai, OpenAI) can connect as a remote MCP — and
 * gates every request behind the **OAuth edge** (identity plane): a valid bearer
 * token is required to reach waypoint. Inbound = OAuth/OIDC; downstream = OIDF.
 *
 * Each MCP session gets its own transport + Server, all sharing the single
 * Waypoint instance (which holds the downstream connections). Health is open;
 * everything under /mcp is authenticated.
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { Waypoint } from "./mux.js";
import { log } from "./telemetry.js";
import {
  buildProtectedResourceMetadata,
  type ProtectedResourceMetadataConfig,
} from "./oauth-metadata.js";

export interface HttpWaypointOptions {
  waypoint: Waypoint;
  /** The OAuth edge verifier (identity plane). */
  verifier: OAuthTokenVerifier;
  /**
   * OAuth discovery (RFC 9728). When present, waypoint serves Protected Resource
   * Metadata at /.well-known/oauth-protected-resource and points the 401 there,
   * so a remote MCP client (claude.ai) can discover the authorization server.
   * `resourceMetadataUrl` is the PUBLIC URL of that document (differs from the
   * bind address behind a tunnel).
   */
  oauthMetadata?: ProtectedResourceMetadataConfig & { resourceMetadataUrl?: string };
}

/** A per-session MCP Server that delegates to the shared Waypoint. */
function makeSessionServer(waypoint: Waypoint): Server {
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
  return server;
}

export function createHttpApp(opts: HttpWaypointOptions) {
  const app = express();
  app.use(express.json());
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const rmUrl = opts.oauthMetadata?.resourceMetadataUrl;
  const auth = requireBearerAuth({
    verifier: opts.verifier,
    ...(rmUrl ? { resourceMetadataUrl: rmUrl } : {}),
  });

  // Open health endpoint (no auth) for probes/load balancers.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", tools: opts.waypoint.listTools().length });
  });

  // OAuth discovery (RFC 9728) — open. Lets a remote MCP client find the
  // authorization server. The 401 above carries resource_metadata pointing here.
  if (opts.oauthMetadata) {
    const prm = buildProtectedResourceMetadata(opts.oauthMetadata);
    app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
      res.json(prm);
    });
  }

  // All MCP traffic is authenticated by the OAuth edge.
  app.post("/mcp", auth, async (req: Request, res: Response) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    let transport = sid ? transports.get(sid) : undefined;

    if (!transport) {
      // A new session may only be created by an initialize request.
      if (sid || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session — send an initialize request first" },
          id: null,
        });
        return;
      }
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, t);
          const clientId = (req as Request & { auth?: { clientId?: string } }).auth?.clientId;
          log.info("mcp session opened", { sid: id, client: clientId });
        },
      });
      t.onclose = () => {
        if (t.sessionId) transports.delete(t.sessionId);
      };
      await makeSessionServer(opts.waypoint).connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, req.body);
  });

  // SSE stream (GET) + session teardown (DELETE) for an existing session.
  const handleSession = async (req: Request, res: Response) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
      res.status(400).send("Unknown or missing mcp-session-id");
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", auth, handleSession);
  app.delete("/mcp", auth, handleSession);

  return app;
}

export function startHttpWaypoint(
  opts: HttpWaypointOptions & { port?: number; host?: string }
): { server: HttpServer; close: () => Promise<void> } {
  const app = createHttpApp(opts);
  const port = opts.port ?? Number(process.env["WAYPOINT_HTTP_PORT"] ?? 8077);
  const host = opts.host ?? "0.0.0.0";
  const server = app.listen(port, host, () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    log.info("waypoint HTTP/SSE listening", { host, port: p });
  });
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        // Force-drop lingering keep-alive/SSE sockets so the process can exit.
        (server as HttpServer & { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
