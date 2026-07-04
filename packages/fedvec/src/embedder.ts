/**
 * Embedder — turns text into a dense vector for similarity search.
 *
 * fedvec is embedder-agnostic on purpose. Two implementations ship:
 *
 *   HashEmbedder  — zero-download, offline, deterministic (the default).
 *                   A hashing-trick term embedder: no model, no network, works
 *                   in an air-gapped trust lab the moment you `npm i`. Crude but
 *                   real lexical semantic search.
 *   FastEmbedder  — local ONNX MiniLM (all-MiniLM-L6-v2, 384-dim) via fastembed.
 *                   Higher-quality true semantic search, still fully offline
 *                   after the one-time model fetch. No OpenAI/Cohere API.
 *
 * Both produce L2-normalized vectors so a `cosine` RVF store ranks by
 * cosine similarity.
 */
export interface Embedder {
  /** Vector dimensionality this embedder produces. */
  readonly dimensions: number;

  /** A short, stable id (used to detect embedder changes across reindexes). */
  readonly id: string;

  /** Embed a batch of documents. Returns one vector per input. */
  embedDocuments(texts: string[]): Promise<number[][]>;

  /** Embed a single query string. */
  embedQuery(text: string): Promise<number[]>;
}

/** L2-normalize a vector in place and return it. Zero vectors are left as-is. */
export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}
