/**
 * OpenBao Transit provider tests.
 *
 * These tests use MemoryOpenBaoTransitClient so CI does not need a live
 * OpenBao container. The client emulates the Transit ontology: keys are
 * created in the provider, callers receive JWKS, and private key material is
 * never returned to entity-statement callers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { importJWK, jwtVerify } from "jose";
import {
  OpenBaoTransitProvider,
  MemoryOpenBaoTransitClient,
  createProvider,
} from "../dist/index.js";

function makeProvider() {
  return new OpenBaoTransitProvider({
    issuer: "https://ta.local",
    keyName: "fedmgr-test-ta",
    client: new MemoryOpenBaoTransitClient(),
  });
}

test("OpenBaoTransitProvider exposes public JWKS without private key fields", async () => {
  const provider = makeProvider();
  const jwks = await provider.jwks();
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, "fedmgr-test-ta");
  assert.equal(jwks.keys[0].alg, "RS256");
  assert.equal(jwks.keys[0].use, "sig");
  assert.ok(!("d" in jwks.keys[0]), "JWKS must not expose private material");
});

test("OpenBaoTransitProvider signs OIDF JWTs verifiable by its JWKS", async () => {
  const provider = makeProvider();
  const now = Math.floor(Date.now() / 1000);
  const jws = await provider.signJwt(
    {
      sub: "https://mcp.local/server-1",
      iat: now,
      exp: now + 600,
      metadata: { mcp_server: { endpoint: "https://mcp.local/server-1" } },
    },
    { typ: "entity-statement+jwt" }
  );
  const header = JSON.parse(Buffer.from(jws.split(".")[0], "base64url").toString("utf8"));
  assert.equal(header.alg, "RS256");
  assert.equal(header.kid, "fedmgr-test-ta");
  assert.equal(header.typ, "entity-statement+jwt");

  const { keys } = await provider.jwks();
  const verifyKey = await importJWK(keys[0], "RS256");
  const { payload } = await jwtVerify(jws, verifyKey, { issuer: "https://ta.local" });
  assert.equal(payload.iss, "https://ta.local");
  assert.equal(payload.sub, "https://mcp.local/server-1");
});

test("createProvider resolves OpenBao/Vault transit aliases", async () => {
  const provider = createProvider("vault-transit", {
    issuer: "https://ta.local",
    keyName: "fedmgr-test-alias",
    client: new MemoryOpenBaoTransitClient(),
  });
  assert.equal(await provider.kid(), "fedmgr-test-alias");
});
