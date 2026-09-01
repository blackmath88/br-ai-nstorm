# br-ai-nstorm milestones

This repository uses **main as the newest coherent runnable version**.

Older meaningful stages are preserved as milestone branches so the evolution of the idea remains inspectable and runnable without keeping stale development branches as the primary history mechanism.

## Milestone 0.1 — React canonical state

Branch: `milestone/react-canonical-v0.1`

What it proves:

- React + Vite + TypeScript application shell;
- canonical semantic State view;
- D3 relationship Map as a derived exploratory view;
- Timeline as a diachronic derived view;
- provenance-aware problem nodes;
- participant-facing `Since you were here`, `Your traces`, and `Think next` panels;
- clipboard JSON aperture for taking shared context into an external LLM and returning bounded contribution packages.

Architectural boundary at this point:

> State is canonical. Map and Timeline are projections. External AI interoperability is simulated through JSON clipboard handoff.

## Milestone 0.2 — MCP shared memory

Branch: `milestone/mcp-shared-memory-v0.2`

What it adds:

- deterministic append-only event history;
- attributed contributions: who said what, when;
- accepted relations separated from proposed relations;
- first-class conflict objects;
- deterministic curation proposals;
- optional minimal AI curator that may propose but not mutate canonical state;
- stdio MCP tools using the same application service as HTTP;
- tiny HTTP API seam for future React synchronization and authentication;
- local JSON persistence for the prototype;
- server seed data derived from the existing canonical React problem state.

Architectural boundary at this point:

> AI may interpret and propose structure. Deterministic domain logic and human review control canonical shared memory.

## Working convention

- `main` — latest coherent version to clone and work from.
- `prototype/*` or `feature/*` — active experiments that may be discarded or merged.
- `milestone/*` — preserved runnable historical versions.
- `docs/history/` — explanation of what changed, what became canonical, and what was deferred.

When a new experiment becomes the best coherent version:

1. preserve the previous `main` as a `milestone/*` branch if it represents a meaningful runnable stage;
2. document the conceptual/architectural shift here;
3. merge or fast-forward the accepted work into `main`;
4. start the next experiment from the new `main`.

This makes Git history mirror the product idea itself: keep the current state easy to use while preserving how the understanding evolved.
