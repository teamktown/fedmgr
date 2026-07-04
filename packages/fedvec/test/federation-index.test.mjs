import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FederationIndex, entityToText, HashEmbedder } from "../dist/index.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fedvec-test-"));
}

const ENTITIES = [
  {
    entityId: "https://tmi.example.com",
    status: "active",
    metadata: {
      federation_entity: {
        display_name: "Example Trust Mark Issuer",
        description: "Issues and signs trust marks for federation members.",
      },
    },
  },
  {
    entityId: "https://ta.example.com",
    status: "active",
    metadata: {
      federation_entity: {
        display_name: "Example Trust Anchor",
        description: "Root trust anchor that enrolls subordinate entities.",
      },
    },
  },
  {
    entityId: "https://weather-mcp.example.com",
    status: "active",
    metadata: {
      openid_relying_party: {
        client_name: "Weather MCP Server",
        description: "An MCP server that returns weather forecasts.",
      },
    },
  },
];

test("entityToText surfaces display name and description", () => {
  const text = entityToText(ENTITIES[0]);
  assert.match(text, /Trust Mark Issuer/);
  assert.match(text, /Issues and signs trust marks/);
  assert.match(text, /tmi\.example\.com/);
});

test("semantic search ranks the trust-mark issuer first", async () => {
  const dir = tmpDir();
  const index = new FederationIndex({
    rvfPath: path.join(dir, "federation.rvf"),
    embedder: new HashEmbedder(),
  });

  const built = await index.reindexIfChanged(ENTITIES);
  assert.equal(built, true, "first reindex should build");

  const hits = await index.search("issue trust marks to federation members", 3);
  assert.ok(hits.length >= 1, "expected at least one hit");
  assert.equal(
    hits[0].entityId,
    "https://tmi.example.com",
    `TMI should rank first, got ${JSON.stringify(hits.map((h) => h.entityId))}`,
  );
  assert.equal(hits[0].status, "active");
  assert.ok(hits[0].score > 0, "similarity score should be positive");
  // results are sorted closest-first
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].score >= hits[i].score, "hits must be sorted by score desc");
  }
});

test("search finds the MCP server for an unrelated query", async () => {
  const dir = tmpDir();
  const index = new FederationIndex({ rvfPath: path.join(dir, "federation.rvf") });
  await index.reindex(ENTITIES);

  const hits = await index.search("weather forecast mcp server", 3);
  assert.equal(hits[0].entityId, "https://weather-mcp.example.com");
});

test("reindexIfChanged is a no-op when content is unchanged", async () => {
  const dir = tmpDir();
  const index = new FederationIndex({ rvfPath: path.join(dir, "federation.rvf") });

  assert.equal(await index.reindexIfChanged(ENTITIES), true);
  assert.equal(await index.reindexIfChanged(ENTITIES), false);

  // changing an entity triggers a rebuild
  const changed = [...ENTITIES, { entityId: "https://new.example.com", status: "active" }];
  assert.equal(await index.reindexIfChanged(changed), true);
});

test("search on an unbuilt index returns []", async () => {
  const dir = tmpDir();
  const index = new FederationIndex({ rvfPath: path.join(dir, "nope.rvf") });
  assert.deepEqual(await index.search("anything"), []);
});
