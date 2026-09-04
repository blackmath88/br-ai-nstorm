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

## Milestone 0.3 — Real Shared Room (candidate)

Branch: `feature/real-shared-room-v0.3` — **not yet preserved as a milestone branch.**

The goal was narrow on purpose: make ONE existing problem work end to end
through the real backend, with several participants on two transports, and add
no new conceptual layers.

### What changed

- **React lost its canonical state.** Everything on screen is read from the
  backend and every contribution and review is written through it. There is no
  local fallback to seed data, because silently-local state is exactly the
  illusion this milestone existed to remove.
- **Events became the only writable truth.** v0.2 stored records *and* events as
  two parallel truths written by separate code paths; they could drift. Canonical
  state is now a pure fold over the log.
- **Identity moved server-side.** The `x-brainstorm-actor` header — where the
  caller asserted its own identity — was removed, not deprecated. Identity now
  travels as a bearer token that only the server can resolve.
- **MCP was rebuilt before any feature was added.** v0.2 registered tools on a
  module-scope server and read its participant from an environment variable at
  import time, so one process served exactly one person. It is now a
  transport-independent server factory, and four participants share one room.
- **Conflicts became visible.** Accepted, unresolved conflicts render at the top
  of the canonical view.
- **The curation queue became reviewable**, with the curator named on every
  proposal and the review boundary stated on screen.
- **Provenance became a qualified attribution** rather than one author string.
- **A multi-user data-loss bug was fixed.** v0.2's read-modify-write JSON store
  kept 1 of 50 concurrent appends — measured, not assumed. It now keeps all 50.

### What became canonical

- the event log, and the projection over it;
- server-resolved participant identity;
- accepted relations and accepted conflicts, each carrying the human who
  accepted them and the curator that proposed them;
- the full provenance envelope, including the AI-prepared / human-authored
  distinction;
- supersession as a status change that never erases history.

### What is still fake

- **the session issuer, and only the issuer.** `server/auth/prototype-auth.ts`
  mints opaque in-memory tokens for four named participants with no password and
  no authorization server. Everything around it — bearer transport, server-side
  resolution, `ActorContext` threading, 401 challenges — is the real shape.
- **the store.** A local append-only JSON file. Single process, disposable by
  design.
- **liveness.** React refreshes after a mutation and on demand; there is no push.
- **the AI curator's judgement.** Off by default and best-effort when on.

### What we learned from reference implementations

- The MCP TypeScript SDK v2 is built around exactly the boundary this milestone
  wanted: one `McpServerFactory` consumed by both `serveStdio` and
  `createMcpHandler`, parameterised by a server-resolved principal. Our v0.2 code
  was written in the v1 idiom against a v2 dependency, so the refactor became a
  precondition rather than a cleanup — without the factory, per-participant
  identity is not expressible at all.
- Two independent templates (`nickytonline/mcp-typescript-template`,
  `ONDC-Official/automation-mcp`) converged on the same shape: a single
  `registerTools` site, input **and** output schemas on every tool, in-band
  `isError` results, and `InMemoryTransport` for tests. Convergence from two
  directions was worth more than either source alone.
- Licences matter and had to be checked rather than assumed. `automation-mcp`
  has no licence file and Emmett has none either — with a stated intent toward
  AGPL/SSPL. Both are pattern-only: read for ideas, copy nothing.
- W3C PROV-O had already named our hardest distinction. Its reason for
  *qualified* attribution is that one edge cannot express the role an agent
  played — the same reason we refuse to collapse "AI prepared" into "human
  authored".
- **Negative result worth recording:** there is no mature reference
  implementation of what br-ai-nstorm is. Searches for provenance-aware
  knowledge-graph and conflict-graph systems in TypeScript returned only
  single-digit-star personal projects. The borrowable prior art is all in the
  plumbing. That is an argument for keeping the domain core small and ours, not
  for building infrastructure around it.

### What was intentionally not built

Postgres — deferred with recorded triggers (ADR-003 §4), because none of the ten
proof points is blocked by JSON, and changing storage and ontology in the same
milestone means a failing test cannot say which one is wrong.

Real OIDC — designed and documented (ADR-003 §9), not implemented, because the
removable part is one file and the shape around it is already correct.

Also not built: live push, ATProto, private cognitive bubbles, aperture
permissions, autonomous agents, consensus scoring, Kafka, Neo4j, Redis, a graph
database, dynamic UI generation.

`EvaluationAdded` and `VisibilityChanged` are modelled and projected but have no
UI, so the log shape will not change when one arrives.

Architectural boundary at this point:

> One shared memory, several participants, several transports. Identity is
> resolved by the server. Attribution cannot be forged by a client or
> manufactured by a model. AI proposes; a person makes things canonical.

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
