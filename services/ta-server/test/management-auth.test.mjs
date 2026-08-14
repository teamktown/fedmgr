/**
 * Phase 4 — management API fail-closed auth (review Finding #6).
 *
 * The admin plane (revoke/restore subordinates and trustmarks) must never be
 * served unprotected in production / strict mode. When ADMIN_TOKEN is unset and
 * auth is required, every admin route returns 503 (sealed) — but the rest of the
 * TA keeps serving, so an admin-plane misconfig is not a full outage. In dev/test
 * (no token, not production) the routes stay open but loudly warned.
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {
  createManagementRouter,
  adminAuthRequired,
} from "../dist/management/index.js";

const ENV_KEYS = ["ADMIN_TOKEN", "NODE_ENV", "TA_REQUIRE_ADMIN_AUTH"];

function fakeStore() {
  return {
    listSubordinates: () => [],
    getSubordinate: () => undefined,
    updateSubordinateStatus: () => {},
    audit: () => {},
  };
}

/**
 * Build an express app mounting the management router under a precise env. Only
 * the three relevant keys are touched; all are restored afterwards.
 */
function appWith(env) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    const app = express();
    app.use(express.json());
    app.use("/", createManagementRouter(fakeStore()));
    return app;
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("#6 production without ADMIN_TOKEN seals the admin plane (503)", async () => {
  const app = appWith({ NODE_ENV: "production" });
  const get = await request(app).get("/subordinates");
  assert.equal(get.status, 503);
  assert.equal(get.body.error, "admin_disabled");
  const revoke = await request(app)
    .post("/subordinates/https%3A%2F%2Fmcp.example.com/revoke")
    .send({ reason: "test" });
  assert.equal(revoke.status, 503);
});

test("#6 TA_REQUIRE_ADMIN_AUTH without ADMIN_TOKEN seals the admin plane (503)", async () => {
  const app = appWith({ TA_REQUIRE_ADMIN_AUTH: "1" });
  const res = await request(app).get("/subordinates");
  assert.equal(res.status, 503);
});

test("#6 ADMIN_TOKEN set: 401 without/with wrong bearer, 200 with correct bearer", async () => {
  const app = appWith({ ADMIN_TOKEN: "s3cret", NODE_ENV: "production" });
  assert.equal((await request(app).get("/subordinates")).status, 401);
  assert.equal(
    (await request(app).get("/subordinates").set("Authorization", "Bearer wrong")).status,
    401
  );
  const ok = await request(app).get("/subordinates").set("Authorization", "Bearer s3cret");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { count: 0, items: [] });
});

test("#6 dev/test (no token, not production) leaves the admin plane open", async () => {
  const app = appWith({}); // no ADMIN_TOKEN, no NODE_ENV=production, no flag
  const res = await request(app).get("/subordinates");
  assert.equal(res.status, 200);
});

test("adminAuthRequired() reflects NODE_ENV / TA_REQUIRE_ADMIN_AUTH", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    delete process.env["NODE_ENV"];
    delete process.env["TA_REQUIRE_ADMIN_AUTH"];
    assert.equal(adminAuthRequired(), false);
    process.env["NODE_ENV"] = "production";
    assert.equal(adminAuthRequired(), true);
    process.env["NODE_ENV"] = "development";
    assert.equal(adminAuthRequired(), false);
    process.env["TA_REQUIRE_ADMIN_AUTH"] = "true";
    assert.equal(adminAuthRequired(), true);
    process.env["TA_REQUIRE_ADMIN_AUTH"] = "false";
    assert.equal(adminAuthRequired(), false);
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
