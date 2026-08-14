# @letsfederate/site — letsfederate.org

The advocacy site for OpenID Federation as the trust backplane for MCP/AI — built so the
site itself **demonstrates** the thesis: a curated, provenance-signable answer corpus,
semantic Q&A that runs entirely in the visitor's browser (RuVector RVF-WASM, zero backend),
and a self-assessment scorecard whose captures teach us whether we're on the mark.

Architecture decision record: `docs/analysis/website-ai-infrastructure.html` (hybrid model —
this package is Tier 1, the static tier; the Dify+Langfuse guided tier is Phase 3).

## Layout

```
site/
  content/
    qa/*.md              one Q&A entry per file (front-matter + answer body) — the ONLY
                         source of truth for what the site answers
    scorecard.json       scorecard question bank (sections → questions → options)
  lib/                   dependency-free ES modules, shared verbatim by Node (build+tests)
                         and the browser (runtime)
    hash-embedder.mjs    deterministic lexical embedder (FNV-1a hashing trick, 384-dim)
    rvf-store.mjs        thin wrapper over @ruvector/rvf-wasm's C-ABI (v0.1.7)
    scorecard.mjs        pure scoring engine (bank + answers → sections/tier/guidance)
  tools/
    build-corpus.mjs     content/qa/*.md → public/corpus.json (embed + package, hash-gated)
  public/                the deployable static site (Cloudflare Pages target)
  test/                  node --test suites (run with the workspace suite)
```

## The corpus contract

`public/corpus.json` (built artifact, never hand-edited):

```jsonc
{
  "version": 1,
  "embedder": "hash-v1-384",        // MUST match the browser's query embedder id
  "dimensions": 384,
  "metric": "l2-normalized",        // vectors are unit-length; store metric is l2 (metric 0)
                                    // cosine similarity is recovered as 1 - distance/2
  "contentHash": "sha256:…",        // over (embedder id + dims + all documents) — build is
                                    // a no-op when unchanged (same gating as packages/fedvec)
  "entries": [ { "id": 0, "question": "…", "answer": "…", "arc": "…",
                 "audience": ["…"], "tags": ["…"], "source": "qa/foo.md" } ],
  "vectors": "<base64 little-endian Float32Array, entries.length × dimensions>"
}
```

Invariants (enforced by tests, `[TRUST:FAIL]` on violation):
- **No empty shells** — a corpus with zero entries fails the build.
- Query and corpus MUST use the same embedder id; the browser refuses a corpus whose
  `embedder` it doesn't implement (fail-closed, never silently wrong-space search).
- Vectors are L2-normalized and stored under the **l2** metric. RVF 0.2.x's `cosine`
  metric does not survive close/reopen; squared-L2 on unit vectors ranks identically
  (`d = 2 − 2·cos`), so cosine similarity is exactly `1 − d/2`.

## The RVF-WASM ABI (empirically verified 2026-07-05 against @ruvector/rvf-wasm 0.1.7)

The 0.1.7 npm package ships the raw C-ABI (not the README's `WasmRvfStore` class), so
`lib/rvf-store.mjs` wraps it. Layout was determined by probe with hand-computable vectors
and is pinned by `test/rvf-store.test.mjs`:

- `rvf_store_query(handle, query_ptr, k, metric, out_ptr)` returns the result count;
  `out_ptr` receives **packed 12-byte records: `[u64 id (LE)][f32 distance]`**.
- Metric enum: `0` = squared L2 (we use this), `1` = negative dot, `2` = cosine distance.
- All buffers are allocated in WASM linear memory via `rvf_alloc`/`rvf_free`; the wrapper
  owns that bookkeeping. The store is in-memory; the page ingests `corpus.json` on load
  (10²–10³ entries → milliseconds).

## The scorecard contract

`content/scorecard.json` — sections of multiple-choice questions; every option carries
`points` and optional `guidance`. `lib/scorecard.mjs` exposes:

- `validateBank(bank)` → `{ ok, reasons }` — fail-closed structural check (a malformed or
  tampered bank must never score).
- `score(bank, answers)` → `{ sections, total, max, pct, tier, unanswered, guidance }` —
  pure, deterministic; unknown question ids or option values throw.

Scoring runs **entirely client-side**. On completion the page offers to submit the
anonymous aggregate (answers only — no identity, no free text) to the capture endpoint;
locally the endpoint is a stub, in production a Cloudflare Worker writing to D1. Consent
is explicit; declining loses nothing.

## Build & test

```sh
npm test -w @letsfederate/site        # or the workspace-wide: npm test
node site/tools/build-corpus.mjs      # mints public/corpus.json (no-op if content unchanged)
```

The corpus build is designed for CI: local ONNX/hashing embeddings (zero API cost),
content-hash gated (zero cost when unchanged), and the emitted corpus is a signable
artifact — the same syft/cosign treatment fedmgr applies to its own releases applies to
the website's answers (see the mint-pipeline section of the AI-infrastructure paper).

## Independent cross-checks (per the project's testing mandate)

- The site's hash embedder is verified **vector-for-vector against
  `@letsfederate/fedvec`'s `HashEmbedder`** (two implementations, one contract) so a
  corpus minted by either produces the same search space.
- The RVF wrapper's rankings are verified against a **plain-JS brute-force cosine scan**
  of the same vectors — the WASM path and the naive path must agree exactly.
- The end-to-end test builds a corpus from fixture markdown, loads it the way the browser
  does, and asserts a natural-language query retrieves the intended entry.
