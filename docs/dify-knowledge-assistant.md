# A Dify chat flow that helps people install & operate fedmgr

The accrued knowledge in this repo — the guides, the ADRs, the operations FAQ,
the gotchas — is already a corpus. This describes how to surface it through a
**Dify** RAG chat flow so a newcomer can ask "how do I stand up the lab?" or
"why does enrollment reject my jwks_url?" and get a grounded, cited answer.

No DSL here — Dify's flow is built in its UI. This is the design: what to
ingest, how to chunk it, which model and settings, and the system prompt.

## 1. The knowledge base (what to ingest)

Point Dify's Knowledge ingestion at the **durable reference path only** — never
`docs/history/**` (process journals) or `docs/analysis/**` (dated snapshots),
which would pollute answers with superseded state.

| Include | Why |
|---|---|
| `README.md`, `docs/README.md` | Entry point + index |
| `docs/operations-faq.md` | **The highest-value source** — already in Q→A→prevention shape, ideal for retrieval |
| `docs/dev/gotchas.md`, `docs/dev/running.md` | The hard guards + the happy path |
| `docs/trust-guide.md`, `docs/walkthroughs/*.md` | The task walkthroughs |
| `docs/signing.md`, `docs/security-faq.md`, `docs/extending-trustmarks.md` | Deep topics |
| `docs/adr/*.md`, `docs/decisions.md` | The "why" behind choices — what users ask when confused |
| `services/waypoint/README.md`, `packages/*/README.md` | Per-component operation |

