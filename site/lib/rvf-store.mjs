/**
 * Thin wrapper over @ruvector/rvf-wasm 0.1.7's C-ABI in-memory store.
 *
 * The 0.1.7 npm package ships raw exports (rvf_store_create / rvf_store_ingest /
 * rvf_store_query + rvf_alloc into WASM linear memory), not the README's
 * WasmRvfStore class — this module owns the pointer bookkeeping so pages and
 * tests share one audited code path.
 *
 * ABI facts (empirically verified, pinned by test/rvf-store.test.mjs):
 *   - rvf_store_query(handle, q_ptr, k, metric, out_ptr) → result count;
 *     out buffer holds packed 12-byte records: [u64 id LE][f32 distance].
 *   - metric: 0 = squared L2 (used here), 1 = negative dot, 2 = cosine distance.
 *
 * Convention: callers ingest L2-NORMALIZED vectors under metric 0. On unit
 * vectors squared-L2 ranks identically to cosine (d = 2 − 2·cos), and the
 * cosine metric itself doesn't survive RVF close/reopen — same rationale as
 * packages/fedvec. Recover similarity with cosineScoreFromL2().
 *
 * The caller initializes the WASM module (import init from '@ruvector/rvf-wasm'
 * in Node, or the vendored pkg/rvf_wasm.mjs in the browser) and passes the
 * exports in — this module stays environment-agnostic and dependency-free.
 */

const METRIC_L2 = 0;
const RECORD_BYTES = 12; // [u64 id][f32 distance], packed

/** Cosine similarity from a squared-L2 distance between unit vectors. */
export function cosineScoreFromL2(distance) {
  return 1 - distance / 2;
}

export function createRvfStore(wasm, dimensions, { metric = METRIC_L2 } = {}) {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[TRUST:FAIL] rvf-store: invalid dimensions ${dimensions}`);
  }
  let handle = wasm.rvf_store_create(dimensions, metric);
  if (!handle || handle < 0) {
    throw new Error(`[TRUST:FAIL] rvf-store: rvf_store_create failed (${handle})`);
  }

  const assertOpen = () => {
    if (handle === null) throw new Error("[TRUST:FAIL] rvf-store: store is closed");
  };

  /** Allocate, run fn(ptr), always free. Views are created inside fn because
   *  memory.buffer can detach if the WASM heap grows on a later alloc. */
  const withAlloc = (bytes, fn) => {
    const ptr = wasm.rvf_alloc(bytes);
    if (!ptr) throw new Error("[TRUST:FAIL] rvf-store: wasm alloc failed");
    try {
      return fn(ptr);
    } finally {
      wasm.rvf_free(ptr, bytes);
    }
  };

  return {
    dimensions,

    /**
     * Ingest vectors. `ids`: number[]; `vectors`: array of (Float32Array|number[]),
     * each exactly `dimensions` long and expected L2-normalized.
     */
    ingest(ids, vectors) {
      assertOpen();
      if (ids.length !== vectors.length) {
        throw new Error("[TRUST:FAIL] rvf-store: ids/vectors length mismatch");
      }
      for (const v of vectors) {
        if (v.length !== dimensions) {
          throw new Error(
            `[TRUST:FAIL] rvf-store: vector has ${v.length} dims, store expects ${dimensions}`
          );
        }
      }
      const n = ids.length;
      if (n === 0) return 0;
      const vecBytes = n * dimensions * 4;
      const idBytes = n * 8;
      return withAlloc(vecBytes, (vptr) =>
        withAlloc(idBytes, (iptr) => {
          const f32 = new Float32Array(wasm.memory.buffer, vptr, n * dimensions);
          vectors.forEach((v, i) => f32.set(v, i * dimensions));
          const dv = new DataView(wasm.memory.buffer);
          ids.forEach((id, i) => dv.setBigUint64(iptr + i * 8, BigInt(id), true));
          const accepted = wasm.rvf_store_ingest(handle, vptr, iptr, n);
          if (accepted !== n) {
            throw new Error(`[TRUST:FAIL] rvf-store: ingest accepted ${accepted}/${n}`);
          }
          return accepted;
        })
      );
    },

    /** Top-k query → [{ id, distance }] ordered nearest-first. */
    query(vector, k) {
      assertOpen();
      if (vector.length !== dimensions) {
        throw new Error(
          `[TRUST:FAIL] rvf-store: query has ${vector.length} dims, store expects ${dimensions}`
        );
      }
      const kk = Math.max(1, Math.min(k, this.count() || 0));
      if (this.count() === 0) return [];
      return withAlloc(dimensions * 4, (qptr) =>
        withAlloc(kk * RECORD_BYTES, (optr) => {
          new Float32Array(wasm.memory.buffer, qptr, dimensions).set(vector);
          const n = wasm.rvf_store_query(handle, qptr, kk, metric, optr);
          if (n < 0) throw new Error(`[TRUST:FAIL] rvf-store: query failed (${n})`);
          const dv = new DataView(wasm.memory.buffer);
          const hits = [];
          for (let i = 0; i < n; i++) {
            hits.push({
              id: Number(dv.getBigUint64(optr + i * RECORD_BYTES, true)),
              distance: dv.getFloat32(optr + i * RECORD_BYTES + 8, true),
            });
          }
          return hits;
        })
      );
    },

    count() {
      assertOpen();
      return wasm.rvf_store_count(handle);
    },

    close() {
      if (handle !== null) {
        wasm.rvf_store_close(handle);
        handle = null;
      }
    },
  };
}
