/**
 * @letsfederate/fedvec — local, zero-server semantic search over federation
 * entities.
 *
 * Backed by a single RuVector `.rvf` file (SIMD HNSW, crash-safe, no sidecar
 * server, no hosted vector DB) with pluggable offline embeddings. Import
 * `FederationIndex`, hand it entities, and search.
 *
 * @example
 * ```ts
 * import { FederationIndex } from "@letsfederate/fedvec";
 *
 * const index = new FederationIndex({ rvfPath: "./federation.rvf" });
 * await index.reindexIfChanged(subordinates);
 * const hits = await index.search("who can issue trust marks?", 5);
 * ```
 */
export { FederationIndex } from "./federation-index.js";
export type { SearchHit, FederationIndexOptions } from "./federation-index.js";
export type { FederationEntity } from "./entity-text.js";
export { entityToText } from "./entity-text.js";
export type { Embedder } from "./embedder.js";
export { l2normalize } from "./embedder.js";
export { HashEmbedder } from "./hash-embedder.js";
export { FastEmbedder } from "./fast-embedder.js";
export type { FastEmbedderOptions } from "./fast-embedder.js";