**Chunking:** these are markdown with meaningful `##` headings, so use Dify's
**"paragraph" mode split on headings**, ~500–800 tokens per chunk, ~50-token
overlap. The FAQ's Q/A pairs are already chunk-sized — keep each Q+A together
(don't split mid-answer). Enable Dify's **parent-child (hierarchical)
retrieval** if available: retrieve the specific Q, return its whole section for
context.

**Metadata:** tag each document with its `source_path` and a `topic`
(`install` / `tls` / `enrollment` / `deps` / `testing`). This lets the flow
optionally filter — an "install help" entry point can bias toward
`install`/`tls` topics.

**Refresh:** re-sync the knowledge base on each merge to `main` (a scheduled
Dify sync, or a webhook from CI). The corpus is the docs; stale docs = stale
bot, so the same "docs must be current" discipline applies.

## 2. Retrieval settings

- **Hybrid search** (vector + keyword/BM25) — install questions are full of
  exact tokens (`FEDMGR_ALLOW_ORIGINS`, `9443`, `NODE_EXTRA_CA_CERTS`) that
  pure semantic search fuzzes. Hybrid nails both the concept and the literal.
- **Rerank** on: enable Dify's reranker (e.g. a Cohere/BGE reranker node) —
  top-20 retrieved → reranked → top-4 to the model. Reranking matters here
  because several docs mention e.g. "enrollment" and only one answers a given
  question.
- **Top-K 3–4, score threshold ~0.5.** Grounded QA wants a few high-quality
  chunks, not ten mediocre ones.
- **Citations on.** Return `source_path` + heading so users can jump to the
  full doc — trust software should show its sources.

## 3. Model and settings

**Recommended: Claude Haiku 4.5** (`claude-haiku-4-5`) as the default answerer.
- **Why:** grounded doc-QA over retrieved chunks is an extraction-and-synthesis
  task, not open-ended reasoning — Haiku 4.5 is fast, cheap ($1/$5 per MTok),
  and **still supports `temperature`**, which matters (see below). 200K context
  is far more than a top-4-chunk prompt needs.
- **Temperature: 0** (or 0.1). Grounded QA must be deterministic and faithful
  to the sources — creativity is a bug here. This is the single most important
  setting. *(Note: the newer Claude 5 family — Sonnet 5, Opus 4.8, Fable 5 —
  rejects a non-default `temperature` with a 400; Dify's temperature slider
  would break against them. Haiku 4.5 is the right tier for this job on both
  cost and the ability to pin temperature.)*
- **Max tokens: ~1024.** Install answers are short; cap runaway output.

**Step-up option: Claude Sonnet 5** (`claude-sonnet-5`, 1M context) for a
"deep help" path that reasons across many docs (e.g. "walk me through
laptop→VM→k8s and what changes at each"). Leave temperature at its default
(don't set the slider) since Sonnet 5 rejects non-default sampling. Reserve it
for the hard questions — it's ~3× Haiku's price.

Model IDs, verified current (2026): `claude-haiku-4-5` (200K ctx, $1/$5),
`claude-sonnet-5` (1M ctx, $3/$15), `claude-opus-4-8` (1M ctx, $5/$25). Use the
bare IDs — no date suffixes.

## 4. The system prompt (grounding contract)

Paste into Dify's chat-flow LLM node. It enforces faithfulness, citation, and
honest "I don't know":

```
You are the fedmgr install & operations assistant. fedmgr is an OpenID
Federation trust backplane for MCP: it lets an AI assistant cryptographically
verify which MCP tool servers to trust. Your job is to help users install,
run, and operate it — the local lab, enrollment, TLS, waypoint, and the SSC
security scans.

GROUNDING RULES — follow exactly:
- Answer ONLY from the retrieved context below. If the context does not
  contain the answer, say "I don't find that in the fedmgr docs" and point to
  the closest relevant doc. Never invent commands, flags, ports, or paths.
- Quote exact commands, env var names, and file paths verbatim from the
  context — these are load-bearing (e.g. FEDMGR_ALLOW_ORIGINS, port 9443,
  ./deploy/lab/up.sh). Do not paraphrase a command.
- When a question is "why" (why https, why an allowlist instead of a dev
  flag), draw the reasoning from the ADRs and decision docs in context — the
  design rationale matters as much as the steps.
- Cite the source_path of every doc you used, at the end, as "Sources: ...".
- Prefer the operations FAQ for symptom→cause→fix questions; it is written for
  exactly that.
- Be concise. Lead with the command or the direct answer, then the one or two
  sentences of context the user needs. This is a terminal-adjacent audience.

SAFETY: never output secrets, private keys, or a user's specific tokens. If
asked to disable a security guard (e.g. "how do I turn off TLS checks"),
explain the scoped, safe mechanism (FEDMGR_ALLOW_ORIGINS exact-origin
exceptions) rather than the global override, and note the tradeoff.

Retrieved context:
{{#context#}}
```

## 5. Flow shape (Dify Chatflow nodes)

A minimal, effective graph — describe it, build it in the UI:

1. **Start** → user question.
2. **Knowledge Retrieval** node → the KB above, hybrid + rerank, top-4.
3. **(optional) Question Classifier** → route "deep/architecture" questions to
   a Sonnet 5 LLM node, everything else to the Haiku 4.5 node. Saves cost.
4. **LLM** node → the system prompt above, `{{#context#}}` bound to the
   retrieval output, temperature 0 (Haiku path).
5. **Answer** → stream to the user, with the citations the prompt produced.

Add a **conversation opener** listing what it can help with ("stand up the
lab", "enroll an MCP", "fix a TLS/enrollment error", "run the SSC scan") so
users know the surface.

## 6. Evaluation (keep it honest)

Seed Dify's evaluation with ~15 real questions drawn from the operations FAQ
(they're already Q/A pairs — the answer is the ground truth). Check for:
- **Faithfulness** — no invented flags/ports (the failure mode that matters
  most for a trust tool's install helper).
- **Citation presence** — every answer names its `source_path`.
- **Honest refusal** — an out-of-scope question ("what's the weather") gets
  "not in the fedmgr docs", not a hallucination.

Re-run the eval whenever the corpus or the model changes — same discipline as
the code test suite: green must mean grounded, not just fluent.

---

**One-line summary for the impatient:** ingest the durable `docs/` (especially
`operations-faq.md`), hybrid-search + rerank to top-4, answer with
**Claude Haiku 4.5 at temperature 0** under a strict grounding prompt that
quotes commands verbatim and cites sources; escalate the hard architecture
questions to **Sonnet 5**.
