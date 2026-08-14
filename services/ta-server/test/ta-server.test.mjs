/**
 * Unit + integration tests for the Trust Anchor server.
 *
 * Verifies:
 *   SubordinateRegistry:
 *     1. register() and listEntityIds()
 *     2. get() returns registered entry
 *     3. has() returns true/false correctly
 *     4. listEntityIds() empty when no entries
 *
 *   signSubordinateStatement():
 *     5. Returns valid 3-part JWS
 *     6. Header typ is entity-statement+jwt
 *     7. iss = TA entity ID, sub = subordinate entity ID
 *     8. exp > iat
 *     9. jwks present in payload (public only — no `d`)
 *    10. Verifies against TA's public key (signature check)
 *    11. metadata included when provided
 *    12. metadata absent when not provided
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPair, exportJWK, importJWK, jwtVerify, decodeProtectedHeader } from "jose";
import { SoftKmsProvider } from "@letsfederate/kms";
import {
  signSubordinateStatement,
  SubordinateRegistry,
} from "../dist/federation/subordinate-statements.js";

// ---------------------------------------------------------------------------
// Setup: ephemeral TA keys
// ---------------------------------------------------------------------------

const TMP = new URL("./.tmp/", import.meta.url).pathname;
const PUB_PATH = `${TMP}ta.pub.jwk`;
const PRIV_PATH = `${TMP}ta.priv.jwk`;

await fs.mkdir(TMP, { recursive: true });

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const pubJwk = {
  ...(await exportJWK(publicKey)),
  kty: "EC", crv: "P-256", use: "sig", kid: "ta-test-kid",
};
const privJwk = {
  ...(await exportJWK(privateKey)),
  kty: "EC", crv: "P-256", use: "sig", kid: "ta-test-kid",
};

await fs.writeFile(PUB_PATH, JSON.stringify(pubJwk), "utf8");
await fs.writeFile(PRIV_PATH, JSON.stringify(privJwk), "utf8");

const TA_KMS = new SoftKmsProvider({
  privateJwkPath: PRIV_PATH,
  publicJwkPath: PUB_PATH,
  issuer: "https://ta.letsfederate.org",
  jwksUrl: "https://ta.letsfederate.org/.well-known/jwks.json",
});

// Ephemeral subordinate (TMI) keys for building a mock JWKS
const { publicKey: subPub } = await generateKeyPair("ES256", { extractable: true });
const subPubJwk = {
  ...(await exportJWK(subPub)),
  kty: "EC", crv: "P-256", use: "sig", kid: "tmi-test-kid",
};
const SUB_JWKS = { keys: [subPubJwk] };

const TA_ID = "https://ta.letsfederate.org";
const TMI_ID = "https://tmi.letsfederate.org";

// ---------------------------------------------------------------------------
// SubordinateRegistry tests
// ---------------------------------------------------------------------------

test("registry: empty list when no entries", () => {
  const reg = new SubordinateRegistry();
  assert.deepEqual(reg.listEntityIds(), []);
});

test("registry: register() and listEntityIds()", () => {
  const reg = new SubordinateRegistry();
  reg.register({ entityId: TMI_ID, jwks: SUB_JWKS });
  assert.deepEqual(reg.listEntityIds(), [TMI_ID]);
});

test("registry: get() returns registered entry", () => {
  const reg = new SubordinateRegistry();
  reg.register({ entityId: TMI_ID, jwks: SUB_JWKS });
  const entry = reg.get(TMI_ID);
  assert.equal(entry?.entityId, TMI_ID);
  assert.equal(entry?.jwks.keys.length, 1);
});

test("registry: has() returns true for registered, false for unknown", () => {
  const reg = new SubordinateRegistry();
  reg.register({ entityId: TMI_ID, jwks: SUB_JWKS });
  assert.equal(reg.has(TMI_ID), true);
  assert.equal(reg.has("https://unknown.example"), false);
});

// ---------------------------------------------------------------------------
// signSubordinateStatement() tests
// ---------------------------------------------------------------------------

async function makeStatement(overrides = {}) {
  return signSubordinateStatement(
    {
      issuerEntityId: TA_ID,
      subjectEntityId: TMI_ID,
      subjectJwks: SUB_JWKS,
      ttlSeconds: 3600,
      ...overrides,
    },
    TA_KMS
  );
}

test("subordinate statement is a valid 3-part JWS", async () => {
  const jws = await makeStatement();
  assert.equal(jws.split(".").length, 3);
});

test("header typ is entity-statement+jwt", async () => {
  const jws = await makeStatement();
  const header = decodeProtectedHeader(jws);
  assert.equal(header.typ, "entity-statement+jwt");
});

test("iss = TA entity ID, sub = subordinate entity ID", async () => {
  const jws = await makeStatement();
  const taPublicKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, taPublicKey, { clockTolerance: 60 });
  assert.equal(payload.iss, TA_ID);
  assert.equal(payload.sub, TMI_ID);
});

test("exp > iat", async () => {
  const jws = await makeStatement();
  const taPublicKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, taPublicKey, { clockTolerance: 60 });
  assert.ok(Number(payload.exp) > Number(payload.iat));
});

test("jwks present in payload, no private `d` field", async () => {
  const jws = await makeStatement();
  const taPublicKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, taPublicKey, { clockTolerance: 60 });
  const jwks = payload["jwks"];
  assert.ok(jwks && Array.isArray(jwks.keys), "jwks.keys must be present");
  assert.ok(!("d" in jwks.keys[0]), "subordinate JWKS must not expose `d`");
});

test("verifies against TA public key (end-to-end signature check)", async () => {
  const jws = await makeStatement();
  const taPublicKey = await importJWK(pubJwk, "ES256");
  // This throws if signature is invalid
  await assert.doesNotReject(() =>
    jwtVerify(jws, taPublicKey, { clockTolerance: 60 })
  );
});

test("metadata included in payload when provided", async () => {
  const jws = await makeStatement({
    subjectMetadata: { federation_entity: { organization_name: "TMI Test" } },
  });
  const taPublicKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, taPublicKey, { clockTolerance: 60 });
  const meta = payload["metadata"];
  assert.ok(meta?.["federation_entity"], "metadata.federation_entity must be present");
});

test("metadata absent when not provided", async () => {
  const jws = await makeStatement(); // no subjectMetadata
  const taPublicKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, taPublicKey, { clockTolerance: 60 });
  assert.ok(!("metadata" in payload), "metadata must be absent when not provided");
});

// Cleanup
test.after(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});
