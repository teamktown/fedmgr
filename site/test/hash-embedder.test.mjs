// hash-embedder tests — determinism, unit norm, lexical behaviour, and the
// independent cross-check: vector-for-vector parity with @letsfederate/fedvec's
// HashEmbedder (two implementations of one contract; a corpus minted by either
// must land in the same search space).
import test from "node:test";
import assert from "node:assert/strict";
import { createHashEmbedder } from "../lib/hash-embedder.mjs";

// fedvec is a built workspace package; if its dist is absent we skip HONESTLY
// (with the command to fix it) rather than fake a pass.
let FedvecHashEmbedder = null;
try {
  ({ HashEmbedder: FedvecHashEmbedder } = await import("@letsfederate/fedvec"));
} catch {
  /* handled by skip below */
}

const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

test("deterministic: same text → identical vector", () => {
  const e = createHashEmbedder(384);
  const a = e.embed("issue trust marks for MCP servers");
  const b = e.embed("issue trust marks for MCP servers");
  assert.deepEqual(a, b);
});

test("vectors are L2-normalized (unit length)", () => {
  const e = createHashEmbedder(384);
  const v = e.embed("openid federation trust anchor");
  assert.ok(Math.abs(norm(v) - 1) < 1e-9, `norm was ${norm(v)}`);
});

test("empty text yields the zero vector, not NaN", () => {
  const e = createHashEmbedder(384);
  const v = e.embed("");
  assert.ok(v.every((x) => x === 0));
});

test("lexical overlap raises similarity: shared tokens beat disjoint", () => {
  const e = createHashEmbedder(384);
  const q = e.embed("who can issue trust marks?");
  const near = e.embed("the trust mark issuer signs trust marks");
  const far = e.embed("grapefruit marmalade bicycle weather");
  assert.ok(
    cosine(q, near) > cosine(q, far),
    `expected shared-token cosine ${cosine(q, near)} > disjoint ${cosine(q, far)}`
  );
});

test("dimensions are respected and stamped in the id", () => {
  const e = createHashEmbedder(128);
  assert.equal(e.dimensions, 128);
  assert.equal(e.id, "hash-v1-128");
  assert.equal(e.embed("x").length, 128);
});

test(
  "CROSS-CHECK: exact vector parity with @letsfederate/fedvec HashEmbedder",
  { skip: FedvecHashEmbedder ? false : "fedvec dist not built — run: npm run build -w @letsfederate/fedvec" },
  async () => {
    const site = createHashEmbedder(384);
    const fedvec = new FedvecHashEmbedder(384);
    const samples = [
      "who can issue trust marks?",
      "OpenID Federation entity statement with authority_hints",
      "supply chain SBOM cosign trivy gate",
      "a", // single token, no bigrams
      "Repeated repeated repeated words words", // sublinear weighting path
      "punctuation, splits/tokens—right? 123 abc123",
    ];
    for (const text of samples) {
      const ours = site.embed(text);
      const theirs = await fedvec.embedQuery(text);
      assert.equal(ours.length, theirs.length);
      for (let i = 0; i < ours.length; i++) {
        assert.ok(
          Math.abs(ours[i] - theirs[i]) < 1e-12,
          `component ${i} diverged for "${text}": ${ours[i]} vs ${theirs[i]}`
        );
      }
    }
  }
);
