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
  |- /mcp    -> 501 in this visual demo
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

MCP remains on the Node v0.3 runtime for this deployment. `/mcp` on the Worker returns `501` intentionally.

This keeps the deployment focused: first validate the shared-room UX from a real URL. Porting the MCP Streamable HTTP adapter to Workers is a separate transport task and should happen only if the visual/shared-state test warrants it.

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
- deployment does not require changing the domain ontology.

It does **not** validate production authentication, multi-tenant isolation, production storage scale, live push, MCP-on-Workers, autonomous agents or ATProto federation.
