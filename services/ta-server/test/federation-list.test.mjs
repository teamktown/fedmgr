/**
 * HTTP tests for GET /federation_list
 *
 * Tests:
 *  1.  Returns [] when registry is empty
 *  2.  Returns all registered entity IDs
 *  3.  entity_type=intermediate filters to intermediates only
 *  4.  entity_type=leaf filters to leaves only
 *  5.  limit=N truncates to N results
 *  6.  after=<id> returns entries after the cursor
 *  7.  after + limit combine correctly
 *  8.  Unknown entity_type returns all (no 400 — unknown values are ignored)
 *  9.  limit=0 is ignored (returns all)
 * 10.  after=<unknown id> returns []
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  SubordinateRegistry,
  isIntermediate,
} from "../dist/federation/subordinate-statements.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpGet(server, path) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.get(
      { hostname: "127.0.0.1", port: addr.port, path },
      (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => resolve({
          status: res.statusCode,
          contentType: res.headers["content-type"],
          body: JSON.parse(body),
        }));
      }
    );
    req.on("error", reject);
  });
}

// Build a minimal Express app exposing /federation_list backed by the given
// registry — mirrors the logic in src/index.ts.
function makeApp(registry) {
  const app = express();
  app.get("/federation_list", (req, res) => {
    let ids = registry.listEntityIds();

    const entityType = req.query["entity_type"];
    if (entityType === "intermediate") {
      ids = ids.filter((id) => { const e = registry.get(id); return e ? isIntermediate(e) : false; });
    } else if (entityType === "leaf") {
      ids = ids.filter((id) => { const e = registry.get(id); return e ? !isIntermediate(e) : false; });
    }

    const after = req.query["after"];
    if (after) {
      const idx = ids.indexOf(after);
      ids = idx >= 0 ? ids.slice(idx + 1) : [];
    }

    const limitRaw = req.query["limit"];
    if (limitRaw) {
      const limit = parseInt(String(limitRaw), 10);
      if (!isNaN(limit) && limit > 0) ids = ids.slice(0, limit);
    }

    res.setHeader("Content-Type", "application/json");
    res.json(ids);
  });
  return app;
}

// A minimal JWKS stub — not used in these tests but required by SubordinateEntry.
const JWKS = { keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y", use: "sig" }] };

// ---------------------------------------------------------------------------
// Test suite — single HTTP server shared across all tests
// ---------------------------------------------------------------------------

test("GET /federation_list", async (t) => {
  let registry;
  let server;

  t.before(async () => {
    registry = new SubordinateRegistry();

    // Register 3 leaves + 2 intermediates
    registry.register({ entityId: "https://leaf1.example.org", jwks: JWKS });
    registry.register({ entityId: "https://leaf2.example.org", jwks: JWKS });
    registry.register({ entityId: "https://leaf3.example.org", jwks: JWKS });
    registry.register({
      entityId: "https://inter1.example.org", jwks: JWKS,
      metadata: { federation_entity: { federation_fetch_endpoint: "https://inter1.example.org/federation_fetch" } },
    });
    registry.register({
      entityId: "https://inter2.example.org", jwks: JWKS,
      metadata: { federation_entity: { federation_fetch_endpoint: "https://inter2.example.org/federation_fetch" } },
    });

    await new Promise((resolve) => { server = makeApp(registry).listen(0, "127.0.0.1", resolve); });
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test("returns all 5 entity IDs when no filter", async () => {
    const res = await httpGet(server, "/federation_list");
    assert.equal(res.status, 200);
    assert.ok(res.contentType?.includes("application/json"));
    assert.equal(res.body.length, 5);
  });

  await t.test("entity_type=intermediate returns only 2 intermediates", async () => {
    const res = await httpGet(server, "/federation_list?entity_type=intermediate");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.sort(), [
      "https://inter1.example.org",
      "https://inter2.example.org",
    ].sort());
  });

  await t.test("entity_type=leaf returns only 3 leaves", async () => {
    const res = await httpGet(server, "/federation_list?entity_type=leaf");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    assert.ok(res.body.every((id) => id.includes("leaf")));
  });

  await t.test("limit=2 returns first 2 results", async () => {
    const res = await httpGet(server, "/federation_list?limit=2");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });

  await t.test("after=<first id> returns remaining 4", async () => {
    const allRes = await httpGet(server, "/federation_list");
    const firstId = allRes.body[0];
    const res = await httpGet(server, `/federation_list?after=${encodeURIComponent(firstId)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 4);
    assert.ok(!res.body.includes(firstId));
  });

  await t.test("after + limit combine correctly", async () => {
    const allRes = await httpGet(server, "/federation_list");
    const firstId = allRes.body[0];
    const res = await httpGet(server, `/federation_list?after=${encodeURIComponent(firstId)}&limit=2`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.ok(!res.body.includes(firstId));
  });

  await t.test("unknown entity_type returns all (no 400)", async () => {
    const res = await httpGet(server, "/federation_list?entity_type=openid_provider");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 5);
  });

  await t.test("limit=0 is ignored — returns all", async () => {
    const res = await httpGet(server, "/federation_list?limit=0");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 5);
  });

  await t.test("after=<unknown id> returns []", async () => {
    const res = await httpGet(server, "/federation_list?after=https://does-not-exist.example.org");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });
});

test("GET /federation_list returns [] when registry is empty", async () => {
  const registry = new SubordinateRegistry();
  const app = makeApp(registry);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const res = await httpGet(server, "/federation_list");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
