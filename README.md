<!-- BEGIN public-repo-header -->
<div align="center">

# br-ai-nstorm

<a href="https://github.com/blackmath88/br-ai-nstorm"><img alt="Primary language: TypeScript" src="https://img.shields.io/badge/language-TypeScript-526078?style=flat"></a>
<a href="https://github.com/blackmath88/br-ai-nstorm/tree/main/docs"><img alt="Documentation" src="https://img.shields.io/badge/docs-guide-16796f?style=flat"></a>
<a href="https://github.com/blackmath88/br-ai-nstorm/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/blackmath88/br-ai-nstorm?style=flat&amp;color=737373"></a>

</div>
<!-- END public-repo-header -->

A prototype for **AI-mediated collective problem solving**.

The visible product is simple:

- one shared problem,
- contributions from people,
- orchestration prompts,
- provenance and evaluation,
- a canonical current-state view,
- derived map and timeline views,
- and an aperture to external LLMs.

The deeper experiment is whether **independently controlled AI conversations can
contribute bounded, interoperable objects to a shared problem memory**.

The rule the whole system is built around:

> AI may interpret and propose. It may not silently rewrite collective memory.

## v0.4 — Orchestration, remote MCP, repository adoption

Three additions, chosen from what the repository and its open issue asked for
next. None adds a dependency.

**Who pays for AI judgement is a per-problem choice.** Each problem has an
orchestration mode, switched by a participant and recorded as
`OrchestrationModeChanged`:

| mode | who judges relations and conflicts | who pays |
|---|---|---|
| `participant` *(default)* | the contributor's own LLM, from ≤ 12 candidates the server ranks deterministically | the contributor |
| `api` | the server's AI curator | the operator (only selectable when a key is configured) |
| `deterministic` | lexical matching only; AI proposals are dropped with a reason | nobody |

The deterministic curator runs in every mode, and one cap (8) bounds all
proposals a single contribution can create. A participant's LLM attaches
proposals to its contribution; each is recorded as made by `agent:<model>` *on
behalf of* that participant (`prov:actedOnBehalfOf`) — and **only another
participant may review it**. There is no silent fallback to the paid curator.
Deployments that relied on the server curator before v0.4 set
`BRAINSTORM_DEFAULT_ORCHESTRATION=api` to keep it for problems nobody has
switched. Selecting the mode a problem only defaults to pins it, so a later
change of deployment default cannot move it silently.

**Cheap reads for LLM clients.** `get_problem_overview` (ids, kinds, labels,
provenance — no bodies), `get_contributions` (≤ 20 full texts by id) and
`get_contribution_context` (mode, instructions, bounded candidates) keep a
participant's per-turn read flat as the problem grows.

**MCP on the Cloudflare Worker.** `/mcp` serves the same tools as Node through
the SDK's fetch-shaped `createMcpHandler`. Verifying it under workerd surfaced a
pre-existing bug — the Durable Object stub was cached across requests, so the
deployed demo answered `500` after its first request — now fixed. See
[CLOUDFLARE_DEMO.md](docs/architecture/CLOUDFLARE_DEMO.md).

