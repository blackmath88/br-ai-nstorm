# Roadmap

The build plan. Every item is a GitHub issue; this file sets the order and the
reasoning behind it. Labels: `phase: 0.5 field test` → `phase: 0.6` →
`phase: later`.

**Principle:** build only what the next experiment needs. Each phase ends with
evidence, and that evidence decides the next phase. Nothing is built "because
it will be needed".

## Where we are — v0.5 on `main`

Ready for the field test: conflicts close with a note, contributions supersede
visibly, evaluations have a UI and an MCP tool, the room polls a version token
for liveness, the event log has optimistic concurrency, and the Report tab turns
a session into numbers. `npm run demo:reset` fills every surface with a
scripted story. History: [docs/history/MILESTONES.md](docs/history/MILESTONES.md).

## Phase 0.5 — Field test (now)

| # | Item | Why now |
|---|---|---|
| [#6](https://github.com/blackmath88/br-ai-nstorm/issues/6) | Retire old branches; push milestone tags | One `main`, history kept as tags |
| [#7](https://github.com/blackmath88/br-ai-nstorm/issues/7) | Protect `main`: PRs + green CI | Keeps `main` runnable |
| [#9](https://github.com/blackmath88/br-ai-nstorm/issues/9) | Pin wrangler | No surprise major version on the day of the field test |
| [#8](https://github.com/blackmath88/br-ai-nstorm/issues/8) | **Run the three-person field test, record H1–H6** | The whole next phase depends on it |

Exit: a field-test result section in MILESTONES.md, with each hypothesis marked
held / negative / inconclusive.

## Phase 0.6 — Chosen by the field test

These are candidates, not commitments. Re-rank them after #8.

| # | Item | Build it if… |
|---|---|---|
| [#12](https://github.com/blackmath88/br-ai-nstorm/issues/12) | OAuth 2.1 / OIDC identity (ADR-003 §9) | the room is going to be used beyond a facilitated session (likely) |
| [#10](https://github.com/blackmath88/br-ai-nstorm/issues/10) | JSON log: atomic across processes | Node + local stdio MCP stay the setup people use |
| [#11](https://github.com/blackmath88/br-ai-nstorm/issues/11) | SSE push instead of polling | lag caused stale actions or refused duplicate reviews in the session |
| [#13](https://github.com/blackmath88/br-ai-nstorm/issues/13) | UI for `VisibilityChanged` | H1–H3 held, so the selective-opening research question comes next |

If **H6 fails** (participant-AI proposals trail the server curator), the first
0.6 item becomes a new issue: improve the candidate set and instructions in
`get_contribution_context`, or change the default orchestration mode. Fix that
before anything else.

## Later — deferred with a recorded trigger

| # | Item | Trigger |
|---|---|---|
| [#14](https://github.com/blackmath88/br-ai-nstorm/issues/14) | Postgres adapter | multi-process serving, ~10⁴ events, or a query the fold can't answer (ADR-003 §4) |
| [#15](https://github.com/blackmath88/br-ai-nstorm/issues/15) | Adoption Level 3 (Observstory / Weavr) | a real repository wants the round trip |
| [#16](https://github.com/blackmath88/br-ai-nstorm/issues/16) | ATProto Lexicons for the schemas | the field test confirms the schemas hold across clients |

## Deliberately not planned

Kafka · Neo4j · Redis · a graph database · autonomous agents · consensus
scoring · rankings derived from judgements · MCP tools that close conflicts or
supersede (a person does those in the room) · social feed · project management.
These were ruled out on purpose (ADR-003 §12, MILESTONES v0.5). Reopening one
needs an issue that says which finding changed.
