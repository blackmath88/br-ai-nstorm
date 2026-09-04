# Reference implementations evaluated for v0.3

Date: 2026-09-04. Companion to [V0_3_RESEARCH.md](./V0_3_RESEARCH.md).

Each entry records: what problem it solves · the exact pattern that is useful ·
whether it is active · whether the licence permits reuse · what **not** to copy ·
whether it reduces complexity in this repo.

The rule applied throughout: **the official SDK is authority; third-party repos
are corroboration.** Where a template and the SDK disagree, the SDK wins.

A note on the difference between *copying code* and *adopting a pattern*: an
architectural shape (a factory, a registry function, a naming convention) is not
protectable and can be adopted from any repo. Verbatim source can only be taken
from a repo whose licence permits it. Two entries below are pattern-only for
exactly this reason.

---

## 1. modelcontextprotocol/typescript-sdk — **authority**

- **Solves:** the MCP protocol itself, in TypeScript.
- **Active:** yes. v2 package split published 2026-07-27; `@modelcontextprotocol/server@2.0.0` is what we already depend on.
- **Licence:** MIT — reuse permitted.
- **Reduces complexity here:** substantially. It replaces our hand-wired transport code and hands us the identity seam for free.

**Patterns adopted:**

1. **`McpServerFactory` as the transport boundary.** One factory, consumed by
   both `serveStdio()` and `createMcpHandler()`. This is the SDK's own answer to
   "transport-independent server", so we stop inventing one.
2. **`ctx.authInfo` on `McpRequestContext`** — the documented hook for
   "multi-tenant servers keyed off `authInfo`". This is how four participants
   share one process.
3. **`registerTool` with both `inputSchema` and `outputSchema` as Zod objects,
   returning `content` + `structuredContent`.** The SDK validates
   `structuredContent` against the declared `outputSchema`.
4. **Bearer gate shape** (`examples/bearer-auth/server.ts`): an
   `OAuthTokenVerifier` with `verifyAccessToken(token): Promise<AuthInfo>` in
   front of the handler; verified `authInfo` reaches the factory. We implement
   this interface with a dev issuer now and a real one later.
5. **Authorisation inside the tool handler** (`examples/scoped-tools/server.ts`,
   verbatim from its header comment): *"the handler is the only place that
   authoritatively knows which tool is executing, so the scope decision lives
   next to the code it guards."* An under-scoped call returns a tool-result
   `isError`, not an HTTP 403.
6. **Explicitly not-yet-needed exports we are leaving on the shelf**, having
   confirmed they exist for the future OIDC step: `verifyBearerToken`,
   `requireBearerAuth`, `bearerAuthChallengeResponse`,
   `buildOAuthProtectedResourceMetadata`, `getOAuthProtectedResourceMetadataUrl`.

**Do not copy:**

- `examples/scoped-tools`' in-process Authorization Server. Its own header says
  **"DEMO ONLY — NOT FOR PRODUCTION"**; it auto-consents and issues whatever
  scope is requested. We take its *gate* and its *401 challenge*, not its AS.
- The Express dependency (`@modelcontextprotocol/express`,
  `createMcpExpressApp`) used across the examples. Our HTTP surface is ~120
  lines of `node:http`; adding Express to match an example would add a
  framework, not remove code. We use `@modelcontextprotocol/node`'s
  `toNodeHandler`, which is framework-free.
- Elicitation / sampling / tasks / subscriptions. Real capabilities, no use in
  this milestone.

**Version caveat, verified against the installed package, not the docs:** the
`main`-branch examples read `ctx.http?.authInfo` inside handlers, but in
`@modelcontextprotocol/server@2.0.0` `ServerContext['http']` is typed
`{ req?, closeSSE?, closeStandaloneSSE? }` — no `authInfo`. We therefore take
identity from the factory context and close over it. Worth re-checking on the
next SDK bump.

---

## 2. nickytonline/mcp-typescript-template — **closest corroboration**

- **Solves:** a starting skeleton for a v2-SDK MCP server, stateless over HTTP.
- **Active:** yes — already on `@modelcontextprotocol/server@^2.0.0` and
  `@modelcontextprotocol/client@^2.0.0`, ~97 commits, semantic-release, Node ≥24.
- **Licence:** MIT — reuse permitted.
- **Reduces complexity here:** yes, mostly by validating choices we had to make
  anyway, plus one genuinely reusable ~30-line helper pair.

**Patterns adopted:**

1. **`registerTools(server)` in one file as the single registration source**,
   called from `getServer()`. Its comment states the reason precisely: the
   2026-07-28 spec serves each request from a fresh instance, so *"there is no
   per-connection session to register tools once for."*
