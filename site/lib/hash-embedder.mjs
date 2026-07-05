/**
 * Deterministic lexical embedder — the browser-side twin of
 * packages/fedvec/src/hash-embedder.ts. The two implementations MUST produce
 * identical vectors (pinned by test/hash-embedder.test.mjs); a corpus minted by
 * either lives in the same search space.
 *
 * Hashing trick: each token and adjacent bigram is FNV-1a-hashed into a fixed-
 * width vector, counts get sublinear weighting (1 + ln c), then L2-normalize.
 * Zero dependencies, runs identically in Node and the browser.
 */

const DEFAULT_DIMS = 384;

/** FNV-1a 32-bit hash of a string → unsigned 32-bit int. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** L2-normalize in place and return. Zero vectors are left as-is. */
export function l2normalize(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

export function createHashEmbedder(dimensions = DEFAULT_DIMS) {
  function embed(text) {
    const counts = new Array(dimensions).fill(0);
    const tokens = tokenize(text);
    const bump = (term) => {
      counts[fnv1a(term) % dimensions] += 1;
    };
    for (let i = 0; i < tokens.length; i++) {
      bump(tokens[i]);
      if (i + 1 < tokens.length) bump(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return l2normalize(counts.map((c) => (c > 0 ? 1 + Math.log(c) : 0)));
  }
  return {
    id: `hash-v1-${dimensions}`,
    dimensions,
    embed,
    embedBatch: (texts) => texts.map(embed),
  };
}
