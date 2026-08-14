/**
 * HashEmbedder — deterministic, offline, zero-download term embedder.
 *
 * Uses the hashing trick: each token (and adjacent bigram) is hashed into a
 * fixed-width vector via FNV-1a, accumulated with sublinear term weighting, and
 * L2-normalized. No model files, no network, no native addon — it works the
 * instant the package installs, which suits an air-gapped trust lab.
 *
 * It captures lexical overlap, not deep semantics: a query mentioning
 * "issue trust marks" ranks an entity described as a "trust mark issuer"
 * highly. For true paraphrase-level semantics, swap in FastEmbedder (MiniLM).
 */
import { Embedder, l2normalize } from "./embedder.js";

const DEFAULT_DIMS = 384;

/** FNV-1a 32-bit hash of a string → unsigned 32-bit int. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit range
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Lowercase, split on non-alphanumerics, drop empties. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

export class HashEmbedder implements Embedder {
  readonly dimensions: number;
  readonly id: string;

  constructor(dimensions: number = DEFAULT_DIMS) {
    this.dimensions = dimensions;
    this.id = `hash-v1-${dimensions}`;
  }

  private embedOne(text: string): number[] {
    // Unsigned term counts: an all-positive vector keeps cosine similarity in
    // [0, 1], so sharing a token can only ever raise the score between two
    // documents. (A signed hashing trick reduces collisions on large corpora
    // but destructively cancels on the short docs we index here.)
    const counts = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);

    const bump = (term: string) => {
      const idx = fnv1a(term) % this.dimensions;
      counts[idx] += 1;
    };

    for (let i = 0; i < tokens.length; i++) {
      bump(tokens[i]);
      if (i + 1 < tokens.length) bump(`${tokens[i]}_${tokens[i + 1]}`);
    }

    // Sublinear term weighting damps the effect of a single repeated word.
    const vec = counts.map((c) => (c > 0 ? 1 + Math.log(c) : 0));
    return l2normalize(vec);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }
}