2. **`createTextResult` / `createErrorResult`.** Two small functions that
   guarantee every tool result carries both a text block and
   `structuredContent`, and that failures are in-band `isError: true` results
   rather than thrown exceptions. We adopt this shape (MIT permits copying; we
   have written our own variants against our own result envelope).
3. **Tool annotations as declared safety hints** (`readOnlyHint`,
   `idempotentHint`, `openWorldHint`). Cheap, and for a system whose read tools
   must never mutate shared memory, worth stating in the protocol.
4. **`InMemoryTransport.createLinkedPair()` + real `Client` for tests.** Full
   protocol stack in-process, no ports. This is how our MCP tests are written.

**Do not copy:** Express + pino + Docker + semantic-release + commitlint. This
is template scaffolding for a standalone published server; br-ai-nstorm's MCP
adapter is one module inside a larger app. Its `elicit_echo` multi-round-trip
tool is a nice demonstration of `inputRequired()` and irrelevant to us.

---

## 3. ONDC-Official/automation-mcp — **pattern-only, no code**

- **Solves:** a production-shaped MCP server with stdio and HTTP entrypoints
  over a shared capability registry.
- **Active:** thin. 15 commits, 0 stars, and pinned to
  `@modelcontextprotocol/*@2.0.0-beta.5` — deliberately exact-pinned because the
  API was unsettled at the time. We are on the released 2.0.0.
- **Licence:** **none detected.** No `LICENSE` file. Under default copyright,
  that means *no reuse rights*. Therefore: **read for ideas, copy nothing.**
- **Reduces complexity here:** marginally — it mostly confirms the same
  structure the MIT sources show, so nothing is lost by the licence constraint.

**Patterns observed (independently reachable, so safe to apply):**

1. `buildMcpServer(container, ctx)` **registers every capability and binds no
   transport**; entrypoints own transport. Same conclusion as the SDK, arrived
   at independently — good corroboration.
2. A `defineTool` helper that **forces both input and output schemas** at the
   type level, so a tool cannot be registered without declaring its output shape.
3. `capabilities.ts` as a registry with **one line per module** — the list of
   what the server can do is readable in one screen.
4. **stdout is the JSON-RPC channel; stderr is for logging.** Our current
   `curator.ts` calls `console.error` — correct by luck; it should stay correct
   by intent. (Any `console.log` in a stdio server corrupts the protocol stream.)
5. A test asserting **the factory performs no I/O across 100 constructions.** A
   cheap, genuinely good guard: it keeps per-request construction cheap and stops
   someone quietly putting a file read in the factory.

**Do not copy:** Fastify hosting, the DI container, ONDC domain code, and the
beta pin. And, again, not the source.

---

## 4. tmaestrini/mcp-typescript-sample (Entra ID / OAuth) — **auth shape only**

- **Solves:** an MCP server as an OAuth Resource Server against Microsoft Entra ID, with a matching interactive client.
- **Active:** yes, but built on the v1-era SDK.
- **Licence:** MIT — reuse permitted.
- **Reduces complexity here:** no. It is useful as a *target picture*, not as code to import now.

**Patterns noted for the future OIDC step:**

1. Resource Server posture: validate inbound JWTs via the provider's **JWKS**
   endpoint — signature, issuer, expiry, and a required custom scope
   (`mcp:tools`). This is one implementation of our `TokenVerifier` interface.
2. An `AuthContext` object carried through the request pipeline rather than
   headers being re-read at each layer — the same idea as our `ActorContext`.

**Do not copy:** the entire client half — browser auth flow,
`TokenAcquisitionHelper`, Ollama/OpenAI integration, CLI streaming, interactive
prompts. The brief says so and the reading confirms it: none of it is server
infrastructure. Also do not copy its v1-era SDK usage.

**Honest gap:** the repo does not clearly document how the verified identity
reaches individual tool handlers, which is the one question we most needed
answered. The SDK's `bearer-auth` and `scoped-tools` examples answer it better.

---

## 5. event-driven-io/emmett — **concepts only; licence blocks use**

- **Solves:** event sourcing in Node.js — `decide`/`evolve`, command handling,
  projections, swappable event stores (Postgres, EventStoreDB, SQLite, in-memory).
- **Active:** yes, ~535 stars, pushed 2026-09-03.
- **Licence:** **none applied.** The README carries an open RFC stating the
  intended licence is *"AGPLv3 and/or SSPL"* under an open-core model. Either
  outcome is incompatible with this repo, and today there is no grant at all.
  **Cannot be used as a dependency and cannot be copied.**
- **Reduces complexity here:** it would have, and cannot.

