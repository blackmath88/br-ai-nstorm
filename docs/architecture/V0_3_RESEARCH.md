# v0.3 research — before building the Real Shared Room

Date: 2026-09-04
Branch: `feature/real-shared-room-v0.3`
Status: complete; conclusions carried into [ADR-003](./ADR-003-v0.3-shared-room.md)

This document answers the seven Phase 0 questions. It is written after reading
the whole of `src/` and `server/` (about 1,200 lines) and after inspecting the
**installed** `@modelcontextprotocol/server@2.0.0` type surface rather than
relying on remembered API shapes. Where a claim comes from the SDK, it comes
from `node_modules/@modelcontextprotocol/server/dist/*.d.mts`.

Companion documents:

- [REFERENCE_IMPLEMENTATIONS.md](./REFERENCE_IMPLEMENTATIONS.md) — per-repo evaluation, licences, what not to copy.
- [ADR-003-v0.3-shared-room.md](./ADR-003-v0.3-shared-room.md) — the decision.

---

## The single most important finding

**Our MCP layer is written against an SDK generation that the SDK itself has
moved past, and the newer generation is shaped like the architecture this
milestone wants anyway.**

`package.json` already depends on `@modelcontextprotocol/server@^2.0.0` — the
v2 package split (`@modelcontextprotocol/{core,server,client,node,express,…}`,
published 2026-07-27). But `server/mcp.ts` uses it in the v1 idiom:

```ts
const server = new McpServer({ name: 'br-ai-nstorm', version: '0.2.0' })
server.registerTool(...)                     // at module scope
const transport = new StdioServerTransport() // hand-wired
await server.connect(transport)
```

The v2 SDK's own entrypoints are built around an `McpServerFactory` instead:

```ts
// dist/createMcpHandler-CLhGwQTn.d.mts
type McpServerFactory = (ctx: McpRequestContext) => McpServer | Server | Promise<McpServer | Server>

interface McpRequestContext {
  era: 'legacy' | 'modern'
  authInfo?: AuthInfo        // "HTTP only — serveStdio never sets it"
  requestInfo?: Request
}
```

…and both transports consume that one factory:

- `serveStdio(factory, opts)` from `@modelcontextprotocol/server/stdio` — one
  instance pinned per connection.
- `createMcpHandler(factory, opts)` from `@modelcontextprotocol/server` — one
  instance per HTTP request, stateless, with an automatic stateless fallback
  for 2025-era clients so we do not have to wire two transports.

The SDK documents the intent explicitly:

> Use ONE factory for both legs: the same tools/resources/prompts definition
> backs the modern path and the stateless legacy fallback, so the two eras can
> never drift apart.

> the context exists for factories that vary by principal or era (for example
> multi-tenant servers keyed off `authInfo`…)

