# @letsfederate/fedvec

Local, zero-server **semantic search over federation entities**.

Backed by a single [RuVector](https://www.npmjs.com/package/@ruvector/rvf) `.rvf`
file — a SIMD **HNSW** index in one crash-safe, on-disk container. No hosted
vector DB, no sidecar service, no embedding API. It sits next to your existing
store the way SQLite does.

## Why this shape

A federation of MCP servers / OIDF entities is discovered today by exact ids and
entity statements. `fedvec` adds **natural-language discovery** — "who can issue
trust marks?", "an MCP server for weather" — ranking registered entities by how
well their id + metadata match, entirely offline.

- **RuVector `.rvf`** — single file, HNSW ANN, crash-safe append-only, no server.
- **Offline embeddings** — no OpenAI/Cohere/Voyage. Two embedders ship:
  - `HashEmbedder` (default): zero-download, deterministic, lexical. Works the
    instant you `npm i`, ideal for an air-gapped trust lab.
  - `FastEmbedder`: local ONNX `all-MiniLM-L6-v2` (384-dim) via `fastembed` —
    true paraphrase-level semantics; fetches the model once, then fully offline.

## Usage

```ts
import { FederationIndex } from "@letsfederate/fedvec";

const index = new FederationIndex({ rvfPath: "./federation.rvf" });

// Rebuild only when the entity set or embedder changed (cheap to call often).
await index.reindexIfChanged([
  { entityId: "https://tmi.example.com", status: "active",
    metadata: { federation_entity: { display_name: "Trust Mark Issuer",
      description: "Issues and signs trust marks." } } },
]);

const hits = await index.search("who can issue trust marks?", 5);
// → [{ entityId, status, score, distance }, ...]  (score = cosine similarity)
```

Switch to MiniLM embeddings:

```ts
import { FederationIndex, FastEmbedder } from "@letsfederate/fedvec";
const index = new FederationIndex({ rvfPath: "./federation.rvf", embedder: new FastEmbedder() });
```

## On-disk layout

Reindex writes `<name>.rvf` (+ RVF's own `<name>.rvf.idmap.json`) and a small
`<name>.rvf.map.json` sidecar mapping vector ids back to entities. All are
rebuilt atomically via a temp directory.

## Notes

Vectors are L2-normalized and stored under the `l2` metric; on unit vectors
squared-Euclidean ranks identically to cosine, and cosine similarity is recovered
as `1 - distance/2`. (This also sidesteps RVF's `cosine` metric not surviving a
store close/reopen at the time of writing.)
