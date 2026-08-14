// Corpus build pipeline tests — structure, hash-gating, no-empty-shells, and
// the end-to-end proof: fixture markdown → corpus.json → loaded the way the
// browser loads it (base64 → Float32Array → RVF-WASM) → a natural-language
// query retrieves the intended entry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import init from "@ruvector/rvf-wasm";
import { buildCorpus } from "../tools/build-corpus.mjs";
import { createHashEmbedder } from "../lib/hash-embedder.mjs";
import { createRvfStore, cosineScoreFromL2 } from "../lib/rvf-store.mjs";

const wasm = await init();

const FIXTURES = {
  "what-is-oidf.md": `---
question: What is OpenID Federation?
arc: deploy-oidf-with-ai
audience: [local-dev, enterprise]
tags: [oidf, basics]
---
OpenID Federation lets entities publish signed statements so trust chains can be
resolved and verified instead of assumed. A trust anchor sits at the root.
`,
  "trust-marks.md": `---
question: Who can issue trust marks?
arc: bring-your-own-trust
audience: [enterprise]
tags: [trustmark, tmi]
---
A trust mark issuer (TMI) accredited by the trust anchor issues trust marks;
verifiers check the mark's signature against the federation's keys.
`,
  "sbom-signing.md": `---
question: How does supply chain integrity work here?
arc: supply-chain-integrity
audience: [enterprise, operator]
tags: [sbom, cosign, ssc]
---
Every artifact gets an SBOM, a cosign signature, and a vulnerability scan gate;
a trustmark is only issued when the gate passes with zero HIGH or CRITICAL findings.
`,
};

async function makeContentDir(files = FIXTURES) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "site-corpus-"));
  await fsp.mkdir(path.join(dir, "qa"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, "qa", name), body);
  }
  return dir;
}

test("builds a structurally valid corpus from markdown", async () => {
  const dir = await makeContentDir();
  const out = path.join(dir, "corpus.json");
  const res = await buildCorpus({ contentDir: dir, outFile: out });
  assert.equal(res.rebuilt, true);
  assert.equal(res.entries, 3);

  const corpus = JSON.parse(await fsp.readFile(out, "utf8"));
  assert.equal(corpus.version, 1);
  assert.equal(corpus.embedder, "hash-v1-384");
  assert.equal(corpus.dimensions, 384);
  assert.match(corpus.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(corpus.entries.length, 3);
  // entries carry ordinal ids matching vector order, sorted by filename
  assert.deepEqual(corpus.entries.map((e) => e.id), [0, 1, 2]);
  assert.equal(corpus.entries[0].source, "qa/sbom-signing.md"); // alphabetical
  assert.ok(corpus.entries.every((e) => e.question && e.answer && e.arc));
  // vectors decode to entries × dimensions floats
  // (Buffer.from() returns a view into Node's shared pool — slice by offset/length)
  const buf = Buffer.from(corpus.vectors, "base64");
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  assert.equal(f32.length, 3 * 384);
});

test("hash-gated: unchanged content is a no-op, changed content rebuilds", async () => {
  const dir = await makeContentDir();
  const out = path.join(dir, "corpus.json");
  const first = await buildCorpus({ contentDir: dir, outFile: out });
  assert.equal(first.rebuilt, true);
  const mtime1 = fs.statSync(out).mtimeMs;

  const second = await buildCorpus({ contentDir: dir, outFile: out });
  assert.equal(second.rebuilt, false);
  assert.equal(fs.statSync(out).mtimeMs, mtime1, "no-op build must not rewrite the file");

  await fsp.appendFile(path.join(dir, "qa", "trust-marks.md"), "\nDelegation is supported.\n");
  const third = await buildCorpus({ contentDir: dir, outFile: out });
  assert.equal(third.rebuilt, true);
  assert.notEqual(third.contentHash, first.contentHash);
});

test("NEGATIVE: zero entries fails — no empty-shell corpus", async () => {
  const dir = await makeContentDir({});
  await assert.rejects(
    buildCorpus({ contentDir: dir, outFile: path.join(dir, "corpus.json") }),
    /TRUST:FAIL/
  );
});

test("NEGATIVE: entry missing required front-matter fails with the file named", async () => {
  const dir = await makeContentDir({
    "bad.md": `---
arc: deploy-oidf-with-ai
---
An answer with no question.
`,
  });
  await assert.rejects(
    buildCorpus({ contentDir: dir, outFile: path.join(dir, "corpus.json") }),
    /bad\.md.*question|question.*bad\.md/
  );
});

test("browser atob decode of corpus vectors is byte-identical to the Node Buffer path", async () => {
  // qa.mjs (browser) decodes base64 via atob+charCodeAt; the build/tests use
  // Buffer. Pin that they agree exactly, or the browser searches a corrupted
  // vector space while Node tests stay green.
  const dir = await makeContentDir();
  const out = path.join(dir, "corpus.json");
  await buildCorpus({ contentDir: dir, outFile: out });
  const corpus = JSON.parse(await fsp.readFile(out, "utf8"));

  const nb = Buffer.from(corpus.vectors, "base64");
  const nodeF32 = new Float32Array(nb.buffer, nb.byteOffset, nb.length / 4);

  const bin = atob(corpus.vectors);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const browserF32 = new Float32Array(bytes.buffer);

  assert.equal(browserF32.length, nodeF32.length);
  for (let i = 0; i < nodeF32.length; i++) assert.equal(browserF32[i], nodeF32[i]);
});

test("END-TO-END: browser-style load answers a natural-language question", async () => {
  const dir = await makeContentDir();
  const out = path.join(dir, "corpus.json");
  await buildCorpus({ contentDir: dir, outFile: out });
  const corpus = JSON.parse(await fsp.readFile(out, "utf8"));

  // Exactly what the page does: refuse unknown embedders, decode, ingest, query.
  const embedder = createHashEmbedder(corpus.dimensions);
  assert.equal(embedder.id, corpus.embedder, "browser must refuse a corpus from another embedder");
  const vbuf = Buffer.from(corpus.vectors, "base64");
  const flat = new Float32Array(vbuf.buffer, vbuf.byteOffset, vbuf.length / 4);
  const store = createRvfStore(wasm, corpus.dimensions);
  store.ingest(
    corpus.entries.map((e) => e.id),
    corpus.entries.map((e) => flat.subarray(e.id * corpus.dimensions, (e.id + 1) * corpus.dimensions))
  );

  // The hash embedder is lexical (no stemming) — this test proves the PIPELINE
  // (build → decode → ingest → query → right entry), so the query shares
  // vocabulary with the target the way a curated FAQ's visitors do.
  const hits = store.query(embedder.embed("trust mark issuer accredited by the trust anchor"), 3);
  const top = corpus.entries.find((e) => e.id === hits[0].id);
  assert.equal(top.source, "qa/trust-marks.md");
  assert.ok(cosineScoreFromL2(hits[0].distance) > cosineScoreFromL2(hits[1].distance));
  store.close();
});
