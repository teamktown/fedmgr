#!/usr/bin/env node
/**
 * build-corpus — mint public/corpus.json from content/qa/*.md.
 *
 * The CI-economical pipeline from docs/analysis/website-ai-infrastructure.html:
 * embeddings are computed locally (hash embedder — zero downloads, zero API),
 * the build is content-hash gated (unchanged content = no-op, same gating as
 * packages/fedvec), and the emitted corpus is a deterministic, signable
 * artifact tied to the content that produced it.
 *
 * Entry format (content/qa/*.md):
 *   ---
 *   question: Who can issue trust marks?
 *   arc: bring-your-own-trust
 *   audience: [enterprise, operator]
 *   tags: [trustmark, tmi]
 *   ---
 *   The answer body (markdown).
 *
 * Usage: node site/tools/build-corpus.mjs [--content <dir>] [--out <file>]
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHashEmbedder } from "../lib/hash-embedder.mjs";

const REQUIRED_FIELDS = ["question", "arc"];
const KNOWN_ARCS = new Set([
  "deploy-oidf-with-ai",
  "bring-your-own-trust",
  "supply-chain-integrity",
]);

/** Minimal front-matter parser: `key: value` and `key: [a, b]`. No YAML dep. */
function parseFrontMatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`[TRUST:FAIL] ${file}: missing front-matter block`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) throw new Error(`[TRUST:FAIL] ${file}: unparseable front-matter line "${line}"`);
    const [, key, valueRaw] = kv;
    const value = valueRaw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      meta[key] = value;
    }
  }
  return { meta, body: m[2].trim() };
}

export async function buildCorpus({
  contentDir,
  outFile,
  dimensions = 384,
} = {}) {
  const qaDir = path.join(contentDir, "qa");
  let files = [];
  try {
    files = (await fsp.readdir(qaDir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    /* fall through to the zero-entry failure below */
  }

  const entries = [];
  const documents = [];
  for (const file of files) {
    const raw = await fsp.readFile(path.join(qaDir, file), "utf8");
    const { meta, body } = parseFrontMatter(raw, file);
    for (const field of REQUIRED_FIELDS) {
      if (!meta[field]) {
        throw new Error(`[TRUST:FAIL] ${file}: front-matter is missing required "${field}"`);
      }
    }
    if (!body) throw new Error(`[TRUST:FAIL] ${file}: empty answer body`);
    if (!KNOWN_ARCS.has(meta.arc)) {
      throw new Error(
        `[TRUST:FAIL] ${file}: unknown arc "${meta.arc}" (expected one of ${[...KNOWN_ARCS].join(", ")})`
      );
    }
    const id = entries.length;
    entries.push({
      id,
      question: meta.question,
      answer: body,
      arc: meta.arc,
      audience: meta.audience ?? [],
      tags: meta.tags ?? [],
      source: `qa/${file}`,
    });
    documents.push(`${meta.question}\n${body}`);
  }

  if (entries.length === 0) {
    throw new Error(`[TRUST:FAIL] no Q&A entries found in ${qaDir} — refusing to mint an empty corpus`);
  }

  const embedder = createHashEmbedder(dimensions);

  // Content hash mirrors fedvec's gating: embedder id + dims + every document.
  const h = createHash("sha256");
  h.update(embedder.id);
  h.update(" ");
  h.update(String(dimensions));
  for (const d of documents) {
    h.update(" ");
    h.update(d);
  }
  const contentHash = `sha256:${h.digest("hex")}`;

  try {
    const existing = JSON.parse(await fsp.readFile(outFile, "utf8"));
    if (existing.contentHash === contentHash) {
      return { rebuilt: false, entries: entries.length, contentHash, outFile };
    }
  } catch {
    /* no existing corpus — build */
  }

  const vectors = embedder.embedBatch(documents);
  const flat = new Float32Array(entries.length * dimensions);
  vectors.forEach((v, i) => flat.set(v, i * dimensions));

  const corpus = {
    version: 1,
    embedder: embedder.id,
    dimensions,
    metric: "l2-normalized",
    contentHash,
    builtFrom: "content/qa",
    entries,
    vectors: Buffer.from(flat.buffer).toString("base64"),
  };
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, JSON.stringify(corpus));
  return { rebuilt: true, entries: entries.length, contentHash, outFile };
}

// CLI entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const contentDir = path.resolve(flag("content", path.join(siteRoot, "content")));
  const outFile = path.resolve(flag("out", path.join(siteRoot, "public", "corpus.json")));
  buildCorpus({ contentDir, outFile })
    .then((r) => {
      process.stderr.write(
        r.rebuilt
          ? `corpus minted: ${r.entries} entries → ${r.outFile} (${r.contentHash})\n`
          : `corpus unchanged (${r.contentHash}) — no-op\n`
      );
    })
    .catch((err) => {
      process.stderr.write(`${String(err.message ?? err)}\n`);
      process.exit(1);
    });
}
