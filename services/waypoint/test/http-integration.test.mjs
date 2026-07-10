/**
 * waypoint HTTP/SSE + OAuth edge — REAL end-to-end over the network loopback.
 *
 * Starts the HTTP server (ephemeral port), then: /health is open; /mcp without a
 * bearer token is 401; a real MCP client over Streamable HTTP with a valid bearer
 * completes initialize + tools/list and sees the (namespaced) trusted tools.
 * Uses a fake downstream connector so the test is hermetic (no spawned processes).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Waypoint } from "../dist/mux.js";
import { makeOAuthEdge } from "../dist/oauth-edge.js";
import { startHttpWaypoint } from "../dist/http-server.js";

const ISS = "https://idp.example", AUD = "https://waypoint.example", ANCHOR = "https://trust.letsfederate.org";

function fakeConnector(toolsByName) {
  return {
    async connect(d) {
      return {
        name: d.name,
        async listTools() {
          return (toolsByName[d.name] ?? []).map((n) => ({ name: n, description: n, inputSchema: { type: "object" } }));
        },
        async callTool(name) { return { content: [{ type: "text", text: `${d.name}:${name}` }] }; },
        async close() {},
      };
    },
  };
}

let priv, pub;
async function setup() {
  const k = await generateKeyPair("ES256", { extractable: true });
  priv = k.privateKey; pub = k.publicKey;
  const wp = new Waypoint(
    { downstreams: [{ name: "fedmgr", command: "node", entityId: ANCHOR + "/mcp/x", trustAnchor: ANCHOR }],
      policy: { acceptedAnchors: [ANCHOR] } },
    fakeConnector({ fedmgr: ["a", "b"] })
  );
  await wp.start();
  const verifier = makeOAuthEdge({ issuer: ISS, audience: AUD, key: pub });
  const h = startHttpWaypoint({ waypoint: wp, verifier, port: 0, host: "127.0.0.1" });
  await new Promise((res) => (h.server.listening ? res() : h.server.once("listening", res)));
  const port = h.server.address().port;
  return { h, base: `http://127.0.0.1:${port}` };
}
async function bearer() {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: "mcp.invoke", azp: "test-client" })
    .setProtectedHeader({ alg: "ES256" }).setIssuer(ISS).setAudience(AUD).setSubject("u1")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(priv);
}

test("GET /health is open and reports tool count", async () => {
  const { h, base } = await setup();
  try {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, "ok");
    assert.equal(j.tools, 2);
  } finally { await h.close(); }
});

test("POST /mcp without a bearer token → 401 (OAuth edge, fail-closed)", async () => {
  const { h, base } = await setup();
  try {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
    });
    assert.equal(r.status, 401);
  } finally { await h.close(); }
});

test("MCP client over Streamable HTTP with a valid bearer → initialize + namespaced tools", async () => {
  const { h, base } = await setup();
  try {
    const tok = await bearer();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tok}` } },
    });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["fedmgr__a", "fedmgr__b"]);
    await client.close();
  } finally { await h.close(); }
});
