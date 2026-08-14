// rvf-store wrapper tests — pins the empirically-determined 0.1.7 C-ABI
// (12-byte [u64 id][f32 dist] records, metric 0 = squared L2) and cross-checks
// WASM rankings against an independent plain-JS brute-force scan.
import test from "node:test";
import assert from "node:assert/strict";
import init from "@ruvector/rvf-wasm";
import { createRvfStore, cosineScoreFromL2 } from "../lib/rvf-store.mjs";

const wasm = await init();

// Deterministic LCG so the brute-force cross-check is reproducible.
function lcgVector(dim, seed) {
  let x = BigInt(seed) * 0x9e3779b97f4a7c15n + 1n;
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    v[i] = Number((x >> 33n) & 0xffffffffn) / 2 ** 32 - 0.5;
  }
  return v;
}
function l2n(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}
function sqL2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

test("ABI pin: known vectors return exact ids and squared-L2 distances", () => {
  const store = createRvfStore(wasm, 4);
  store.ingest(
    [7, 9, 11],
    [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0.9, 0.1, 0, 0],
    ]
  );
  assert.equal(store.count(), 3);
  const hits = store.query([1, 0, 0, 0], 3);
  assert.deepEqual(hits.map((h) => h.id), [7, 11, 9]);
  assert.ok(Math.abs(hits[0].distance - 0) < 1e-6);
  assert.ok(Math.abs(hits[1].distance - 0.02) < 1e-6); // (1-0.9)² + (0-0.1)²
  assert.ok(Math.abs(hits[2].distance - 2) < 1e-6);
  store.close();
});

test("CROSS-CHECK: WASM top-k matches independent brute-force scan (200×32d)", () => {
  const dim = 32;
  const n = 200;
  const store = createRvfStore(wasm, dim);
  const vectors = [];
  for (let i = 0; i < n; i++) vectors.push(l2n(lcgVector(dim, i + 1)));
  store.ingest([...Array(n).keys()], vectors);

  for (const qseed of [901, 902, 903]) {
    const q = l2n(lcgVector(dim, qseed));
    const got = store.query(q, 10);
    const want = vectors
      .map((v, id) => ({ id, distance: sqL2(q, v) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);
    assert.deepEqual(got.map((h) => h.id), want.map((h) => h.id), `qseed ${qseed} ranking diverged`);
    for (let i = 0; i < 10; i++) {
      assert.ok(Math.abs(got[i].distance - want[i].distance) < 1e-5);
    }
  }
  store.close();
});

test("cosine similarity is recovered exactly as 1 - d/2 on unit vectors", () => {
  const a = l2n([3, 4, 0]);
  const b = l2n([4, 3, 1]);
  const cos = a.reduce((s, x, i) => s + x * b[i], 0);
  assert.ok(Math.abs(cosineScoreFromL2(sqL2(a, b)) - cos) < 1e-9);
});

test("empty store returns no hits", () => {
  const store = createRvfStore(wasm, 8);
  assert.deepEqual(store.query(new Array(8).fill(0.5), 5), []);
  store.close();
});

test("NEGATIVE: dimension mismatch fails closed", () => {
  const store = createRvfStore(wasm, 8);
  assert.throws(() => store.ingest([1], [[1, 2, 3]]), /TRUST:FAIL/);
  assert.throws(() => store.query([1, 2, 3], 5), /TRUST:FAIL/);
  store.close();
});

test("NEGATIVE: use-after-close throws rather than reading freed memory", () => {
  const store = createRvfStore(wasm, 4);
  store.close();
  assert.throws(() => store.query([1, 0, 0, 0], 1), /TRUST:FAIL/);
});
