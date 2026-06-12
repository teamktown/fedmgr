/**
 * Waypoint integration — REAL MCP plumbing against the actual fedmgr-mcp server.
 *
 * Spawns fedmgr-mcp (node dist/bin.js) as a downstream via the SDK stdio client,
 * applies an accepted-anchor policy, and asserts the multiplexer exposes its tools
 * namespaced (allow) or nothing at all (deny). No external services needed — only
 * tool LISTING is exercised, so the lab does not have to be running.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Waypoint } from "../dist/mux.js";
import { sdkConnector } from "../dist/connector.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FEDMGR_BIN = path.resolve(HERE, "../../fedmgr-mcp/dist/bin.js");
const ANCHOR = "https://trust.letsfederate.org";

const fedmgr = {
  name: "fedmgr",
  command: "node",
  args: [FEDMGR_BIN],
  entityId: `${ANCHOR}/mcp/fedmgr-mcp`,
  trustAnchor: ANCHOR,
};

test("REAL: admits fedmgr-mcp under an accepted anchor; exposes its tools namespaced", async () => {
  const wp = new Waypoint({ downstreams: [fedmgr], policy: { acceptedAnchors: [ANCHOR] } }, sdkConnector);
  await wp.start();
  try {
    const names = wp.listTools().map((t) => t.name);
    assert.ok(names.includes("fedmgr__validate_mcp_invocation"), `missing namespaced tool; got ${names.slice(0, 3)}…`);
    assert.ok(names.length >= 12, `expected >=12 tools, got ${names.length}`);
    assert.ok(names.every((n) => n.startsWith("fedmgr__")), "all tools must be namespaced");
  } finally {
    await wp.close();
  }
});

test("REAL: denies fedmgr-mcp under a non-accepted anchor; exposes nothing, never connects", async () => {
  const wp = new Waypoint(
    { downstreams: [fedmgr], policy: { acceptedAnchors: ["https://someone-else.example"] } },
    sdkConnector
  );
  await wp.start();
  try {
    assert.equal(wp.listTools().length, 0);
    assert.equal(wp.admissions().find((a) => a.name === "fedmgr").admit, false);
  } finally {
    await wp.close();
  }
});
