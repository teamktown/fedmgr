/**
 * Waypoint admission policy — accepted-anchor gate over configured identity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDownstream } from "../dist/policy.js";

const ANCHOR = "https://trust.letsfederate.org";
const ds = (over = {}) => ({
  name: "x",
  command: "node",
  entityId: "https://trust.letsfederate.org/mcp/x",
  trustAnchor: ANCHOR,
  ...over,
});

test("admits a downstream whose anchor is accepted", () => {
  assert.equal(evaluateDownstream(ds(), { acceptedAnchors: [ANCHOR] }).admit, true);
});

test("denies a downstream whose anchor is NOT accepted (E5 accepted-anchor)", () => {
  const d = evaluateDownstream(ds(), { acceptedAnchors: ["https://other.example"] });
  assert.equal(d.admit, false);
  assert.match(d.reasons.join(" "), /not in the accepted-anchor list/);
});

test("denies when a required trust mark is not asserted", () => {
  const d = evaluateDownstream(ds({ trustMarks: [] }), {
    acceptedAnchors: [ANCHOR],
    requiredTrustMark: "https://letsfederate.dev/trust-mark/mcp-server/v1",
  });
  assert.equal(d.admit, false);
});

test("fail-closed on a malformed (non-https) entity id", () => {
  assert.equal(evaluateDownstream(ds({ entityId: "not-a-url" }), { acceptedAnchors: [ANCHOR] }).admit, false);
});