That is exactly the boundary this milestone is trying to build: **one
capability registration, transport-independent, parameterised by a
server-resolved principal.** So the refactor the brief asks for as a
precondition ("if research shows our current MCP structure is outdated…
refactor it BEFORE adding features") is not merely a tidy-up — adopting the
factory is what makes per-participant identity expressible at all.

The current code cannot express identity. It does this:

```ts
const actorId = process.env.BRAINSTORM_ACTOR_ID ?? 'person:achim'   // module scope
```

One process, one hardcoded participant, decided before any connection exists.
Four participants would need four processes. With a factory, the principal is
a parameter of the serving unit.

---

## A. What in our current architecture is sound?

Genuinely sound, keep it:

1. **The conceptual boundary.** "AI may propose; only reviewed proposals become
   canonical" is enforced structurally, not by prompt text: `curateContribution`
   can only call `appendProposal`, and only `reviewProposal` can mint a
   `RelationRecord` or `ConflictRecord`. This is the good idea in the repo and
   nothing in the research suggests changing it.
2. **Conflict as a first-class object with a typed taxonomy** (`source_conflict`,
   `knowledge_conflict`, `decision_conflict`, `assumption_conflict`,
   `commitment_conflict`). Nothing off-the-shelf offers this; it is ours to keep.
3. **The service seam.** `server/service.ts` already exists so that HTTP and MCP
   call the same functions, and `mcp.ts` genuinely does not import `store.ts`.
   The seam is real, just thin.
4. **Canonical / derived view discipline in React.** State is canonical; Map and
   Timeline are projections. `MapView` reads `problem.nodes`/`problem.relations`
   and renders — it owns no truth. This survives the backend swap unchanged in
   spirit.
5. **The deterministic-first curator ordering.** Cheap lexical work runs first
   and the AI only ever sees a bounded candidate list
   (`candidates.slice(0, 12)`), never the database. Correct instinct, keep it.
6. **The clipboard aperture.** Transport-independent semantic contract, works
   with any LLM, no infrastructure. It should stay as the universal fallback.

## B. What is prototype-only and should be replaced?

| # | What | Why it must go |
|---|---|---|
| 1 | **Parallel record tables *and* an event log** (`SharedMemoryData` holds `contributions[]`, `relations[]`, `conflicts[]`, `proposals[]` **and** `events[]`) | Two sources of truth that are written separately and can silently drift. The brief asks for "deterministic event history" and "projection reconstruction" as a test. Make events the only writable truth and fold them into state. |
| 2 | **Whole-file read-modify-write with no serialisation** (`store.ts` `load()` → mutate → `save()`) | Two concurrent contributions interleave and one is lost. This directly undermines proof point 4 (multiple participants contributing distinctly) — it is a multi-user correctness bug, not just prototype scruffiness. |
| 3 | **`process.env.BRAINSTORM_ACTOR_ID` at module scope** | One participant per process. Cannot express four people. |
| 4 | **`x-brainstorm-actor` header as identity** | The caller asserts who they are and the server believes it. The brief forbids exactly this: *"The client/model must never be trusted to say `user: Achim` as proof of identity."* Replace with an opaque token the server issues and resolves. |
| 5 | **Module-scope `McpServer` + hand-wired `StdioServerTransport`** | v1 idiom; see the finding above. |
| 6 | **A single flat `author` string** (`ContributionRecord.authorId`) | Collapses "AI prepared" into "human authored" — precisely what the brief says not to do. Needs the full provenance envelope. |
| 7 | **`makeId()` = `Date.now()` + `Math.random()`** | Not deterministic, not reproducible in tests, and collides under the same millisecond. Replace with an injected clock and id source. |
| 8 | **React's local `addContribution` mutating `useState`** | The whole point of the milestone: canonical mutation must go to the server. |
| 9 | **Two divergent domain vocabularies** — `src/types/domain.ts` has `NodeKind` including `synthesis` and no `claim`; `server/domain.ts` has `ContributionKind` including `claim` and no `synthesis` | The seed bridge already silently coerces unknown kinds to `'claim'`. One vocabulary, defined server-side. |
| 10 | **Every error is a bare `throw new Error('problem_not_found')` → HTTP 400** | A missing problem is a 404, invalid input is a 422, an unknown token is a 401. Needs typed domain errors mapped per transport. |

## C. What current MCP patterns should we copy instead of inventing?

All five are confirmed against the SDK's own examples and the two template
repos (details and licences in REFERENCE_IMPLEMENTATIONS.md):

1. **`McpServerFactory`, one per serving unit.** `serveStdio(factory)` and
   `createMcpHandler(factory)` from the same `createServer(deps, actor)`.
2. **A single `registerTools(server, ctx)` as the only registration site.** Both
   `nickytonline/mcp-typescript-template` (`src/tools.ts`) and
   `ONDC-Official/automation-mcp` (`src/mcp/capabilities.ts`) converge on this
   independently.
3. **Declare `outputSchema` as well as `inputSchema`, and always return both
   `content` *and* `structuredContent`.** Our tools currently declare no
   `outputSchema`, so clients cannot validate the structured payload. The SDK
   validates `structuredContent` against `outputSchema` when one is declared —
   free schema enforcement on our own responses, which for a system whose whole
   claim is "inspectable shared memory" is worth having.
4. **In-band tool errors: return `{ isError: true, content: [...] }`, do not
   throw.** A thrown error is a protocol fault; a failed *operation* is a
   result the model must be able to read and react to. Both templates centralise
   this in a two-function helper (`createTextResult` / `createErrorResult`).
5. **Test over `InMemoryTransport.createLinkedPair()` with the real
   `@modelcontextprotocol/client`.** This exercises the actual protocol stack
   in-process with no ports, no subprocesses, no fixtures.

Also worth adopting, from the scoped-tools example: **authorisation decisions
belong inside the tool handler**, not in HTTP middleware, because the handler is
the only place that authoritatively knows which operation is running.

One version caveat we must respect: the SDK's `scoped-tools` example on `main`
reads `ctx.http?.authInfo` inside handlers, but in the **installed 2.0.0**
`ServerContext['http']` is typed `{ req?, closeSSE?, closeStandaloneSSE? }`
with no `authInfo`. So we take identity from the **factory** context
(`ctx.authInfo`, which 2.0.0 does define on `McpRequestContext`) and close over
the resolved actor. This is also the better design for us: the actor is resolved
once per serving unit, and a tool handler has no way to reach around it.

## D. What should remain transport-independent?

The rule: **the domain and application layers must not be able to tell whether
the call arrived from React, HTTP, MCP-over-stdio, MCP-over-HTTP, a future
ATProto adapter, or a test.**

Transport-independent (no `Request`, no `res`, no JSON-RPC, no env vars):

- the event model and every event constructor,
- the canonical projection (fold over events),
- the conflict model and its lifecycle,
- the curation proposal model and review rules,
- policies (who may review, what supersession means, what visibility means),
- the repository *port*,
- application services, which take a plain `ActorContext` value and return
  plain domain values,
- domain error types.

Transport-specific (adapters only):

- HTTP routing, status-code mapping, CORS,
- MCP tool registration, Zod schemas, `structuredContent` shaping, `isError`,
- token extraction from an `Authorization` header or an environment variable,
- JSON file I/O.

The test for this: the integration test drives a React-shaped HTTP call and an
MCP tool call against **one** in-process service instance and asserts they see
the same canonical state. If any domain type needed a transport import, that
test could not be written.

## E. What should be deterministic vs AI-assisted?

**Deterministic — always, no exceptions:**

attribution · timestamps · event ordering and identity · the canonical
projection · accepted relations · accepted conflicts · supersession ·
visibility · review outcomes · what a given participant is allowed to do.

The brief's rule — *"Never use AI to manufacture attribution"* — is enforced
structurally: `ContributionAdded` carries `actorId` from the `ActorContext`
resolved from a server-issued token, and no curator code path can construct
that event.

**AI-assisted — proposal only, bounded:** classify a contribution · propose a
duplicate · propose a relation · propose a conflict · write a short
human-readable reason.

**Explicitly not built** (from the brief, and nothing in the research argues for
them): autonomous synthesis, automatic consensus, automatic deletion, automatic
supersession, silent merges, automatic visibility changes.

The structural guarantee is a type-level one, not a promise in a prompt: the AI
curator's return type is `CurationProposal[]`. There is no code path from a
curator to an event constructor. Only `curation-service.review()` — which
requires a human `ActorContext` — can emit `RelationAccepted` /
`ConflictAccepted`.

## F. What is the minimum auth model for v0.3?

The brief sets two constraints that look opposed and are not:

> Do not overbuild auth yet. … Do not implement a fake security model that will
> be difficult to remove later. Identity must be resolved server-side.

The resolution is to separate **how a principal is established** (cheap and
throwaway for v0.3) from **how a principal is carried and verified** (the real
shape, adopted now).

Adopt now — the real shape:

- Every request carries `Authorization: Bearer <token>`. No identity is ever
  read from a request body, a query parameter, or a self-declared header.
- The server resolves `token → ActorContext { actorId, displayName, scopes }`
  through a `TokenVerifier` interface deliberately shaped like the SDK's
  `OAuthTokenVerifier` (`verifyAccessToken(token): Promise<AuthInfo>`).
- Application services receive `ActorContext` as an argument. They have no
  other way to learn who is calling.
- An unknown or missing token is a `401` with a `WWW-Authenticate: Bearer`
  challenge — the same answer a real Resource Server gives.

Deliberately cheap for v0.3 — the throwaway half:

- Tokens are opaque random strings minted by a dev-only
  `POST /api/auth/session { participantId }`, held in memory. There is no
  password, no authorization server, no signature.

Why this is not a fake security model: **the removable part is the issuer, and
the issuer is one file.** Swapping to real OIDC means implementing
`TokenVerifier` against a JWKS endpoint and serving RFC 9728 protected-resource
metadata. Nothing in the domain, application, HTTP or MCP layers changes,
because none of them ever sees a token — they see an `ActorContext`. That is
the opposite of the trap the brief warns about; the trap is the
`x-brainstorm-actor` header we have today, which has no removable seam at all
because the caller *is* the identity provider.

The SDK gives us the future path directly: `verifyBearerToken`,
`requireBearerAuth`, `bearerAuthChallengeResponse`,
`buildOAuthProtectedResourceMetadata` and `getOAuthProtectedResourceMetadataUrl`
are all exported from `@modelcontextprotocol/server@2.0.0`, and
`requireBearerAuth` returns `AuthInfo | Response` — the exact gate shape we are
writing by hand for the dev issuer.

**Recommended future design (not built now):** the br-ai-nstorm API becomes an
OAuth 2.1 Resource Server; an external OIDC provider is the Authorization
Server; participants' MCP clients discover it from the `401` challenge via RFC
9728 and obtain tokens with Dynamic Client Registration + PKCE. `AuthInfo.extra`
carries the stable subject we map to `person:*`.

## G. Which GitHub repos are worth borrowing patterns from?

Summarised here; full evaluation, licences and "what not to copy" in
[REFERENCE_IMPLEMENTATIONS.md](./REFERENCE_IMPLEMENTATIONS.md).

**Borrow patterns from:**

- `modelcontextprotocol/typescript-sdk` (MIT) — authority. Factory, `serveStdio`,
  `createMcpHandler`, bearer-auth gate, handler-level authorisation.
- `nickytonline/mcp-typescript-template` (MIT) — `registerTools` as single
  source, `createTextResult`/`createErrorResult`, `InMemoryTransport` tests.
- `ONDC-Official/automation-mcp` (**no licence**) — observe only, copy no code:
  `defineTool` helper forcing input+output schemas, one-line-per-module
  capability registry, "the factory performs no I/O" as an assertable test.

**Deliberately not adopted:**

- `event-driven-io/emmett` — the right concepts (`decide`/`evolve`, swappable
  event stores) but **no licence file** and a stated intent toward AGPL/SSPL.
  Unusable as a dependency. We implement the two ideas ourselves in ~40 lines.
- `compdemocracy/polis` (AGPL-3.0) — adjacent problem (large-scale opinion
  clustering), wrong shape (statistical consensus, which is an explicit
  non-goal), and copyleft.
- W3C **PROV-O** — not code, but the right *vocabulary*. Its
  `wasAttributedTo` / `wasGeneratedBy` / `actedOnBehalfOf` distinction is
  precisely the "AI prepared ≠ human authored" separation the brief demands.
  We borrow the shape of the distinction, not RDF.

**Honest negative result:** searching for provenance-aware knowledge-graph and
conflict-graph systems in TypeScript returned only single-digit-star personal
projects from the last few months. There is no mature reference implementation
of the thing br-ai-nstorm is trying to be. Nothing to copy for the domain
core — which is a reason to keep it small and ours, not a reason to invent
infrastructure.

## Persistence: JSON or Postgres for v0.3?

**Recommendation: keep JSON for one more milestone (Option A), behind a real
repository port.**

The brief's own test is *"move to Postgres ONLY if it materially helps
multi-user/provenance/conflict testing and does not derail the milestone."*
Walking the ten proof points: none of them is blocked by JSON. Conflicts,
provenance chains, four participants, MCP↔React round-trip and curation review
are all questions about the *domain*, and the domain is decided by the event
model, not by the storage engine.

What Postgres would actually buy is real concurrent writes — and the current
JSON store's lost-update bug is fixable in the store, by serialising writes
through a mutex and appending events rather than rewriting a document. That
closes the only multi-user gap JSON creates, in far less code than migrations
plus a container plus CI plumbing.

Against introducing it now: Postgres would add a service to run before any test
can pass, a migration tool, and a second dialect of the event log to keep in
sync — while the event model itself is still being decided in this very
milestone. Changing storage *and* the ontology at once means a failing test
cannot tell you which one is wrong.

Recorded trigger for Option B, so this stays a decision rather than a drift:
move to Postgres when any one of these becomes true —

1. more than one server process must serve the same problem,
2. the event log passes ~10⁴ events (full-file rewrite becomes the bottleneck),
3. we need queries the fold cannot answer cheaply (cross-problem search,
   per-actor history at scale),
4. deployment beyond a single developer machine.

The repository port is written so that a `postgres-repository.ts` implements
`appendEvents` + `readEvents` and nothing above it changes. Storage technology
must not define the ontology — so the ontology (nodes, relations, conflicts,
events) is defined in `domain/`, and the store only ever sees an append-only
list of events.
