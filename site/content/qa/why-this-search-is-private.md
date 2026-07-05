---
question: How does this site's own Q&A search work, and is it private?
arc: deploy-oidf-with-ai
audience: [local-dev, enterprise, operator]
tags: [rvf, wasm, privacy, dogfood, semantic-search]
---
This search runs **entirely in your browser** — there is no backend and nothing you type is sent
anywhere. The site ships a small curated corpus of answers, each embedded into a vector at build time,
packaged as a static file. When the page loads it hands those vectors to a WebAssembly vector store
(RuVector's RVF-WASM, a ~46 KB module), embeds your question locally with the same method, and finds the
closest answers by similarity. Ask, and the matching runs on your machine.

That's deliberate, and it's dogfooding: fedmgr uses the same RVF format internally for semantic search
over federation entities, so the site demonstrates the tech it advocates. It's also the privacy posture
you'd expect from a trust project — the default tier leaks nothing. A separate, clearly opt-in
"guided assessment" tier can use a hosted AI model for richer, conversational answers; that one tells
you plainly when you're talking to a service, because consent and legibility are the whole point.
