/**
 * Tests for FileSubordinateRegistry — persistent JSON-backed registry.
 *
 * Tests:
 *  1.  register() persists to JSON file
 *  2.  New instance from same path loads previously registered entries
 *  3.  Multiple register() calls accumulate entries
 *  4.  remove() deletes entry from memory and file
 *  5.  remove() on unknown entity returns false without error
 *  6.  Constructs without error when file does not exist yet
 *  7.  Entry with metadata round-trips correctly
 *  8.  Two concurrent instances on different paths are independent
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { FileSubordinateRegistry } from "../dist/federation/file-registry.js";

const TMP = new URL("./.tmp/file-reg/", import.meta.url).pathname;
await fs.mkdir(TMP, { recursive: true });

const JWKS = { keys: [{ kty: "EC", crv: "P-256", x: "ax", y: "ay", use: "sig" }] };

test("register() persists entry to JSON file", async () => {
  const filePath = path.join(TMP, "reg1.json");
  const reg = new FileSubordinateRegistry(filePath);
  reg.register({ entityId: "https://leaf.example.org", jwks: JWKS });

  const raw = await fs.readFile(filePath, "utf8");
  const saved = JSON.parse(raw);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entityId, "https://leaf.example.org");
});

test("new instance from same path loads previously registered entries", async () => {
  const filePath = path.join(TMP, "reg2.json");
  const reg1 = new FileSubordinateRegistry(filePath);
  reg1.register({ entityId: "https://leaf-a.example.org", jwks: JWKS });
  reg1.register({ entityId: "https://leaf-b.example.org", jwks: JWKS });

  // Create a second instance pointing at the same file
  const reg2 = new FileSubordinateRegistry(filePath);
  const ids = reg2.listEntityIds();
  assert.ok(ids.includes("https://leaf-a.example.org"));
  assert.ok(ids.includes("https://leaf-b.example.org"));
  assert.equal(ids.length, 2);
});

test("multiple register() calls accumulate entries", async () => {
  const filePath = path.join(TMP, "reg3.json");
  const reg = new FileSubordinateRegistry(filePath);
  for (let i = 0; i < 5; i++) {
    reg.register({ entityId: `https://entity${i}.example.org`, jwks: JWKS });
  }
  assert.equal(reg.listEntityIds().length, 5);

  // File should contain all 5
  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(JSON.parse(raw).length, 5);
});

test("remove() deletes entry from memory and file", async () => {
  const filePath = path.join(TMP, "reg4.json");
  const reg = new FileSubordinateRegistry(filePath);
  reg.register({ entityId: "https://leaf.example.org", jwks: JWKS });
  reg.register({ entityId: "https://leaf2.example.org", jwks: JWKS });

  const removed = reg.remove("https://leaf.example.org");
  assert.equal(removed, true);
  assert.equal(reg.has("https://leaf.example.org"), false);
  assert.equal(reg.listEntityIds().length, 1);

  // File should reflect removal
  const raw = await fs.readFile(filePath, "utf8");
  const saved = JSON.parse(raw);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entityId, "https://leaf2.example.org");
});

test("remove() on unknown entity returns false without error", async () => {
  const filePath = path.join(TMP, "reg5.json");
  const reg = new FileSubordinateRegistry(filePath);
  const result = reg.remove("https://does-not-exist.example.org");
  assert.equal(result, false);
});

test("constructs without error when file does not exist yet", () => {
  const filePath = path.join(TMP, "nonexistent-dir", "reg6.json");
  const reg = new FileSubordinateRegistry(filePath);
  assert.equal(reg.listEntityIds().length, 0);
});

test("entry with metadata round-trips correctly", async () => {
  const filePath = path.join(TMP, "reg7.json");
  const reg = new FileSubordinateRegistry(filePath);
  reg.register({
    entityId: "https://inter.example.org",
    jwks: JWKS,
    metadata: {
      federation_entity: {
        federation_fetch_endpoint: "https://inter.example.org/federation_fetch",
      },
    },
  });

  const reg2 = new FileSubordinateRegistry(filePath);
  const entry = reg2.get("https://inter.example.org");
  assert.ok(entry, "entry should be present after reload");
  const fe = entry.metadata?.["federation_entity"];
  assert.ok(fe, "metadata.federation_entity should be present");
  assert.equal(fe["federation_fetch_endpoint"], "https://inter.example.org/federation_fetch");
});

test("two instances on different paths are independent", async () => {
  const fileA = path.join(TMP, "reg8a.json");
  const fileB = path.join(TMP, "reg8b.json");
  const regA = new FileSubordinateRegistry(fileA);
  const regB = new FileSubordinateRegistry(fileB);

  regA.register({ entityId: "https://a.example.org", jwks: JWKS });
  regB.register({ entityId: "https://b.example.org", jwks: JWKS });

  assert.ok(regA.has("https://a.example.org"));
  assert.ok(!regA.has("https://b.example.org"));
  assert.ok(regB.has("https://b.example.org"));
  assert.ok(!regB.has("https://a.example.org"));
});

// Cleanup
test.after(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});