**Concepts adopted (ideas, not code):**

1. **`evolve(state, event) => state`** as the only way state advances — our
   `projections.ts` is a fold of exactly this shape.
2. **The event store as a narrow port** (`append` / `read` by stream), so
   in-memory and durable stores are interchangeable. Our `EventRepository` is
   two methods for this reason.

**Do not copy:** anything textual. The two ideas above are standard
event-sourcing vocabulary predating Emmett; we implement them in about forty
lines against our own event union, which is smaller than the adapter we would
need to fit Emmett's generics anyway.

---

## 6. compdemocracy/polis — **adjacent, deliberately rejected**

- **Solves:** large-scale open-ended feedback — statistical clustering of
  opinion across thousands of participants.
- **Active:** yes (~1.2k stars, pushed 2026-07-28).
- **Licence:** AGPL-3.0 — copyleft; would relicense this repo.
- **Reduces complexity here:** no.

**Why rejected beyond the licence:** Polis answers *"what does the crowd think?"*
by finding consensus clusters. br-ai-nstorm answers *"what does this group
currently understand, and where does it disagree?"* — and **consensus scoring is
an explicit non-goal**. Polis's core value (flattening many opinions into
groups) is the exact operation this project refuses to perform on conflicts.

**One idea worth remembering:** Polis surfaces *divisive* statements as
first-class output rather than noise to be smoothed away. That instinct matches
our "conflict is part of knowledge, not an error state" — arrived at from a very
different direction.

---

## 7. W3C PROV-O — **vocabulary, not code**

- **Solves:** a standard way to say who or what is responsible for a thing.
- **Active/stable:** a W3C Recommendation; stable.
- **Licence:** W3C document licence; we are borrowing distinctions, not text.
- **Reduces complexity here:** yes — it stops us inventing provenance
  vocabulary and, more usefully, tells us *which distinctions are load-bearing*.

**Adopted distinctions:**

| PROV-O | br-ai-nstorm |
|---|---|
| `prov:Entity` | a contribution |
| `prov:Agent` | a participant, or an AI acting for one |
| `prov:wasAttributedTo` | `authoredBy` — who is responsible for the content |
| `prov:wasGeneratedBy` | `preparedBy` — what activity produced the text (e.g. an LLM) |
| `prov:actedOnBehalfOf` | the AI-prepared → human-submitted delegation chain |
| `prov:qualifiedAttribution` | the provenance envelope carrying role + timestamp, rather than one flat author string |

That last row is the important one: PROV-O's reason for *qualified* attribution
is that a single `wasAttributedTo` edge cannot express the role an agent played.
This is the same reason the brief refuses to collapse "AI prepared" into "human
authored" — so our `Provenance` object is a qualified attribution by another
name, and the concept has been load-bearing in a standard for a decade.

**Do not adopt:** RDF, OWL, triple stores, JSON-LD serialisation. The
distinctions are the value; the encoding is not.

---

## Negative results — recorded so they are not re-searched

Searches across GitHub for *provenance-aware knowledge graph systems*,
*decision-log / conflict-graph systems*, *event-sourced TypeScript collaboration
systems*, *human-review curation queues* and *contribution/provenance schemas*
returned, after filtering, only personal projects with 0–2 stars created within
the last few months. Nothing with a stable API, a community, or a licence worth
depending on.

Two conclusions:

1. **There is no mature reference implementation of what br-ai-nstorm is.** The
   domain core has to be ours. That is an argument for keeping it *small*, not
   for building infrastructure around it.
2. **The mature, borrowable prior art is all in the plumbing** — MCP transport
   and identity (SDK), test harnesses (SDK + template), event-sourcing shape
   (Emmett, conceptually), provenance vocabulary (PROV-O). We borrow the
   plumbing and write the ontology.

## Tooling chosen, and why

| Choice | Why | Licence |
|---|---|---|
| `@modelcontextprotocol/server@2.0.0` | already a dependency; factory + stdio + HTTP from one registration | MIT |
| `@modelcontextprotocol/node@2.0.0` | `toNodeHandler` — mounts the MCP handler on plain `node:http`, no framework | MIT |
| `@modelcontextprotocol/client@2.0.0` (dev) | real protocol client for `InMemoryTransport` tests | MIT |
| `vitest` (dev) | already a Vite project; both templates use it; no extra toolchain | MIT |
| `zod@4` | already a dependency; the SDK's schema path | MIT |

**Deliberately not added:** Express, Fastify, pino, Postgres, a migration tool,
Kafka, Neo4j, Redis, an ORM, a DI container. Each was considered against the ten
proof points and none of them is required by any of them.
