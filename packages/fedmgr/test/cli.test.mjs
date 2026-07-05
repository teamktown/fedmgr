/**
 * Unit tests for fedmgr CLI commands.
 *
 * These tests exercise command parsing and argument validation without
 * requiring step CLI, cosign, or a running TMI server.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { program } from "../dist/index.js";

// Helper: clone a fresh program instance per test to avoid state leakage.
function makeProgram() {
  // Re-import gives us a fresh Commander instance per test.
  // Since we can't re-import in ESM easily, we test against the exported program
  // and verify its structure.
  return program;
}

test("program has correct name and version", () => {
  const p = makeProgram();
  assert.equal(p.name(), "fedmgr");
  assert.equal(p.version(), "0.0.1");
});

test("program registers keys command", () => {
  const p = makeProgram();
  const cmds = p.commands.map((c) => c.name());
  assert.ok(cmds.includes("keys"), `expected 'keys' in ${cmds.join(", ")}`);
});

test("program registers trustmark command", () => {
  const p = makeProgram();
  const cmds = p.commands.map((c) => c.name());
  assert.ok(cmds.includes("trustmark"), `expected 'trustmark' in ${cmds.join(", ")}`);
});

test("program registers oci command", () => {
  const p = makeProgram();
  const cmds = p.commands.map((c) => c.name());
  assert.ok(cmds.includes("oci"), `expected 'oci' in ${cmds.join(", ")}`);
});

test("keys command has 'init' subcommand with 'softkms'", () => {
  const p = makeProgram();
  const keysCmd = p.commands.find((c) => c.name() === "keys");
  assert.ok(keysCmd, "keys command not found");
  const initCmd = keysCmd.commands.find((c) => c.name() === "init");
  assert.ok(initCmd, "keys init subcommand not found");
  const softkmsCmd = initCmd.commands.find((c) => c.name() === "softkms");
  assert.ok(softkmsCmd, "keys init softkms subcommand not found");
});

test("trustmark command has 'issue' and 'verify' subcommands", () => {
  const p = makeProgram();
  const tmCmd = p.commands.find((c) => c.name() === "trustmark");
  assert.ok(tmCmd, "trustmark command not found");
  const subNames = tmCmd.commands.map((c) => c.name());
  assert.ok(subNames.includes("issue"),  `expected 'issue' in ${subNames.join(", ")}`);
  assert.ok(subNames.includes("verify"), `expected 'verify' in ${subNames.join(", ")}`);
});

test("oci command has 'attach-trustmark' and 'verify-trustmark' subcommands", () => {
  const p = makeProgram();
  const ociCmd = p.commands.find((c) => c.name() === "oci");
  assert.ok(ociCmd, "oci command not found");
  const subNames = ociCmd.commands.map((c) => c.name());
  assert.ok(subNames.includes("attach-trustmark"),  `expected 'attach-trustmark' in ${subNames.join(", ")}`);
  assert.ok(subNames.includes("verify-trustmark"),  `expected 'verify-trustmark' in ${subNames.join(", ")}`);
});

test("trustmark issue --sub is required", async () => {
  const p = makeProgram();
  const tmCmd = p.commands.find((c) => c.name() === "trustmark");
  const issueCmd = tmCmd?.commands.find((c) => c.name() === "issue");
  assert.ok(issueCmd, "trustmark issue not found");
  const subOpt = issueCmd.options.find((o) => o.long === "--sub");
  assert.ok(subOpt?.mandatory, "--sub should be a required option");
});
