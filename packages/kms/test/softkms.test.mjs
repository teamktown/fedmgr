/**
 * Unit tests for SoftKmsProvider.
 *
 * Generates an ephemeral in-test EC P-256 JWK pair (never persisted to repo).
 * Verifies:
 *   1. kid() returns a stable identifier matching the public JWK.
 *   2. jwks() returns public-only JWK (no `d` field).
 *   3. signJwt() produces a valid 3-part JWS.
 *   4. The JWS header kid matches the JWKS kid (continuity).
 *   5. The signed JWT verifies against the public JWK from jwks().
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPair, exportJWK, importJWK, jwtVerify } from "jose";
import { SoftKmsProvider } from "../dist/index.js";

const TMP = new URL("./.tmp/", import.meta.url).pathname;
const PUB_PATH = `${TMP}tmi.pub.jwk`;
const PRIV_PATH = `${TMP}tmi.priv.jwk`;

// ---------------------------------------------------------------------------
// Setup: generate fresh EC P-256 keys for every test run.
// ---------------------------------------------------------------------------

await fs.mkdir(TMP, { recursive: true });

const { publicKey, privateKey } = await generateKeyPair("ES256");
const pubJwk = { ...(await exportJWK(publicKey)), kty: "EC", crv: "P-256", use: "sig", kid: "unit-test-kid" };
const privJwk = { ...(await exportJWK(privateKey)), kty: "EC", crv: "P-256", use: "sig", kid: "unit-test-kid" };

await fs.writeFile(PUB_PATH, JSON.stringify(pubJwk), "utf8");
await fs.writeFile(PRIV_PATH, JSON.stringify(privJwk), "utf8");

function makeProvider() {
  return new SoftKmsProvider({
    privateJwkPath: PRIV_PATH,
    publicJwkPath: PUB_PATH,
    issuer: "https://tmi.local",
    jwksUrl: "https://tmi.local/.well-known/jwks.json",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("kid() returns the kid from the public JWK", async () => {
  const kms = makeProvider();
  const kid = await kms.kid();
  assert.equal(kid, "unit-test-kid");
});

test("jwks() returns public-only JWK — no `d` field", async () => {
  const kms = makeProvider();
  const { keys } = await kms.jwks();
  assert.equal(keys.length, 1);
  assert.ok(!("d" in keys[0]), "JWKS must not contain private `d` field");
  assert.equal(keys[0].kty, "EC");
  assert.equal(keys[0].crv, "P-256");
});

test("jwks() kid matches kid()", async () => {
  const kms = makeProvider();
  const expectedKid = await kms.kid();
  const { keys } = await kms.jwks();
  assert.equal(keys[0].kid, expectedKid, "JWKS kid must match kid()");
});

test("signJwt() produces a valid 3-part JWS", async () => {
  const kms = makeProvider();
  const now = Math.floor(Date.now() / 1000);
  const jws = await kms.signJwt({
    iss: "https://tmi.local",
    sub: "https://entities.local/mcp/demo",
    id: "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1",
    iat: now,
    exp: now + 600,
  });
  const parts = jws.split(".");
  assert.equal(parts.length, 3, "JWS must be a 3-part compact serialization");
});

test("JWS header kid matches JWKS kid (continuity)", async () => {
  const kms = makeProvider();
  const jws = await kms.signJwt({ iss: "https://tmi.local", sub: "test", iat: 0, exp: 9999999999 });
  const headerJson = Buffer.from(jws.split(".")[0], "base64url").toString("utf8");
  const header = JSON.parse(headerJson);
  const { keys } = await kms.jwks();
  assert.equal(header.kid, keys[0].kid, "JWS header kid must match JWKS kid");
});

test("signJwt() produces a JWS that verifies against the JWKS public key", async () => {
  const kms = makeProvider();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://tmi.local",
    sub: "https://entities.local/mcp/demo",
    id: "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1",
    iat: now,
    exp: now + 600,
  };
  const jws = await kms.signJwt(payload);

  // Reconstruct CryptoKey from the JWKS to verify
  const { keys } = await kms.jwks();
  const verifyKey = await importJWK(keys[0], "ES256");
  const { payload: verified } = await jwtVerify(jws, verifyKey);
  assert.equal(verified.iss, "https://tmi.local");
  assert.equal(
    verified.id,
    "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1"
  );
});

test("SoftKmsProvider rejects non-EC keys", async () => {
  const wrongKey = { kty: "RSA", crv: undefined, n: "...", e: "AQAB" };
  await fs.writeFile(`${TMP}bad.pub.jwk`, JSON.stringify(wrongKey), "utf8");
  await fs.writeFile(`${TMP}bad.priv.jwk`, JSON.stringify({ ...wrongKey, d: "..." }), "utf8");
  const kms = new SoftKmsProvider({
    privateJwkPath: `${TMP}bad.priv.jwk`,
    publicJwkPath: `${TMP}bad.pub.jwk`,
    issuer: "https://tmi.local",
    jwksUrl: "https://tmi.local/.well-known/jwks.json",
  });
  await assert.rejects(() => kms.kid(), /expected EC P-256/);
});

// Cleanup
test.after(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});
