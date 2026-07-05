/**
 * waypoint OAuth discovery layer — the MCP client's path to "where do I log in?".
 * Serves Protected Resource Metadata (RFC 9728) and points the 401 at it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair } from "jose";
import { Waypoint } from "../dist/mux.js";
import { makeOAuthEdge } from "../dist/oauth-edge.js";
import { startHttpWaypoint } from "../dist/http-server.js";

const ISS = "https://idp.example", AUD = "https://waypoint.example", ANCHOR = "https://trust.letsfederate.org";
const RM_URL = `${AUD}/.well-known/oauth-protected-resource`;

async function setup() {
  const k = await generateKeyPair("ES256", { extractable: true });
  const wp = new Waypoint(
    { downstreams: [], policy: { acceptedAnchors: [ANCHOR] } },
    { async connect() { throw new Error("unused"); } },
  );
  await wp.start();
  const verifier = makeOAuthEdge({ issuer: ISS, audience: AUD, key: k.publicKey });
  const h = startHttpWaypoint({
    waypoint: wp,
    verifier,
    port: 0,
    host: "127.0.0.1",
    oauthMetadata: { resource: AUD, authorizationServers: [ISS], resourceMetadataUrl: RM_URL },
  });
  await new Promise((res) => (h.server.listening ? res() : h.server.once("listening", res)));
  return { h, base: `http://127.0.0.1:${h.server.address().port}` };
}

test("serves Protected Resource Metadata (open, RFC 9728)", async () => {
  const { h, base } = await setup();
  try {
    const r = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(r.status, 200);
    const prm = await r.json();
    assert.equal(prm.resource, AUD);
    assert.deepEqual(prm.authorization_servers, [ISS]);
  } finally { await h.close(); }
});

test("401 WWW-Authenticate points to the PRM via resource_metadata", async () => {
  const { h, base } = await setup();
  try {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 401);
    const wa = r.headers.get("www-authenticate") ?? "";
    assert.match(wa, /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource"/);
  } finally { await h.close(); }
});
