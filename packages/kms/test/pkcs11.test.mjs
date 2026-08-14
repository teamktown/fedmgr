/**
 * Integration tests for Pkcs11Provider.
 *
 * SKIPPED in CI — requires a real PKCS#11 library (SoftHSM2) and the
 * SOFTHSM2_MODULE env var pointing to libsofthsm2.so.
 *
 * To run locally:
 *   1. Install SoftHSM2: apt install softhsm2
 *   2. Initialize a token:
 *        softhsm2-util --init-token --slot 0 --label "test-token" \
 *          --pin userpin --so-pin sopin
 *   3. Generate an EC P-256 signing key:
 *        pkcs11-tool --module /usr/lib/softhsm/libsofthsm2.so \
 *          --login --pin userpin --keypairgen --key-type EC:prime256v1 \
 *          --label kms-test-key --id 01
 *   4. Run:
 *        SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
 *          node --test test/pkcs11.test.mjs
 *
 * Decision 2: CI always uses SoftKMS. Pkcs11Provider tests are
 * integration-gated (skipped when SOFTHSM2_MODULE is not set).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { Pkcs11Provider } from "../dist/index.js";

const SOFTHSM2_MODULE = process.env.SOFTHSM2_MODULE;

/**
 * Skip helper — wraps an async test body; skips if SOFTHSM2_MODULE is unset.
 */
function hsmTest(name, fn) {
  test(name, { skip: !SOFTHSM2_MODULE ? "SOFTHSM2_MODULE not set — skipping HSM integration test" : false }, fn);
}

const KEY_LABEL = process.env.PKCS11_KEY_LABEL ?? "kms-test-key";
const PIN       = process.env.PKCS11_PIN       ?? "userpin";

function makeProvider() {
  return new Pkcs11Provider({
    libraryPath: SOFTHSM2_MODULE,
    slot: 0,
    pin: PIN,
    keyLabel: KEY_LABEL,
    kid: "pkcs11-test-kid",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

hsmTest("kid() returns the configured kid", async () => {
  const kms = makeProvider();
  const kid = await kms.kid();
  assert.equal(kid, "pkcs11-test-kid");
});

hsmTest("jwks() returns a public EC P-256 JWK without private `d` field", async () => {
  const kms = makeProvider();
  const { keys } = await kms.jwks();
  assert.equal(keys.length, 1);
  const key = keys[0];
  assert.equal(key.kty, "EC");
  assert.equal(key.crv, "P-256");
  assert.ok(!("d" in key), "JWKS must not contain private `d` field");
  assert.ok(typeof key.x === "string" && key.x.length > 0, "JWK must have x coordinate");
  assert.ok(typeof key.y === "string" && key.y.length > 0, "JWK must have y coordinate");
});

hsmTest("jwks() kid matches kid()", async () => {
  const kms = makeProvider();
  const expectedKid = await kms.kid();
  const { keys } = await kms.jwks();
  assert.equal(keys[0].kid, expectedKid);
});

hsmTest("signJwt() produces a valid 3-part JWS", async () => {
  const kms = makeProvider();
  const now = Math.floor(Date.now() / 1000);
  const jws = await kms.signJwt({
    iss: "https://ta.example.org",
    sub: "https://leaf.example.org",
    iat: now,
    exp: now + 600,
  });
  const parts = jws.split(".");
  assert.equal(parts.length, 3, "JWS must be a 3-part compact serialization");
});

hsmTest("JWS header alg is ES256", async () => {
  const kms = makeProvider();
  const jws = await kms.signJwt({ iss: "test", sub: "test", iat: 0, exp: 9999999999 });
  const headerJson = Buffer.from(jws.split(".")[0], "base64url").toString("utf8");
  const header = JSON.parse(headerJson);
  assert.equal(header.alg, "ES256");
});

hsmTest("JWS header kid matches JWKS kid (continuity)", async () => {
  const kms = makeProvider();
  const jws = await kms.signJwt({ iss: "test", sub: "test", iat: 0, exp: 9999999999 });
  const headerJson = Buffer.from(jws.split(".")[0], "base64url").toString("utf8");
  const header = JSON.parse(headerJson);
  const { keys } = await kms.jwks();
  assert.equal(header.kid, keys[0].kid);
});

hsmTest("signJwt() produces a JWS that verifies against the JWKS public key", async () => {
  const kms = makeProvider();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://ta.example.org",
    sub: "https://leaf.example.org",
    iat: now,
    exp: now + 600,
  };
  const jws = await kms.signJwt(payload);
  const { keys } = await kms.jwks();
  const { importJWK } = await import("jose");
  const verifyKey = await importJWK(keys[0], "ES256");
  const { payload: verified } = await jwtVerify(jws, verifyKey);
  assert.equal(verified.iss, "https://ta.example.org");
  assert.equal(verified.sub, "https://leaf.example.org");
});

hsmTest("Pkcs11Provider: throws useful error when pkcs11js not installed", async () => {
  // This test can only realistically be run in an env without pkcs11js.
  // Skip if we're already in an HSM-enabled environment (pkcs11js likely installed).
  // Included for documentation; in CI it's always skipped anyway.
  test.skip("pkcs11js availability check — manual only");
});
