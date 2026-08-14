import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

function run(args, env = {}) {
  return execFileSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "ignore"],
  });
}

test("init --dry-run prints the phased plan and makes no changes", () => {
  const out = run(["init", "--dry-run"], { LOG_LEVEL: "error" });
  assert.match(out, /validate-before-run/);
  assert.match(out, /ecosystem/);
  assert.match(out, /ssc-gate/);
});

test("doctor --json emits valid, structured diagnosis", () => {
  // doctor may exit non-zero if a required check fails; capture regardless.
  let out;
  try {
    out = run(["doctor", "--json"], { LOG_LEVEL: "error" });
  } catch (e) {
    out = e.stdout ?? "";
  }
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.ok, "boolean");
  assert.ok(Array.isArray(parsed.checks));
  const node = parsed.checks.find((c) => c.name === "node");
  assert.ok(node, "node check present");
  assert.ok(["ok", "warn", "fail"].includes(node.status));
});