**Repository adoption ([issue #4](https://github.com/blackmath88/br-ai-nstorm/issues/4)).**
A repository declares problem spaces in one `brainstorm.config.json`; a
deterministic extractor turns its Markdown into line-anchored, reviewable
contributions. Level 1 is a static HTML view with no backend; Level 2 pushes
into a room. Imports are content-addressed, add-only and uneditable in the room,
so the repository and the room never become competing truths. See
[ADOPTION.md](docs/ADOPTION.md).

```bash
npm run brainstorm -- init  ../some-repo            # propose a manifest
npm run brainstorm -- build ../some-repo            # Level 1: static view
npm run brainstorm -- push  ../some-repo --url http://localhost:8787 --token <t>
```

## v0.3 — Real Shared Room

One problem now works end to end through a real backend, with several
participants on two transports and one canonical memory.

```text
   React  ──────┐                     ┌────── MCP client (stdio)
                │                     │
                │                     ├────── MCP client (HTTP)
                ▼                     ▼
        HTTP adapter            MCP adapter
                │                     │
                └────────┬────────────┘
                         ▼
            application services          ← take an ActorContext, return domain values
                         │                  and cannot tell which transport called
                         ▼
                 domain (pure)
        events · projections · conflicts · policies
                         │
                         ▼
              EventRepository (port)
                         │
                append-only event log
```

What changed from v0.2:

- **React reads and writes canonical state through the backend.** There is no
  local canonical state and no silent fallback to seed data.
- **Events are the only writable truth.** Canonical state is a fold over the
  log, so records and events can no longer drift apart.
- **Identity is resolved server-side from a bearer token.** The
  `x-brainstorm-actor` header — where the caller asserted its own identity — is
  gone.
- **MCP is rebuilt on the v2 SDK's server-factory model**, so one process serves
  several participants and one registration backs stdio and HTTP alike.
- **Conflicts are visible.** Accepted, unresolved conflicts render at the top of
  the canonical view rather than in a drawer.
- **The curation queue is reviewable in the UI**, with the curator named on
  every proposal.
- **Provenance is a qualified attribution**, not one author string: "AI
  prepared" is never recorded as "human authored".

## Run it

```bash
npm install
cp .env.example .env
```

Backend (REST API on `/api`, stateless MCP on `/mcp`):

```bash
npm run dev:server
```

Frontend, in a second terminal (the Vite dev server proxies `/api` to the backend):

```bash
npm run dev
```

Then pick a participant — Achim, Kai, Lea or Mara — and contribute.

Checks:

```bash
npm run typecheck
npm test
npm run build
```

## HTTP API

Every route except `/health` and the prototype login stub requires
`Authorization: Bearer <token>`. An unknown or missing token answers `401` with
a `WWW-Authenticate: Bearer` challenge.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | liveness, curator status, orchestration options |
| `GET` | `/api/participants` | prototype roster (dev only) |
| `POST` | `/api/auth/session` | mint a session token (dev only) |
| `GET` | `/api/problems` | list problems |
| `GET` | `/api/problems/:id` | canonical state (`?detail=compact` for the bodiless overview) |
| `GET` | `/api/problems/:id/updates?since=` | what changed, and what happened to my contributions |
| `GET` | `/api/problems/:id/conflicts` | accepted conflicts |
| `GET` | `/api/problems/:id/curation?status=` | curation queue |
| `GET` | `/api/problems/:id/events` | full event history |
| `GET` | `/api/problems/:id/mine` | my contributions |
| `POST` | `/api/problems/:id/contributions` | contribute, optionally with participant `proposals` |
| `GET` | `/api/problems/:id/orchestration` | current mode and which modes are available |
| `POST` | `/api/problems/:id/orchestration` | switch mode (`{ mode, reason? }`) |
| `GET` | `/api/problems/:id/context?draft=` | bounded candidates and instructions for a participant's LLM |
| `POST` | `/api/imports/preview` | what a repository import would add, and what is stale |
| `POST` | `/api/imports` | import a repository bundle (`{ manifest, files, revision? }`) |
| `POST` | `/api/curation/:proposalId/accept` | make a proposal canonical |
| `POST` | `/api/curation/:proposalId/reject` | decline a proposal |

## MCP

Two transports, one registration site (`server/mcp/register-tools.ts`), one set
of application services — the same objects the HTTP adapter calls. **No tool
handler touches the store.**

stdio:

```bash
BRAINSTORM_PARTICIPANT=Lea npm run mcp
```

Streamable HTTP: `POST http://localhost:8787/mcp` with a bearer token — or the
same path on the Cloudflare Worker. Identity reaches the server factory as
`ctx.authInfo`, so several participants share one process.

Tools: `list_problems` · `get_problem_overview` · `get_contributions` ·
`get_contribution_context` · `get_problem_state` · `get_problem_updates` ·
`get_my_contributions` · `get_conflicts` · `propose_contribution` ·
`review_curation_proposal`.

The intended loop for a participant's model: `get_problem_overview` →
`get_contributions` for what matters → `get_contribution_context` with the
draft → `propose_contribution` with `proposals` (in `participant` mode).
Switching orchestration mode is deliberately **not** an MCP tool: it moves cost,
so it stays a click by a person in the room.

Every tool declares an `inputSchema` and an `outputSchema`, returns `content`
plus `structuredContent`, and reports operation failures as in-band
`isError: true` results rather than throwing.

## Identity

Adopted now, and permanent:

- identity travels as a bearer token, never as a self-declared header or body field;
- the server resolves it through a `TokenVerifier` shaped like the MCP SDK's
  `OAuthTokenVerifier`;
- application services receive an `ActorContext` and have no other way to learn
  who is calling.

Deliberately cheap, and removable: the *issuer*. `server/auth/prototype-auth.ts`
mints opaque in-memory tokens for four participants with no password and no
authorization server. Set `BRAINSTORM_PROTOTYPE_AUTH=off` to disable it.

Swapping to real OIDC means implementing `TokenVerifier` against a JWKS endpoint
and serving RFC 9728 metadata. Nothing in the domain, application, HTTP or MCP
layers changes, because none of them ever sees a token.

## Provenance

Who-said-what-when is first class. A contribution carries a qualified
attribution — the distinction W3C PROV-O makes with `prov:qualifiedAttribution`,
for the same reason:

| field | meaning |
|---|---|
| `authoredBy` | the person responsible for the content |
| `preparedBy` | the model or agent that drafted it, when one did |
| `submittedBy` | who pushed it into shared memory |
| `reviewedBy` / `publishedBy` | later human acts on it |
| `source` | `direct`, `ai_assisted`, `external_llm`, `mcp`, `seed` |
| `endorsement` | `human_endorsed` or `participant_review_required` |

Two collapses this prevents:

- "AI prepared" must not become "human authored";
- "Person said X" must not become "X is true".

The seed importer honours this too: prototype authors like `"AI synthesis"` and
`"Group"` become `seed:*` agents rather than being mapped onto a real person.

## Event log

`ProblemCreated` · `ContributionAdded` · `ContributionEdited` ·
`RelationProposed` · `RelationAccepted` · `RelationRejected` ·
`ConflictProposed` · `ConflictAccepted` · `ConflictRejected` ·
`EvaluationAdded` · `ContributionSuperseded` · `VisibilityChanged`

Each event carries `id`, `problemId`, `actorId`, `timestamp`, `objectId`,
`eventType`, `payload`, and `causationId` / `correlationId` where they apply —
so a proposal points back to the contribution that triggered it.

The clock and the id source are injected, so a given sequence of commands
produces a byte-identical event stream and tests can assert on it.

Supersession sets a status and records a pointer. It never deletes a
contribution and never removes an event.

## Conflict is first class

Conflict is part of knowledge, not an error state:

`source_conflict` · `knowledge_conflict` · `decision_conflict` ·
`assumption_conflict` · `commitment_conflict`

A conflict exists **only** as the result of `ConflictAccepted`, and only a
participant can cause one. Curators propose; a rejected proposal leaves a
`ConflictRejected` event and no conflict.

## Curation

The deterministic curator runs first and handles the obvious cases with lexical
work — duplicates, possible relations, classification, and contradiction cues.

What runs after it depends on the problem's orchestration mode (see v0.4
above). In `participant` mode the contributor's own LLM has already proposed,
and its proposals are screened: real target ids, valid vocabulary, a reason, at
most 8. In `api` mode — selectable only when `OPENAI_API_KEY` and
`OPENAI_MODEL` are set — a conservative AI curator runs. It receives at most 12
sibling contributions, never the store, and may only name objects it was
handed. Any failure is logged to stderr and skipped; the contribution is
already durable before curation runs.

Neither curator can write canonical memory, and this is structural rather than
promised: curator modules do not import the event constructor. Their return type
is a list of proposals, and only `curation-service.review()` — which requires a
human `ActorContext` — can emit `RelationAccepted` or `ConflictAccepted`.

Allowed: classify · propose duplicate · propose relation · propose conflict ·
explain briefly.

Not built: autonomous synthesis, automatic consensus, automatic deletion,
automatic supersession, silent merges, automatic visibility changes.

## Views

**State** is canonical: questions, approaches, evidence, assumptions, tensions,
claims, synthesis — with unresolved conflicts above them and superseded
contributions kept below, visibly retired rather than gone.

**Map** is an exploratory D3 projection. Position is not canonical. Node size is
degree; dashed red edges are accepted, unresolved conflicts.

**Timeline** is the event log read as a story, with the actor and event type on
every entry.

**Curation** is the review queue, with the orchestration switch above it. A
proposal made by your own AI shows who made it and has no accept or reject
buttons for you.

## Clipboard aperture

Still the universal fallback, now over real state: export the canonical context
package into any LLM, think privately, return only a `contributionPackage`.
Imported contributions are written through the backend like any other, marked
`external_llm` and `participant_review_required`, and attributed to the session's
participant — never to the `participantId` written in the package.

## Layout

```text
src/                 frontend only
  lib/api.ts         backend client
  state/useRoom.ts   session, canonical reads, mutations, refresh
  components/        State · Map · Timeline · Curation · SideRail

server/
  domain/            types · events · conflicts · projections · policies
  application/       problem · contribution · curation · orchestration · import services
  adoption/          manifest · markdown extractor · import plan · static view
  persistence/       repository port · JSON adapter · seed
  curation/          deterministic · ai-curator · participant (screening, candidates)
  auth/              actor-context (port) · prototype-auth (adapter)
  mcp/               create-server · register-tools · stdio · http
  http/              api · server
  container.ts       composition root — the only place that reads env
  test/              domain · api · mcp · persistence · integration · orchestration · adoption · worker

worker/              Cloudflare adapters: api · mcp · durable repository · demo auth
scripts/brainstorm.ts  adoption CLI: init · build · preview · push
```

## Tests

`npm test` — 120 tests across eight files. `npm run typecheck` covers the
frontend, the server and the Worker.

The decisive one is `server/test/integration.test.ts`: Kai contributes over
HTTP, the curator proposes a conflict, Achim accepts it, the conflict becomes
visible on the React read path, Lea connects over MCP and sees the same
canonical state, Lea contributes through MCP, React sees it, and the history
carries the whole provenance chain — all against **one** service instance driven
through both transports at once.

`server/test/worker.test.ts` drives a real MCP client through the Worker's
fetch handler, with the Durable Object replaced by an in-memory stub.

`server/test/persistence.test.ts` covers the concurrency fix: v0.2's
read-modify-write store kept **1 of 50** concurrent appends (measured, not
assumed); the current store keeps all 50.

## What is intentionally still missing

Postgres · real OIDC · live push (React refreshes after mutation and on demand) ·
ATProto · private cognitive bubbles · aperture permissions · autonomous agents ·
consensus scoring · Kafka · Neo4j · Redis · a graph database.

The JSON store stays disposable on purpose. Its job is to prove the
event/provenance/curation model before infrastructure arrives. The triggers for
moving to Postgres are recorded in ADR-003 §4, so it stays a decision rather
than a drift.

`EvaluationAdded` and `VisibilityChanged` are modelled and projected but no UI
drives them yet — they exist so the log shape does not change when the UI
arrives.

Adoption Level 3 (Observstory evidence in, Weavr intent out) is described in
ADOPTION.md and not built.

## Documents

- [docs/CONCEPT.md](docs/CONCEPT.md) — the product and research idea
- [docs/SCHEMAS.md](docs/SCHEMAS.md) — interchange schemas
- [docs/history/MILESTONES.md](docs/history/MILESTONES.md) — how the understanding evolved
- [docs/architecture/V0_3_RESEARCH.md](docs/architecture/V0_3_RESEARCH.md) — what was sound, what had to go, and why
- [docs/architecture/REFERENCE_IMPLEMENTATIONS.md](docs/architecture/REFERENCE_IMPLEMENTATIONS.md) — per-repo evaluation, licences, what not to copy
- [docs/architecture/ADR-003-v0.3-shared-room.md](docs/architecture/ADR-003-v0.3-shared-room.md) — the v0.3 decision
- [docs/ADOPTION.md](docs/ADOPTION.md) — Brainstorm as a reusable problem-space form (issue #4)
- [docs/architecture/CLOUDFLARE_DEMO.md](docs/architecture/CLOUDFLARE_DEMO.md) — Worker deployment, including MCP

## Next validation

Three humans, three different MCP-capable LLM environments, one shared problem.
Test whether:

1. the same shared state is understood consistently,
2. contributions remain attributable,
3. conflicts become more visible rather than flattened,
4. curator proposals are worth reviewing,
5. external LLM participation is materially better than clipboard JSON alone,
6. participant-mode proposals are worth reviewing compared with `api`-mode ones
   — the cost model only holds if contributors' own models curate well enough.

Only after that should the contribution/relation/evaluation schemas be
considered for formal ATProto Lexicons.
