/**
 * resolvePinnedAnchor — hard-pin vs trust-on-first-use fallback.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolvePinnedAnchor } from "../dist/index.js";
import { makeEntity, entityConfig, federation } from "./harness.mjs";

test("hard-pinned jwks are returned as-is, with NO network fetch", async () => {
  const ta = await makeEntity("https://ta.example");
  let fetched = false;
  const anchor = await resolvePinnedAnchor({
    entityId: ta.entityId,
    pinnedJwks: ta.jwks,
    trustMarkIssuers: { "t": ["https://tmi.example"] },
    fetchFn: async () => {
      fetched = true;
      return { ok: false, status: 500, text: async () => "" };
    },
  });
  assert.equal(fetched, false, "hard pin must not hit the network");
  assert.equal(anchor.entityId, ta.entityId);
  assert.deepEqual(anchor.jwks, ta.jwks);
  assert.deepEqual(anchor.trustMarkIssuers, { "t": ["https://tmi.example"] });
});

test("no pin → TOFU: fetches the anchor EC and invokes onTofu", async () => {
  const ta = await makeEntity("https://ta.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, {
    authorityHints: [],
    trustMarkIssuers: { "t": ["https://tmi.example"] },
  }));
  let warned = null;
  const anchor = await resolvePinnedAnchor({
    entityId: ta.entityId,
    fetchFn: fed.fetchFn,
    onTofu: (id) => { warned = id; },
  });
  assert.equal(warned, ta.entityId, "onTofu must fire on the fallback path");
  assert.equal(anchor.entityId, ta.entityId);
  assert.ok(anchor.jwks.keys.length >= 1);
  // trust_mark_issuers is read from the verified anchor EC on the TOFU path.
  assert.deepEqual(anchor.trustMarkIssuers, { "t": ["https://tmi.example"] });
});

test("TOFU fetch failure propagates (fail-closed, not a silent empty anchor)", async () => {
  await assert.rejects(
    resolvePinnedAnchor({
      entityId: "https://ta.example",
      fetchFn: async () => ({ ok: false, status: 404, text: async () => "nope" }),
    }),
    /fetch failed|404/i,
  );
});
