import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFilesRec, writeChecksums, verifyChecksums } from "../dist/selfcheck.js";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "selfcheck-"));
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "a.js"), "console.log('a');\n");
  writeFileSync(join(root, "dist", "b.js"), "console.log('b');\n");
  writeFileSync(join(root, "dist", "skip.txt"), "not js\n");
  return root;
}

test("listFilesRec finds .js files only", () => {
  const root = fixtureRoot();
  try {
    const files = listFilesRec(join(root, "dist"), [".js"]);
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => f.endsWith(".js")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeChecksums then verifyChecksums round-trips (armed)", () => {
  const root = fixtureRoot();
  try {
    const manifest = join(root, "checksums.txt");
    const n = writeChecksums(root, listFilesRec(join(root, "dist")), manifest);
    assert.equal(n, 2);
    const v = verifyChecksums(root, manifest);
    assert.equal(v.ok, true, v.reasons.join("; "));
    assert.equal(v.checked, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyChecksums fails fast on a tampered file (not a rubber stamp)", () => {
  const root = fixtureRoot();
  try {
    const manifest = join(root, "checksums.txt");
    writeChecksums(root, listFilesRec(join(root, "dist")), manifest);
    // tamper
    writeFileSync(join(root, "dist", "a.js"), "console.log('TAMPERED');\n");
    const v = verifyChecksums(root, manifest);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /mismatch/i.test(r)), v.reasons.join("; "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyChecksums fails on a missing file and a missing manifest", () => {
  const root = fixtureRoot();
  try {
    const manifest = join(root, "checksums.txt");
    writeChecksums(root, listFilesRec(join(root, "dist")), manifest);
    rmSync(join(root, "dist", "b.js"));
    const v = verifyChecksums(root, manifest);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => /missing/i.test(r)), v.reasons.join("; "));

    const noManifest = verifyChecksums(root, join(root, "nope.txt"));
    assert.equal(noManifest.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
