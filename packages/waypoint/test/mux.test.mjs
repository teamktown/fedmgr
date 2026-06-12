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

function fakeValidator(byEntity) {
  return {
    validateChain: async (entityId) => {
      const v = byEntity[entityId];
      if (v instanceof Error) throw v;
      return v ?? { valid: false, state: "INVALID", message: "unknown entity" };
    },
  };
}
const dsc = (name) => ({ ...ds(name), trustAnchorUrl: "http://localhost:8090" });
const cryptoPolicy = { acceptedAnchors: [ANCHOR], requireValidChain: true };

test("crypto admission: VALID chain admits and records chainState", async () => {
  const f = fakeConnector({ good: ["a"] });
  const validator = fakeValidator({ "https://trust.letsfederate.org/mcp/good": { valid: true, state: "VALID", message: "ok" } });
  const wp = new Waypoint({ downstreams: [dsc("good")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
  await wp.start();
  assert.deepEqual(wp.listTools().map((t) => t.name), ["good__a"]);
  assert.equal(wp.admissions().find((a) => a.name === "good").chainState, "VALID");
});

test("crypto admission: WARN/INVALID chain DENIES (fail-closed) even if policy accepts the anchor", async () => {
  const f = fakeConnector({ bad: ["a"] });
  const validator = fakeValidator({ "https://trust.letsfederate.org/mcp/bad": { valid: false, state: "WARN", message: "no authority_hints" } });
  const wp = new Waypoint({ downstreams: [dsc("bad")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
  await wp.start();
  assert.equal(wp.listTools().length, 0);
  const a = wp.admissions().find((x) => x.name === "bad");
  assert.equal(a.admit, false);
  assert.equal(a.chainState, "WARN");
});

test("crypto admission: validator THROWS → denied (fail-closed), never connected", async () => {
  const f = fakeConnector({ err: ["a"] });
  const validator = fakeValidator({ "https://trust.letsfederate.org/mcp/err": new Error("TA unreachable") });
  const wp = new Waypoint({ downstreams: [dsc("err")], policy: cryptoPolicy }, f.connector, { trustValidator: validator });
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
