# fedvec — semantic search over federation entities

Local, zero-server semantic discovery for the federation, backed by a single
RuVector `.rvf` file (SIMD HNSW). This document records what shipped and the
deployment/hardening work left to pursue.

## What shipped (this increment)

- **`@letsfederate/fedvec`** (`packages/fedvec/`) — reusable library:
  - `FederationIndex` — wraps `@ruvector/rvf` (`RvfDatabase`) plus a JSON
    sidecar mapping vector ids → entities; content-hash-gated atomic reindex.
  - `Embedder` interface with two offline implementations:
    - `HashEmbedder` (default) — pure-JS, zero-download, deterministic, lexical.
    - `FastEmbedder` — local ONNX `all-MiniLM-L6-v2` (384-dim) via `fastembed`.
  - `entityToText` — deterministic flattening of an entity's id + OIDF metadata.
- **`GET /federation_search?q=&k=`** on the Trust Anchor
  (`packages/ta-server/src/federation/federation-search.ts`) — indexes active
  subordinates from the `FederationStore` and ranks them. Env:
  `TA_VEC_PATH` (index location), `TA_VEC_EMBEDDER=hash|minilm`.
- **`search_federation`** MCP tool (`packages/fedmgr-mcp`).
- **`fedmgr search "<query>"`** CLI command (`packages/fedmgr-cli`).
- Tests: `packages/fedvec` unit suite (real RVF round-trip) +
  `packages/ta-server/test/federation-search.test.mjs` (real HTTP + store + rvf).

### Design principle

The `.rvf` index is **derived data / a cache**. The source of truth is the
`FederationStore` (SQLite today). The index is rebuilt from
`store.listSubordinates()`, so any node can regenerate it. This is the property
that makes the distributed-deployment work below straightforward.

## RVF constraints discovered (inform the work below)

Verified against the installed `@ruvector/rvf` 0.2.x on Node 18:

- **Native binaries are glibc-only** (`linux-x64-gnu`, `linux-arm64-gnu`, macOS,
  win) — **no musl**. Containers must use a glibc base image (debian-slim), not
  Alpine, for the native `@ruvector/rvf-node` backend.
- **`cosine` metric is not restored after close + reopen** — a reopened store
  computes squared-L2. fedvec stores `l2` + L2-normalized vectors (identical
  ranking; cosine recovered as `1 - d/2`).
- **WASM backend is in-memory**; `open(path)` is ignored, but the low-level
  microkernel exposes `rvf_store_open(bytes)` / `rvf_store_export(bytes)`, so an
  index built elsewhere can be shipped as bytes and loaded into an isolate.
- `query()` returns only `{ id, distance }` (id is a string-encoded u64) — keep
  the id→entity sidecar. A store writes companion files (`<name>.rvf` +
  `<name>.rvf.idmap.json`); move/rename all companions together or the store
  corrupts.

## Future work

### 1. Production store: SQLite → PostgreSQL (prerequisite for multi-replica)

`FederationStore` already anticipates this ("PostgreSQL adapter — future
Increment G"). Multi-replica k8s needs the source of truth to be a shared DB so
every pod derives the same index.

### 2. Kubernetes

- **Recommended — per-replica local index, shared Postgres.** Each pod builds
  its own `.rvf` in an `emptyDir` from the shared DB (on startup / on change /
  on first search). No shared volume, no RVF single-writer contention, scales
  horizontally for free. Bake the MiniLM model into the image (or an init
  container) if using `minilm`. glibc base image required.
- **Alternative — centralized search pod.** One StatefulSet + PVC owns the
  canonical `.rvf` and the model; other pods call its `/federation_search`.
  Use when the corpus is large or a single build is preferred.

### 3. Cloudflare

- **Workers (V8 isolates):** no native addons, no persistent local FS.
  - Use the **WASM RVF backend**: build the `.rvf` offline (CI / container),
    store its bytes in **R2** (or KV), and in the Worker load via
    `rvf_store_open(bytes)` → query in-memory; cache the store across requests
    in the isolate.
  - Embeddings: `HashEmbedder` (pure JS) runs as-is; for MiniLM-quality use a
    **`WorkersAiEmbedder`** (Workers AI embedding model) — drops into the
    existing `Embedder` interface — or precompute query embeddings.
  - (Cloudflare **Vectorize** exists but abandons the self-contained,
    no-external-service property that motivates RVF here.)
- **Cloudflare Containers / Fly.io / ECS:** real container → same as k8s
  single-node; native backend works.

### 4. Code seams to build

1. `PostgresFederationStore implements FederationStore`.
2. Backend selection: pass `'wasm'` + a bytes-source loader for edge (SDK
   `resolveBackend` already falls back node→wasm; needs a bytes-open path).
3. `WorkersAiEmbedder implements Embedder` for the Cloudflare Workers path.
4. Optional: expose a "rebuild index from store on demand / on a schedule"
   endpoint or hook for the per-replica k8s pattern.

## Deployment quick-reference

| Target | RVF backend | Index location | Embedder |
|---|---|---|---|
| Single VM / container | native (glibc) | local disk / volume | Hash or MiniLM |
| k8s (recommended) | native (glibc) | per-pod emptyDir, rebuilt from Postgres | MiniLM baked into image |
| k8s (centralized) | native | one PVC on a search pod | MiniLM |
| Cloudflare Workers | WASM | `.rvf` bytes in R2/KV → in-memory | Hash (JS) or Workers AI |
| Cloudflare Containers / Fly | native (glibc) | local / volume | MiniLM |
