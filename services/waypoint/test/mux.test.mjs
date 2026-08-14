/**
 * Waypoint multiplexer — orchestration tested with a FAKE connector (no real
 * processes): admission, namespacing, routing, and fail-closed behaviour.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Waypoint, qualify } from "../dist/mux.js";

const ANCHOR = "https://trust.letsfederate.org";

function fakeConnector(toolsByDownstream) {
  const calls = [];
  return {
    calls,
    connector: {
      async connect(d) {
        if (d.command === "BOOM") throw new Error("spawn failed");
        return {
          name: d.name,
          async listTools() {
            return (toolsByDownstream[d.name] ?? []).map((n) => ({
              name: n,
              description: n,
              inputSchema: { type: "object" },
            }));
          },
          async callTool(name, args) {
            calls.push({ downstream: d.name, name, args });
            return { content: [{ type: "text", text: `${d.name}:${name}` }] };
          },
          async close() {},
        };
      },
    },
  };
}

const ds = (name, anchor = ANCHOR, command = "node") => ({
  name,
  command,
  entityId: `https://trust.letsfederate.org/mcp/${name}`,
  trustAnchor: anchor,
});

test("exposes only admitted downstreams' tools, namespaced", async () => {
  const f = fakeConnector({ good: ["a", "b"], bad: ["x"] });
  const wp = new Waypoint(
    { downstreams: [ds("good"), ds("bad", "https://untrusted.example")], policy: { acceptedAnchors: [ANCHOR] } },
    f.connector
  );
  await wp.start();
  assert.deepEqual(wp.listTools().map((t) => t.name).sort(), ["good__a", "good__b"]);
  assert.deepEqual(
    wp.admissions().map((a) => ({ n: a.name, admit: a.admit })),
    [{ n: "good", admit: true }, { n: "bad", admit: false }]
  );
});

test("routes a tool call to the right downstream with the un-namespaced name", async () => {
  const f = fakeConnector({ good: ["a"] });
  const wp = new Waypoint({ downstreams: [ds("good")], policy: { acceptedAnchors: [ANCHOR] } }, f.connector);
  await wp.start();
  const r = await wp.callTool(qualify("good", "a"), { q: 1 });
  assert.deepEqual(r, { content: [{ type: "text", text: "good:a" }] });
  assert.deepEqual(f.calls, [{ downstream: "good", name: "a", args: { q: 1 } }]);
});

test("fail-closed: unknown or untrusted tool throws", async () => {
  const f = fakeConnector({ good: ["a"] });
  const wp = new Waypoint({ downstreams: [ds("good")], policy: { acceptedAnchors: [ANCHOR] } }, f.connector);
  await wp.start();
  await assert.rejects(() => wp.callTool("good__nope", {}), /unknown or untrusted tool/);
  await assert.rejects(() => wp.callTool("evil__a", {}), /unknown or untrusted tool/);
});

test("a downstream that fails to connect is skipped; others still work", async () => {
  const f = fakeConnector({ good: ["a"] });
  const boom = { ...ds("boom"), command: "BOOM" };
  const wp = new Waypoint({ downstreams: [boom, ds("good")], policy: { acceptedAnchors: [ANCHOR] } }, f.connector);
  await wp.start();
  assert.deepEqual(wp.listTools().map((t) => t.name), ["good__a"]);
  assert.equal(wp.admissions().find((a) => a.name === "boom").admit, false);
});

// ── Cryptographic admission (requireValidChain) ──────────────────────────────
//
// No mock validator: admission runs the REAL @letsfederate/oidf-verify §10
// engine against a hermetic in-memory federation (real ES256 keys, injectable
// fetch). This is the "delete fakeValidator; exercise the real engine" fix from
// the deep re-assessment (test-honesty finding). `good` is a properly enrolled
// leaf (VALID); `bad` has no path to the pinned anchor (INVALID); `err` makes
// the fetch throw (validator error → fail-closed deny).
import { verifyTrustChain } from "@letsfederate/oidf-verify";
import { makeEntity, entityConfig, subordinateStatement, federation, pin } from "../../../packages/oidf-verify/test/harness.mjs";

async function realCryptoFixture() {
  const ta = await makeEntity(ANCHOR);
  const good = await makeEntity("https://trust.letsfederate.org/mcp/good");
  const bad = await makeEntity("https://trust.letsfederate.org/mcp/bad");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  // `good` is enrolled: self-config + a subordinate statement binding its key.
  fed.setConfig(good.entityId, await entityConfig(good, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, good.entityId, await subordinateStatement(ta, good));
  // `bad` self-asserts but the TA never vouched for it (no subordinate stmt).
  fed.setConfig(bad.entityId, await entityConfig(bad, { authorityHints: [ta.entityId] }));
  const anchor = pin(ta);
  // A validator that pins the anchor and uses the hermetic fetch — the real engine.
  const errFetch = async (url) => {
    if (String(url).includes("/mcp/err")) throw new Error("TA unreachable");
    return fed.fetchFn(url);
  };
  const validator = {
    validateChain: async (entityId) => {
      const r = await verifyTrustChain(entityId, { trustAnchors: [anchor], fetchFn: errFetch });
      return { valid: r.state === "VALID", state: r.state, message: r.message };
    },
  };
  return { validator };
}

const dsc = (name) => ({ ...ds(name), trustAnchorUrl: ANCHOR });
const cryptoPolicy = { acceptedAnchors: [ANCHOR], requireValidChain: true };

test("crypto admission: VALID chain admits and records chainState", async () => {
  const f = fakeConnector({ good: ["a"] });
  const { validator } = await realCryptoFixture();
  const wp = new Waypoint({ downstreams: [dsc("good")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
  await wp.start();
  assert.deepEqual(wp.listTools().map((t) => t.name), ["good__a"]);
  assert.equal(wp.admissions().find((a) => a.name === "good").chainState, "VALID");
});

test("crypto admission: INVALID chain DENIES (fail-closed) even if policy accepts the anchor", async () => {
  const f = fakeConnector({ bad: ["a"] });
  const { validator } = await realCryptoFixture();
  const wp = new Waypoint({ downstreams: [dsc("bad")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
  await wp.start();
  assert.equal(wp.listTools().length, 0);
  const a = wp.admissions().find((x) => x.name === "bad");
  assert.equal(a.admit, false);
  assert.equal(a.chainState, "INVALID");
});

test("crypto admission: unreachable entity → INVALID via the real engine → denied", async () => {
  // The §10 engine treats an unreachable/unfetchable entity as INVALID
  // (fail-closed) rather than admitting it.
  const f = fakeConnector({ err: ["a"] });
  const { validator } = await realCryptoFixture();
  const wp = new Waypoint({ downstreams: [dsc("err")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
  await wp.start();
  assert.equal(wp.listTools().length, 0);
  assert.equal(wp.admissions().find((x) => x.name === "err").admit, false);
});

test("crypto admission: validator THROWS → denied (fail-closed), never connected", async () => {
  // Defense in depth: if the validator itself dies, mux must deny, not admit.
  const f = fakeConnector({ err: ["a"] });
  const throwingValidator = {
    validateChain: async () => {
      throw new Error("TA unreachable");
    },
  };
  const wp = new Waypoint({ downstreams: [dsc("err")], policy: cryptoPolicy }, f.connector, { trustValidator: throwingValidator });
  await wp.start();
  assert.equal(wp.listTools().length, 0);
  assert.match(wp.admissions().find((x) => x.name === "err").reasons.join(" "), /validation error/);
});

test("crypto admission: requireValidChain but no validator → denied", async () => {
  const f = fakeConnector({ good: ["a"] });
  const wp = new Waypoint({ downstreams: [dsc("good")], policy: cryptoPolicy }, f.connector); // no validator
  await wp.start();
  assert.equal(wp.listTools().length, 0);
  assert.match(wp.admissions()[0].reasons.join(" "), /no trust validator/);
});
