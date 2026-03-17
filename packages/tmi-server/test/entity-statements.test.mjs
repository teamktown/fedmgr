/**
 * Unit tests for OIDF entity statement generation.
 *
 * Verifies:
 *   1. Signed entity statement is a valid 3-part JWS
 *   2. Content-Type typ header is "entity-statement+jwt"
 *   3. Payload contains required OIDF claims (iss, sub, iat, exp, jwks)
 *   4. iss === sub === entityId (self-signed)
 *   5. exp > iat
 *   6. jwks contains the correct public key (no private d field)
 *   7. metadata block is present and well-formed
 *   8. authority_hints absent when empty array passed
 *   9. authority_hints present when non-empty
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPair, exportJWK, importJWK, jwtVerify, decodeProtectedHeader } from "jose";
import { SoftKmsProvider } from "@letsfederate/kms";
import {
  signEntityStatement,
  tmiMetadata,
  trustAnchorMetadata,
} from "../dist/federation/entity-statements.js";

// ---------------------------------------------------------------------------
// Setup: ephemeral keys for the test run
// ---------------------------------------------------------------------------

const TMP = new URL("./.tmp/", import.meta.url).pathname;
const PUB_PATH = `${TMP}es.pub.jwk`;
const PRIV_PATH = `${TMP}es.priv.jwk`;

await fs.mkdir(TMP, { recursive: true });

const { publicKey, privateKey } = await generateKeyPair("ES256");
const pubJwk = { ...(await exportJWK(publicKey)), kty: "EC", crv: "P-256", use: "sig", kid: "es-test-kid" };
const privJwk = { ...(await exportJWK(privateKey)), kty: "EC", crv: "P-256", use: "sig", kid: "es-test-kid" };
await fs.writeFile(PUB_PATH, JSON.stringify(pubJwk), "utf8");
await fs.writeFile(PRIV_PATH, JSON.stringify(privJwk), "utf8");

const KMS = new SoftKmsProvider({
  privateJwkPath: PRIV_PATH,
  publicJwkPath: PUB_PATH,
  issuer: "https://tmi.local",
  jwksUrl: "https://tmi.local/.well-known/jwks.json",
});

const ENTITY_ID = "https://tmi.local";

async function makeStatement(overrides = {}) {
  return signEntityStatement(
    {
      entityId: ENTITY_ID,
      authorityHints: [],
      ttlSeconds: 3600,
      metadata: tmiMetadata("https://tmi.local/.well-known/jwks.json"),
      ...overrides,
    },
    KMS
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("entity statement is a valid 3-part JWS", async () => {
  const jws = await makeStatement();
  assert.equal(jws.split(".").length, 3);
});

test("header typ is entity-statement+jwt", async () => {
  const jws = await makeStatement();
  const header = decodeProtectedHeader(jws);
  assert.equal(header.typ, "entity-statement+jwt");
});

test("header alg is ES256", async () => {
  const jws = await makeStatement();
  const header = decodeProtectedHeader(jws);
  assert.equal(header.alg, "ES256");
});

test("payload iss and sub equal entityId", async () => {
  const jws = await makeStatement();
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  assert.equal(payload.iss, ENTITY_ID);
  assert.equal(payload.sub, ENTITY_ID);
});

test("payload exp > iat", async () => {
  const jws = await makeStatement();
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  assert.ok(
    Number(payload.exp) > Number(payload.iat),
    `exp(${payload.exp}) must be > iat(${payload.iat})`
  );
});

test("payload jwks present and has public key without d", async () => {
  const jws = await makeStatement();
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  const jwks = payload["jwks"];
  assert.ok(jwks && Array.isArray(jwks.keys), "jwks.keys must be an array");
  assert.equal(jwks.keys.length, 1);
  assert.ok(!("d" in jwks.keys[0]), "jwks must not contain private d field");
});

test("payload metadata block present for TMI", async () => {
  const jws = await makeStatement();
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  const meta = payload["metadata"];
  assert.ok(meta && meta["federation_entity"], "metadata.federation_entity must be present");
});

test("authority_hints absent when empty array", async () => {
  const jws = await makeStatement({ authorityHints: [] });
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  assert.ok(
    !("authority_hints" in payload),
    "authority_hints must be absent when empty"
  );
});

test("authority_hints present when non-empty", async () => {
  const jws = await makeStatement({
    authorityHints: ["https://ta.letsfederate.org"],
  });
  const pubKey = await importJWK(pubJwk, "ES256");
  const { payload } = await jwtVerify(jws, pubKey, { clockTolerance: 60 });
  const hints = payload["authority_hints"];
  assert.deepEqual(hints, ["https://ta.letsfederate.org"]);
});

test("trustAnchorMetadata contains federation_fetch and federation_list endpoints", () => {
  const meta = trustAnchorMetadata({
    organizationName: "Test TA",
    federationFetchEndpoint: "https://ta.local/federation_fetch",
    federationListEndpoint: "https://ta.local/federation_list",
    trustMarkStatusEndpoint: "https://ta.local/trust-mark-status",
  });
  const fe = meta["federation_entity"];
  assert.equal(fe["federation_fetch_endpoint"], "https://ta.local/federation_fetch");
  assert.equal(fe["federation_list_endpoint"], "https://ta.local/federation_list");
});

// Cleanup
test.after(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});
