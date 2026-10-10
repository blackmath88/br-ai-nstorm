# Cloudflare demo deployment

Status: v0.3 visual/shared-room deployment path.

This deployment exists to make the current product usable from a URL. It does **not** replace the Node v0.3 runtime or claim production readiness.

## Shape

```text
browser / React SPA
       |
       | same origin
       v
Cloudflare Worker
  |- /api/*  -> existing application/domain services
  |- /health -> runtime status
  |- /mcp    -> stateless MCP (Streamable HTTP), same tools as Node
  `- assets  -> Vite dist/
       |
       v
SQLite-backed Durable Object
       |
       `- append-only canonical event log
```

The domain/application layers are reused unchanged. Cloudflare adds adapters at the edges:

- `worker/api.ts` — Fetch API transport adapter;
- `worker/durable-repository.ts` — `EventRepository` adapter;
- `worker/durable-event-log.ts` — serialized persistent event log;
- `worker/demo-auth.ts` — stateless demo identity issuer/verifier;
- `worker/mcp.ts` — MCP adapter: bearer gate + the SDK's fetch-shaped `createMcpHandler`;
- `worker/index.ts` — Worker composition and static asset routing.

## Why Durable Objects instead of the local JSON store

The Node dev server serializes writes to one JSON file. A Worker has neither a listening Node server nor durable local disk, and several Worker isolates can execute concurrently.

A Durable Object gives the demo one durable, serialized write boundary. The domain still sees only the existing two-method `EventRepository` port: `append()` and `read()`.

The Durable Object uses SQLite-backed storage as required for new Durable Object namespaces, but the first demo deliberately uses the simple storage API rather than introducing a relational event schema before the prototype needs one.

## Identity warning

The Cloudflare demo deliberately keeps a participant switcher for Achim, Kai, Lea and Mara.

`worker/demo-auth.ts` issues predictable `demo-*` bearer tokens. These are **not credentials**. The adapter exists only so the deployed UI can exercise the real `ActorContext` boundary without in-memory sessions disappearing when an isolate is recycled.

Do not put private, sensitive or real participant data into this deployment. Replace the demo adapter with OIDC before treating the deployment as authenticated.

## MCP

`/mcp` serves the same tool set as the Node runtime, from the same registration
(`server/mcp/register-tools.ts`) and the same actor-bound factory
(`createActorServerFactory` in `server/mcp/create-server.ts`). Only the transport
face differs: the SDK's `createMcpHandler` is fetch-shaped, so the Worker hands it
the `Request` directly (`worker/mcp.ts`).

Deliberately **not** used: Cloudflare's `McpAgent` / a stateful transport inside a
Durable Object. Cloudflare's current guidance marks that path legacy and
recommends a stateless `createMcpHandler` for new servers; the room's state
already lives in the event-log Durable Object, so a second stateful object would
add nothing. In workerd the SDK's export conditions select a JSON-schema
validator that does not need `eval`, so no extra wiring is required.

Connect any MCP client to `https://<worker>/mcp` with
`Authorization: Bearer demo-<name>` (e.g. `demo-lea`). The identity warning above
applies: these tokens are labels, not credentials.

The demo has no curator key, so `api` orchestration is listed but unavailable;
problems run in `participant` mode (the connecting client's model curates) or
`deterministic` mode.

## Storage layout

One key per event (`e:<12-digit sequence>`) plus a `seq` counter, written in
one storage transaction per append. The first version stored the whole log as a
single `events` value, which hits the per-value size limit after a few thousand
events, or after one large repository import. The old value is migrated on first
access. Verified under `wrangler dev` against local state that the old version
wrote. `list()` reads the whole log, which is fine at demo scale. Above that,
the ADR-003 Postgres triggers apply here as well.

## Runtime note: Durable Object stubs are per request

`worker/durable-repository.ts` resolves the Durable Object stub on every
operation. The first version created it once and cached it with the
isolate-scoped services; workerd refuses to let an I/O object created while
serving one request be used by another, so every request after the first failed
with `500` ("Cannot perform I/O on behalf of a different request"). Verified
under `wrangler dev`: the cached version answered `200, 500, 500`; the
per-operation version answers `200, 200, 200`.

## Deploy

Prerequisite: Node/npm and a Cloudflare account.

```bash
npm ci
npx wrangler@latest login
npm run deploy
```

`npm run deploy` runs the existing typecheck + Vite build, then deploys `worker/index.ts` together with `dist/` assets. Wrangler creates the SQLite-backed Durable Object namespace from `wrangler.jsonc` on first deployment.

For a local Cloudflare-runtime preview:

```bash
npm run dev:cloudflare
```

## What this deployment validates

- the React product can run against durable canonical shared state;
- several browser participants can see one event-derived memory;
- refresh/restart does not erase the room;
- the existing provenance/conflict/curation rules survive a different runtime;
- deployment does not require changing the domain ontology;
- external MCP clients can join the same room the browser participants see.

It does **not** validate production authentication, multi-tenant isolation, production storage scale, live push, MCP-on-Workers, autonomous agents or ATProto federation.
