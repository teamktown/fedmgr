/**
 * Integration test for GET /federation_search.
 *
 * Drives the real router with a real SQLite FederationStore and a real fedvec
 * RuVector index over a real on-disk `.rvf` file — end to end, no mocks — to
 * prove semantic discovery ranks the right registered entity first.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { SqliteFederationStore } from "../dist/db/sqlite-store.js";
import { createFederationSearchRouter } from "../dist/federation/federation-search.js";
import { FederationIndex } from "@letsfederate/fedvec";

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-search-"));
  const store = new SqliteFederationStore(path.join(dir, "ta.db"));
  store.migrate();

  const seed = [
    {
      entityId: "https://tmi.example.com",
      jwksUrl: "https://tmi.example.com/jwks",
      jwks: null,
      metadata: {
        federation_entity: {
          display_name: "Example Trust Mark Issuer",
          description: "Issues and signs trust marks for federation members.",
        },
      },
      status: "active",
      isIntermediate: false,
      revocationReason: null,
      revokedAt: null,
      revokedBy: null,
      notes: null,
    },
    {
      entityId: "https://weather-mcp.example.com",
      jwksUrl: "https://weather-mcp.example.com/jwks",
      jwks: null,
      metadata: {
        openid_relying_party: {
          client_name: "Weather MCP Server",
          description: "An MCP server that returns weather forecasts.",
        },
      },
      status: "active",
      isIntermediate: false,
      revocationReason: null,
      revokedAt: null,
      revokedBy: null,
      notes: null,
    },
  ];
  for (const row of seed) store.upsertSubordinate(row);

  const index = new FederationIndex({ rvfPath: path.join(dir, "federation.rvf") });
  const app = express();
  app.use(createFederationSearchRouter(store, index));
  return app;
}

test("GET /federation_search ranks the trust-mark issuer first", async () => {
  const app = makeApp();
  const res = await request(app).get("/federation_search").query({
    q: "who can issue trust marks?",
    k: 5,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.query, "who can issue trust marks?");
  assert.ok(res.body.results.length >= 1);
  assert.equal(res.body.results[0].entityId, "https://tmi.example.com");
  assert.equal(res.body.results[0].status, "active");
  assert.ok(res.body.results[0].score >= res.body.results.at(-1).score);
});

test("GET /federation_search finds the MCP server for a topical query", async () => {
  const app = makeApp();
  const res = await request(app).get("/federation_search").query({ q: "weather forecast server" });
  assert.equal(res.status, 200);
  assert.equal(res.body.results[0].entityId, "https://weather-mcp.example.com");
});

test("GET /federation_search without q returns 400", async () => {
  const app = makeApp();
  const res = await request(app).get("/federation_search");
  assert.equal(res.status, 400);
  assert.match(res.body.error, /q/);
});
