/**
 * Tests for TrustMarkStatusRegistry and the /trust-mark-status HTTP endpoint.
 *
 * Tests:
 *  1. isActive() returns true by default (not revoked)
 *  2. revoke() then isActive() returns false
 *  3. restore() after revoke returns true
 *  4. buildStatusKey produces a stable composite key
 *  5. HTTP: GET /trust-mark-status without 'sub' returns 400
 *  6. HTTP: GET /trust-mark-status without 'id' returns 400
 *  7. HTTP: GET /trust-mark-status?sub=X&id=Y (not revoked) returns { active: true }
 *  8. HTTP: GET /trust-mark-status?sub=X&id=Y (revoked) returns { active: false }
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { TrustMarkStatusRegistry, buildStatusKey } from "../dist/federation/trust-mark-status.js";

// ---------------------------------------------------------------------------
// Helper to make a GET request against an http.Server
// ---------------------------------------------------------------------------
function httpGet(server, path) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.get(
      { hostname: "127.0.0.1", port: addr.port, path },
      (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Unit tests — TrustMarkStatusRegistry
// ---------------------------------------------------------------------------

test("isActive() returns true by default for any sub+id", () => {
  const reg = new TrustMarkStatusRegistry();
  assert.equal(reg.isActive("https://entity.example.org", "https://ta.example.org/marks/mcp"), true);
});

test("revoke() then isActive() returns false", () => {
  const reg = new TrustMarkStatusRegistry();
  reg.revoke("https://entity.example.org", "https://ta.example.org/marks/mcp");
  assert.equal(reg.isActive("https://entity.example.org", "https://ta.example.org/marks/mcp"), false);
});

test("restore() after revoke returns isActive() true", () => {
  const reg = new TrustMarkStatusRegistry();
  reg.revoke("https://entity.example.org", "https://ta.example.org/marks/mcp");
  reg.restore("https://entity.example.org", "https://ta.example.org/marks/mcp");
  assert.equal(reg.isActive("https://entity.example.org", "https://ta.example.org/marks/mcp"), true);
});

test("buildStatusKey produces a stable deterministic key", () => {
  const key1 = buildStatusKey("https://sub.example.org", "https://ta.example.org/marks/basic");
  const key2 = buildStatusKey("https://sub.example.org", "https://ta.example.org/marks/basic");
  assert.equal(key1, key2);
  // Different inputs produce different keys
  const key3 = buildStatusKey("https://other.example.org", "https://ta.example.org/marks/basic");
  assert.notEqual(key1, key3);
});

// ---------------------------------------------------------------------------
// HTTP tests — spin up a minimal Express app with the endpoint
// ---------------------------------------------------------------------------

import express from "express";
import { createTrustMarkStatusRouter } from "../dist/federation/trust-mark-status.js";

const SUB = "https://mcp.example.org";
const ID  = "https://ta.example.org/trust-marks/mcp";

let server;
let statusReg;

test("HTTP: setup server", async (t) => {
  t.before(async () => {
    statusReg = new TrustMarkStatusRegistry();
    const app = express();
    app.use("/trust-mark-status", createTrustMarkStatusRouter(statusReg));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test("GET /trust-mark-status without 'sub' returns 400", async () => {
    const res = await httpGet(server, `/trust-mark-status?id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_request");
  });

  await t.test("GET /trust-mark-status without 'id' returns 400", async () => {
    const res = await httpGet(server, `/trust-mark-status?sub=${encodeURIComponent(SUB)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_request");
  });

  await t.test("GET /trust-mark-status?sub&id returns { active: true } when not revoked", async () => {
    const res = await httpGet(server, `/trust-mark-status?sub=${encodeURIComponent(SUB)}&id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.active, true);
  });

  await t.test("GET /trust-mark-status?sub&id returns { active: false } after revoke", async () => {
    statusReg.revoke(SUB, ID);
    const res = await httpGet(server, `/trust-mark-status?sub=${encodeURIComponent(SUB)}&id=${encodeURIComponent(ID)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.active, false);
  });
});
