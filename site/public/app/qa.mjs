/**
 * Browser Q&A controller — loads the corpus, ingests it into the RVF-WASM store,
 * and answers questions entirely client-side. Shares lib/rvf-store.mjs and
 * lib/hash-embedder.mjs verbatim with the Node build+tests (copied to
 * public/app/lib at deploy; here we import from ../lib via the vendored copy).
 *
 * Nothing typed here leaves the browser.
 */
import init from "../vendor/rvf_wasm.mjs";
import { createHashEmbedder } from "../lib/hash-embedder.mjs";
import { createRvfStore, cosineScoreFromL2 } from "../lib/rvf-store.mjs";

let state = null;

/** Load corpus + WASM once; refuse a corpus built by a different embedder. */
export async function ready() {
  if (state) return state;
  const [wasm, corpus] = await Promise.all([
    init(),
    fetch("../corpus.json").then((r) => {
      if (!r.ok) throw new Error(`corpus.json ${r.status}`);
      return r.json();
    }),
  ]);
  const embedder = createHashEmbedder(corpus.dimensions);
  if (embedder.id !== corpus.embedder) {
    // Fail closed: querying a corpus with a different embedder searches the
    // wrong space and returns confidently-wrong answers.
    throw new Error(
      `[TRUST:FAIL] embedder mismatch: page has ${embedder.id}, corpus was built with ${corpus.embedder}`
    );
  }
  const bin = atob(corpus.vectors);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const flat = new Float32Array(bytes.buffer);

  const store = createRvfStore(wasm, corpus.dimensions);
  store.ingest(
    corpus.entries.map((e) => e.id),
    corpus.entries.map((e) => flat.subarray(e.id * corpus.dimensions, (e.id + 1) * corpus.dimensions))
  );
  state = { corpus, embedder, store };
  return state;
}

/** Answer a question → ranked hits with entry + similarity. */
export async function ask(question, k = 4) {
  const { corpus, embedder, store } = await ready();
  const hits = store.query(embedder.embed(question), k);
  return hits.map((h) => ({
    entry: corpus.entries.find((e) => e.id === h.id),
    score: cosineScoreFromL2(h.distance),
  }));
}

export async function corpusMeta() {
  const { corpus } = await ready();
  return {
    count: corpus.entries.length,
    embedder: corpus.embedder,
    contentHash: corpus.contentHash,
    arcs: [...new Set(corpus.entries.map((e) => e.arc))],
  };
}
