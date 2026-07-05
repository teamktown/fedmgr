#!/usr/bin/env node
/**
 * Generate the validate-before-run manifest for @letsfederate/fedmgr:
 * sha256 every shipped dist/*.js into packages/fedmgr/provenance/checksums.txt.
 *
 * Run AFTER build (it hashes dist). Wired into the package's prepublishOnly so
 * every published tarball carries a fresh manifest; `fedmgr init` verifies its
 * own files against it and fails fast on mismatch.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listFilesRec, writeChecksums } from "../packages/fedmgr/dist/selfcheck.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "fedmgr");
const dist = resolve(pkgRoot, "dist");
const outDir = resolve(pkgRoot, "provenance");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, "checksums.txt");

const files = listFilesRec(dist, [".js"]);
if (files.length === 0) {
  console.error("[gen-provenance] no dist/*.js found — did you build first?");
  process.exit(1);
}
const n = writeChecksums(pkgRoot, files, out);
console.log(`[gen-provenance] wrote ${n} checksums to ${out}`);
