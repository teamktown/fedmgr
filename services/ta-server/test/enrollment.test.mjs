/**
 * Enrollment router — genuine end-to-end tests (review R3: the 421-LOC
 * trust-onboarding entry point had zero coverage).
 *
 * Nothing here is faked: a real SqliteStore on a temp file, a real
 * SoftKmsProvider with freshly generated ES256 keys, a real loopback HTTP
 * server hosting the leaf's JWKS, real express+supertest HTTP, and real jose
 * verification of the returned subordinate statement. NODE_ENV=development is
 * set (and restored) because the SSRF guard only allows loopback http: in dev.
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  calculateJwkThumbprint,
  SignJWT,
  jwtVerify,
} from "jose";
import { createEnrollmentRouter } from "../dist/enrollment/index.js";
import { SqliteFederationStore as SqliteStore } from "../dist/db/sqlite-store.js";
import { SoftKmsProvider } from "@letsfederate/kms";

const TA_ENTITY_ID = "https://ta.test";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-test-"));

// ── real TA keys + KMS ──────────────────────────────────────────────────────
async function makeKeypair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pub = await exportJWK(publicKey);
  pub.alg = "ES256";
  pub.kid = await calculateJwkThumbprint(pub);
  const priv = await exportJWK(privateKey);
  priv.alg = "ES256";
  priv.kid = pub.kid;
  return { pub, priv };
}

const taKeys = await makeKeypair();
fs.writeFileSync(path.join(tmp, "ta.priv.jwk"), JSON.stringify(taKeys.priv));
fs.writeFileSync(path.join(tmp, "ta.pub.jwk"), JSON.stringify(taKeys.pub));
const kms = new SoftKmsProvider({
  privateJwkPath: path.join(tmp, "ta.priv.jwk"),
  publicJwkPath: path.join(tmp, "ta.pub.jwk"),
});

// ── real leaf identity + a real HTTP host for its JWKS ─────────────────────
const leafKeys = await makeKeypair();
const otherKeys = await makeKeypair(); // an attacker's keypair — must never verify

const jwksServer = http.createServer((req, res) => {
  if (req.url === "/jwks.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [leafKeys.pub] }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
await new Promise((r) => jwksServer.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${jwksServer.address().port}`;
const LEAF_ID = `${ORIGIN}/mcp/test-leaf`;
const JWKS_URL = `${ORIGIN}/jwks.json`;

const savedNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development"; // loopback http: allowed in dev only
test.after(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  jwksServer.close();
});

let n = 0;
function freshApp() {
  const dbPath = path.join(tmp, `ta-${n++}.db`);
  const store = new SqliteStore(dbPath);
  store.migrate();
  const app = express();
  app.use(express.json());
  app.use("/", createEnrollmentRouter(store, kms, TA_ENTITY_ID, `${TA_ENTITY_ID}/.well-known/jwks.json`));
  return { app, store, dbPath };
}

async function proof(nonce, entityId, keys) {
  const key = await importJWK(keys.priv, "ES256");
  return new SignJWT({ nonce, entity_id: entityId })
    .setProtectedHeader({ alg: "ES256", kid: keys.priv.kid })
    .sign(key);
}

async function startEnrollment(app, entityId = LEAF_ID, jwksUrl = JWKS_URL) {
  return request(app).post("/enroll").send({ entity_id: entityId, jwks_url: jwksUrl });
}

// ── the happy path, verified with independent crypto ───────────────────────
test("enroll → proof-of-key → active subordinate; statement verifies under the TA key", async () => {
  const { app, store } = freshApp();
  const start = await startEnrollment(app);
  assert.equal(start.status, 202);
  assert.ok(start.body.enrollment_id && start.body.nonce, "challenge issued");

  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, leafKeys) });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "active");

  // Independently verify the TA's subordinate statement — different code path
  // than the one that signed it.
  const taKey = await importJWK(taKeys.pub, "ES256");
  const { payload, protectedHeader } = await jwtVerify(
    done.body.signed_subordinate_statement, taKey, { typ: "entity-statement+jwt" });
  assert.equal(payload.iss, TA_ENTITY_ID);
  assert.equal(payload.sub, LEAF_ID);
  assert.equal(payload.jwks.keys[0].kid, leafKeys.pub.kid, "statement binds the LEAF's key");
  assert.equal(protectedHeader.alg, "ES256");

  assert.equal(store.getSubordinate(LEAF_ID)?.status, "active");
});

// ── durability: the state survives a store close + reopen (the unit-level ──
// contract behind the lab's ta-data volume) ─────────────────────────────────
test("DURABILITY: active enrollment survives store close + reopen from the same file", async () => {
  const { app, store, dbPath } = freshApp();
  const start = await startEnrollment(app);
  await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, leafKeys) });
  assert.equal(store.getSubordinate(LEAF_ID)?.status, "active");

  store.close();
  const reopened = new SqliteStore(dbPath);
  const sub = reopened.getSubordinate(LEAF_ID);
  assert.equal(sub?.status, "active", "subordinate persisted across close/reopen");
  assert.equal(sub?.jwks?.keys?.[0]?.kid, leafKeys.pub.kid, "bound keys persisted too");
  reopened.close();
});

// ── negatives: every rejection path, fail-closed ────────────────────────────
test("NEGATIVE: proof signed with the WRONG key is rejected 401 and never activates", async () => {
  const { app, store } = freshApp();
  const start = await startEnrollment(app);
  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, otherKeys) });
  assert.equal(done.status, 401);
  assert.equal(done.body.error, "proof_invalid");
  assert.notEqual(store.getSubordinate(LEAF_ID)?.status, "active");
});

test("NEGATIVE: right key, wrong nonce → 401 nonce_mismatch", async () => {
  const { app } = freshApp();
  const start = await startEnrollment(app);
  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof("not-the-nonce", LEAF_ID, leafKeys) });
  assert.equal(done.status, 401);
  assert.equal(done.body.error, "nonce_mismatch");
});

test("NEGATIVE: right key + nonce, wrong entity_id in proof → 401 entity_id_mismatch", async () => {
  const { app } = freshApp();
  const start = await startEnrollment(app);
  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, `${ORIGIN}/mcp/impostor`, leafKeys) });
  assert.equal(done.status, 401);
  assert.equal(done.body.error, "entity_id_mismatch");
});

test("NEGATIVE: replaying a completed enrollment → 409 enrollment_not_pending", async () => {
  const { app } = freshApp();
  const start = await startEnrollment(app);
  const jws = await proof(start.body.nonce, LEAF_ID, leafKeys);
  const first = await request(app).post(`/enroll/${start.body.enrollment_id}/complete`).send({ proof_jws: jws });
  assert.equal(first.status, 200);
  const replay = await request(app).post(`/enroll/${start.body.enrollment_id}/complete`).send({ proof_jws: jws });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, "enrollment_not_pending");
});

test("NEGATIVE: expired challenge → 410, valid proof notwithstanding", async () => {
  const { app, store } = freshApp();
  const start = await startEnrollment(app);
  store.updateEnrollment(start.body.enrollment_id, "expired"); // what expireEnrollments() does at 10min
  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, leafKeys) });
  assert.equal(done.status, 410);
  assert.equal(done.body.error, "enrollment_expired");
});

test("NEGATIVE: jwks_url on a different origin than entity_id → 400 origin_mismatch", async () => {
  const { app } = freshApp();
  const r = await startEnrollment(app, LEAF_ID, "http://127.0.0.1:1/jwks.json");
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "origin_mismatch");
});

test("NEGATIVE: private-range jwks_url blocked by SSRF guard even in dev", async () => {
  const { app } = freshApp();
  const r = await startEnrollment(app, "http://10.9.9.9/mcp/x", "http://10.9.9.9/jwks.json");
  assert.equal(r.status, 400);
  assert.match(r.body.message, /TRUST:FAIL/);
});

test("NEGATIVE: re-enrolling an already-active entity → 409 already_enrolled", async () => {
  const { app } = freshApp();
  const start = await startEnrollment(app);
  await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, leafKeys) });
  const again = await startEnrollment(app);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already_enrolled");
});

test("NEGATIVE: completing an unknown enrollment id → 404", async () => {
  const { app } = freshApp();
  const r = await request(app).post("/enroll/no-such-id/complete").send({ proof_jws: "x.y.z" });
  assert.equal(r.status, 404);
});

test("NEGATIVE: unreachable JWKS at completion → 502 jwks_fetch_failed, not active", async () => {
  const { app, store } = freshApp();
  const start = await startEnrollment(app, LEAF_ID, `${ORIGIN}/missing.json`);
  assert.equal(start.status, 202);
  const done = await request(app)
    .post(`/enroll/${start.body.enrollment_id}/complete`)
    .send({ proof_jws: await proof(start.body.nonce, LEAF_ID, leafKeys) });
  assert.equal(done.status, 502);
  assert.equal(done.body.error, "jwks_fetch_failed");
  assert.notEqual(store.getSubordinate(LEAF_ID)?.status, "active");
});
