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
