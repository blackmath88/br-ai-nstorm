# br-ai-nstorm

A prototype for **AI-mediated collective problem solving**.

The visible product is simple:

- one shared problem,
- contributions from people,
- orchestration prompts,
- evaluation and provenance,
- a canonical current-state view,
- optional map and timeline views,
- and an aperture to external LLMs.

The deeper experiment is whether **independently controlled AI conversations can contribute bounded, interoperable objects to a shared problem memory**.

## Current architecture: v0.2 shared memory

The React prototype still provides the visual problem state. This branch adds a deliberately small real backend slice:

```text
React / external LLM
        │
   HTTP / MCP
        │
        ▼
application service
        │
        ├─ deterministic append-only event log
        ├─ attributed contributions
        ├─ accepted relations
        ├─ first-class conflicts
        └─ curation proposal queue
                     │
          deterministic curator
                     │
             optional AI curator
```

The core rule is:

> AI may propose structure. It may not silently rewrite collective memory.

## Run the React prototype

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Run the minimal HTTP API

```bash
cp .env.example .env
npm run dev:server
```

Endpoints:

- `GET /health`
- `GET /api/problems`
- `GET /api/problems/:problemId`
- `GET /api/problems/:problemId/updates`
- `POST /api/problems/:problemId/contributions`
- `POST /api/curation/:proposalId/review`

For the prototype, HTTP identity is supplied with `x-brainstorm-actor`. This is intentionally **not production auth**. OAuth/OIDC should replace it before any real deployment.

## Run the MCP server

```bash
BRAINSTORM_ACTOR_ID=person:achim npm run mcp
```

The stdio server exposes:

- `list_problems`
- `get_problem_state`
- `get_my_updates`
- `propose_contribution`
- `review_curation_proposal`

MCP and HTTP both call the same application service. MCP never talks directly to the store.

## Provenance and event history

Every shared contribution is attributed and logged before curation runs.

The event log currently records operations such as:

- `ProblemCreated`
- `ContributionAdded`
- `RelationProposed`
- `RelationAccepted`
- `RelationRejected`
- `ConflictProposed`
- `ConflictAccepted`
- `ConflictRejected`

This gives us the deterministic answer to **who said what, when, and what happened to it**.

## Conflict is first-class

The prototype distinguishes conflict from ordinary relationships. The data model already has room for:

- source conflict,
- knowledge conflict,
- decision conflict,
- assumption conflict,
- commitment conflict.

The deterministic curator can suggest possible relations, duplicates, classifications, and conflicts. Suggestions enter the curation queue. They are not canonical until reviewed.

## Minimal AI curator

The server works without AI.

If both `OPENAI_API_KEY` and `OPENAI_MODEL` are set, a conservative curator call runs after a new contribution. It uses Structured Outputs to propose only:

- possible relations,
- possible conflicts,
- possible duplicates.

The model is explicitly instructed not to declare truth or consensus. Its output remains a review proposal.

## Core views

### State
The canonical default. Questions, approaches, evidence, assumptions, tensions, and synthesis are explicit categories so people can understand the problem at a glance.

### Map
An exploratory D3 relationship view. Position is **not canonical**.

### Timeline
A diachronic view of how the problem state evolved.

## Clipboard aperture

The manual clipboard flow remains useful as a universal fallback:

`Think with my AI` exports an interchange package. Think privately in any LLM and return only the specified contribution package.

MCP now provides a second transport for the same underlying idea. The semantic contract should remain independent of transport.

## What is intentionally still missing

- production OAuth/OIDC,
- Postgres,
- real multi-user synchronization in React,
- private cognitive bubbles,
- aperture permissions,
- ATProto storage/federation,
- graph database,
- Kafka,
- autonomous agents,
- automatic consensus.

The local JSON store is intentionally disposable. Its job is to prove the event/provenance/curation model before introducing infrastructure.

## Next validation

Use three humans with three different MCP-capable LLM environments against one shared problem. Test whether:

1. the same shared state is understood consistently,
2. contributions remain attributable,
3. conflicts become more visible rather than flattened,
4. curator proposals are useful enough to review,
5. external LLM participation feels materially better than clipboard JSON alone.

Only after that should the stable contribution/relationship/evaluation schemas be considered for formal ATProto Lexicons.
