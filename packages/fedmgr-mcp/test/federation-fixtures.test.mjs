/**
 * Phase 0 scaffolding tests — pin the ES256 trust-fabric fixture's invariants.
 *
 * WHY this exists: the shared fixture is the substrate for the Phase 1 verifier
 * tests (review Findings #1/#4/#5/#8). If the fixture ever drifts back to RS256
 * or leaks a private key, those downstream tests would pass for the wrong reason.
 * These tests fail loudly the moment that happens.
 *
 * AI-NOTE: keep `FIXTURE_ALG` === "ES256" here in lockstep with SoftKmsProvider
 *   (packages/kms/src/index.ts). This is intentionally redundant with the fixture
 *   so a careless edit to the fixture is still caught by an assertion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jwtVerify, importJWK } from "jose";
import {
  Es256MemoryProvider,
  makeEs256Provider,
  makeEs256ProviderFactory,
  protectedHeaderAlg,
  FIXTURE_ALG,
  FIXTURE_CRV,
} from "./fixtures/federation-fixtures.mjs";

test("fixture alg is ES256 (must match production SoftKmsProvider)", () => {
  // INVARIANT: the real TA/TMI sign ES256; the fixture must too.
  assert.equal(FIXTURE_ALG, "ES256");
  assert.equal(FIXTURE_CRV, "P-256");
});

test("jwks() publishes a single EC P-256 public key and never leaks the private 'd'", async () => {
  const p = makeEs256Provider({ issuer: "https://ta.local", keyName: "ta-key" });
  const { keys } = await p.jwks();
  assert.equal(keys.length, 1);
  const jwk = keys[0];
  assert.equal(jwk.kty, "EC");
  assert.equal(jwk.crv, FIXTURE_CRV);
  assert.equal(jwk.alg, FIXTURE_ALG);
  assert.equal(jwk.use, "sig");
  assert.equal(jwk.kid, "ta-key");
  // SECURITY: a JWKS endpoint must never expose private key material.
  assert.equal(jwk.d, undefined);
});

test("signJwt() stamps an ES256 protected header with the provider kid", async () => {
  const p = new Es256MemoryProvider({ keyName: "leaf-key" });
  const jws = await p.signJwt({ sub: "claude-code:test", scope: "mcp.invoke" });
  assert.equal(protectedHeaderAlg(jws), "ES256");
  // round-trip: a token signed by the provider verifies against its own JWKS,
  // proving the fixture is internally consistent (the basis for chain tests).
  const { keys } = await p.jwks();
  const key = await importJWK(keys[0], keys[0].alg);
  const { payload } = await jwtVerify(jws, key);
  assert.equal(payload.sub, "claude-code:test");
});

test("each provider has a distinct, stable kid and keypair", async () => {
  const a = makeEs256Provider({ keyName: "a" });
  const b = makeEs256Provider({ keyName: "b" });
  // stable across calls on the same instance
  assert.equal(await a.kid(), await a.kid());
  assert.notEqual(await a.kid(), await b.kid());
  const [ja, jb] = [(await a.jwks()).keys[0], (await b.jwks()).keys[0]];
  assert.notEqual(ja.x, jb.x); // independent key material
});

test("provider factory yields per-MCP providers wired for entityKmsFactory", async () => {
  const factory = makeEs256ProviderFactory("https://fedmgr.local/mcp");
  const mcp1 = factory("mcp-1");
  const mcp2 = factory("mcp-2");
  assert.equal(await mcp1.kid(), "mcp-1");
  assert.equal(await mcp2.kid(), "mcp-2");
  assert.equal(mcp1.issuer, "https://fedmgr.local/mcp/mcp-1");
});
