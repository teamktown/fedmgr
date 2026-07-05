import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../dist/index.js";

/** Capture what the logger writes to stderr while running `fn`. */
function capture(fn) {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return lines.join("").trimEnd().split("\n").filter(Boolean);
}

test("LOG_LEVEL gates lower-severity messages", () => {
  process.env.LOG_LEVEL = "info";
  process.env.LOG_FORMAT = "json";
  const log = createLogger("t");
  const out = capture(() => {
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d"); // filtered out at info
    log.trace("tr"); // filtered out at info
  });
  const levels = out.map((l) => JSON.parse(l).level);
  assert.deepEqual(levels, ["error", "warn", "info"]);
});

test("debug level lets debug through", () => {
  process.env.LOG_LEVEL = "debug";
  process.env.LOG_FORMAT = "json";
  const log = createLogger("t");
  const out = capture(() => log.debug("d", { k: 1 }));
  assert.equal(out.length, 1);
  const rec = JSON.parse(out[0]);
  assert.equal(rec.level, "debug");
  assert.equal(rec.msg, "d");
  assert.equal(rec.k, 1);
  assert.equal(rec.component, "t");
  assert.ok(typeof rec.ts === "string");
});

test("child binds component + base fields, merges call fields", () => {
  process.env.LOG_LEVEL = "info";
  process.env.LOG_FORMAT = "json";
  const log = createLogger("root", { app: "fedmgr" });
  const child = log.child("init", { phase: "ca" });
  const out = capture(() => child.info("minting", { step: 2 }));
  const rec = JSON.parse(out[0]);
  assert.equal(rec.component, "init");
  assert.equal(rec.app, "fedmgr");
  assert.equal(rec.phase, "ca");
  assert.equal(rec.step, 2);
});

test("text format renders a human line with key=val fields", () => {
  process.env.LOG_LEVEL = "info";
  process.env.LOG_FORMAT = "text";
  const log = createLogger("comp");
  const out = capture(() => log.info("hello world", { n: 3 }));
  assert.equal(out.length, 1);
  assert.match(out[0], /INFO\s+\[comp\] hello world n=3/);
});
