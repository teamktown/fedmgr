/**
 * Leaf entity-configuration minting (ADR 0002 G1). The proof that closes the
 * loop: an EC minted by `buildLeafEntityConfig` is a real, resolvable OIDF leaf
 * — it self-verifies AND, paired with a TA subordinate statement that binds its
 * key, passes the actual @letsfederate/oidf-verify §10 chain verification.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT, calculateJwkThumbprint, generateKeyPair, exportJWK } from "jose";
import { mintLeafKeypair, buildLeafEntityConfig } from "../dist/entity-config.js";
import { verifyTrustChain } from "@letsfederate/oidf-verify";

const TA = "https://ta.example";
const LEAF = "https://mcp.example";

async function makeTa() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pub = await exportJWK(publicKey);
  pub.alg = "ES256";
  pub.kid = await calculateJwkThumbprint(pub);
  return { entityId: TA, privateKey, pub, jwks: { keys: [pub] } };
}

async function taSign(ta, payload, typ = "entity-statement+jwt") {
  return new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: ta.pub.kid, typ }).sign(ta.privateKey);
}

test("minted EC is self-signed with iss==sub and the correct typ", async () => {
  const kp = await mintLeafKeypair();
  const jwt = await buildLeafEntityConfig({
    entityId: LEAF,
    authorityHints: [TA],
    privateJwk: kp.privateJwk,
    publicJwk: kp.publicJwk,
    endpoint: "https://mcp.example/mcp",
  });
  const header = decodeProtectedHeader(jwt);
  const payload = decodeJwt(jwt);
  assert.equal(header.typ, "entity-statement+jwt");
  assert.equal(payload.iss, LEAF);
  assert.equal(payload.sub, LEAF);
  assert.deepEqual(payload.authority_hints, [TA]);
  assert.equal(payload.jwks.keys[0].kid, kp.publicJwk.kid);
  // The self-signature verifies against the published public key (jose throws on mismatch).
  const { jwtVerify } = await import("jose");
  const key = await importJWK(kp.publicJwk, "ES256");
  await jwtVerify(jwt, key, { typ: "entity-statement+jwt" });
});

test("END-TO-END: minted EC + a binding subordinate statement resolves VALID", async () => {
  const ta = await makeTa();
  const kp = await mintLeafKeypair();
  const leafEC = await buildLeafEntityConfig({
    entityId: LEAF,
    authorityHints: [TA],
    privateJwk: kp.privateJwk,
    publicJwk: kp.publicJwk,
  });
  // TA self-config + a subordinate statement binding the leaf's minted key.
  const now = Math.floor(Date.now() / 1000);
  const taEC = await taSign(ta, { iss: TA, sub: TA, iat: now, exp: now + 3600, jwks: ta.jwks });
  const subStmt = await taSign(ta, {
    iss: TA, sub: LEAF, iat: now, exp: now + 3600, jwks: { keys: [kp.publicJwk] },
  });

  const fetchFn = async (url) => {
    const u = String(url);
    const body =
      u === `${LEAF}/.well-known/openid-federation` ? leafEC :
      u === `${TA}/.well-known/openid-federation` ? taEC :
      u.startsWith(`${TA}/federation_fetch`) && u.includes(encodeURIComponent(LEAF)) ? subStmt :
      null;
    return body
      ? { ok: true, status: 200, text: async () => body }
      : { ok: false, status: 404, text: async () => "not found" };
  };

  const r = await verifyTrustChain(LEAF, {
    trustAnchors: [{ entityId: TA, jwks: ta.jwks }],
    fetchFn,
  });
  assert.equal(r.state, "VALID", r.message);
  assert.deepEqual(r.path, [LEAF, TA]);
});

test("NEGATIVE: a subordinate statement that vouches a DIFFERENT key → INVALID", async () => {
  // Minting a leaf EC is not enough on its own — the TA must vouch for THAT key.
  const ta = await makeTa();
  const kp = await mintLeafKeypair();
  const other = await mintLeafKeypair();
  const leafEC = await buildLeafEntityConfig({
    entityId: LEAF, authorityHints: [TA], privateJwk: kp.privateJwk, publicJwk: kp.publicJwk,
  });
  const now = Math.floor(Date.now() / 1000);
  const taEC = await taSign(ta, { iss: TA, sub: TA, iat: now, exp: now + 3600, jwks: ta.jwks });
  const subStmt = await taSign(ta, {
    iss: TA, sub: LEAF, iat: now, exp: now + 3600, jwks: { keys: [other.publicJwk] },
  });
  const fetchFn = async (url) => {
    const u = String(url);
    const body =
      u === `${LEAF}/.well-known/openid-federation` ? leafEC :
      u === `${TA}/.well-known/openid-federation` ? taEC :
      u.startsWith(`${TA}/federation_fetch`) ? subStmt : null;
    return body ? { ok: true, status: 200, text: async () => body } : { ok: false, status: 404, text: async () => "x" };
  };
  const r = await verifyTrustChain(LEAF, { trustAnchors: [{ entityId: TA, jwks: ta.jwks }], fetchFn });
  assert.equal(r.state, "INVALID");
});

test("NEGATIVE: no authority_hints is refused at mint time", async () => {
  const kp = await mintLeafKeypair();
  await assert.rejects(
    buildLeafEntityConfig({ entityId: LEAF, authorityHints: [], privateJwk: kp.privateJwk, publicJwk: kp.publicJwk }),
    /authority_hint/,
  );
});

test("buildEnrollmentProof: JWS carries {nonce, entity_id}, verifies under the leaf key, kid matches", async () => {
  const { buildEnrollmentProof } = await import("../dist/entity-config.js");
  const { jwtVerify } = await import("jose");
  const kp = await mintLeafKeypair();
  const jws = await buildEnrollmentProof("abc123nonce", "http://localhost:9631/mcp/x", kp.privateJwk);
  const key = await importJWK(kp.publicJwk, "ES256");
  const { payload, protectedHeader } = await jwtVerify(jws, key);
  assert.equal(payload.nonce, "abc123nonce");
  assert.equal(payload.entity_id, "http://localhost:9631/mcp/x");
  assert.equal(protectedHeader.kid, kp.publicJwk.kid);
  // a different key must NOT verify it (proof of THIS key's ownership)
  const other = await mintLeafKeypair();
  const wrongKey = await importJWK(other.publicJwk, "ES256");
  await assert.rejects(() => jwtVerify(jws, wrongKey));
});

test("buildEnrollmentProof: refuses an empty nonce", async () => {
  const { buildEnrollmentProof } = await import("../dist/entity-config.js");
  const kp = await mintLeafKeypair();
  await assert.rejects(() => buildEnrollmentProof("", "http://x", kp.privateJwk), /nonce/);
});
