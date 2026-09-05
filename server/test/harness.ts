/**
 * Test harness.
 *
 * One `Services` instance can be driven through HTTP and MCP at the same time,
 * which is the whole claim of the transport-independence decision — if any
 * layer knew its transport, this file could not exist.
 *
 * Everything is deterministic: a fixed clock, a counter-based id source and an
 * in-memory event log, so the same commands always produce the same events.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { buildServices, type Services } from '../container.js'
import { createIdSource, type Clock } from '../domain/events.js'
import { createMemoryRepository } from '../persistence/json-repository.js'
import { createPrototypeAuth } from '../auth/prototype-auth.js'
import { nullCurator, type Curator } from '../curation/ai-curator.js'
import { createApi } from '../http/api.js'
import { createBrainstormServer } from '../mcp/create-server.js'
import type { ActorContext } from '../auth/actor-context.js'

/** Advances one second per call, so event order is unambiguous and reproducible. */
export function fixedClock(startIso = '2026-09-01T09:00:00.000Z'): Clock {
  let tick = 0
  const start = Date.parse(startIso)
  return { now: () => new Date(start + tick++ * 1000).toISOString() }
}

export interface Harness {
  services: Services
  /** Base URL of the in-process REST server, for assertions on raw responses. */
  baseUrl: string
  /** Signs in a participant and returns their bearer token. */
  token(participant: string): string
  actor(participant: string): Promise<ActorContext>
  /** REST call with a bearer token. */
  http<T = unknown>(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown },
  ): Promise<{ status: number; body: T }>
  /** An MCP client wired to a server instance for one participant. */
  mcp(participant: string): Promise<Client>
  close(): Promise<void>
}

export async function createHarness(options: { curator?: Curator; seed?: boolean } = {}): Promise<Harness> {
  const services = await buildServices({
    repository: createMemoryRepository(),
    clock: fixedClock(),
    ids: createIdSource(),
    auth: createPrototypeAuth({ deterministicTokens: true }),
    curator: options.curator ?? nullCurator,
    ...(options.seed === false ? { seed: false } : {}),
  })

  const api = createApi(services, { enablePrototypeAuth: true })
  const server: Server = createServer((req, res) => {
    api(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  const clients: Client[] = []

  return {
    services,
    baseUrl: base,

    token: (participant) => services.auth.issueStable(participant),

    actor: (participant) => services.auth.verify(services.auth.issueStable(participant)),

    async http(method, path, opts = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      })
      const text = await response.text()
      return { status: response.status, body: (text ? JSON.parse(text) : {}) as never }
    },

    async mcp(participant) {
      const actor = await services.auth.verify(services.auth.issueStable(participant))
      const mcpServer = createBrainstormServer(services, actor)
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: `test-${participant}`, version: '0.0.0' })
      await mcpServer.connect(serverTransport)
      await client.connect(clientTransport)
      clients.push(client)
      return client
    },

    async close() {
      for (const client of clients) await client.close().catch(() => undefined)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** Reads a tool result's `structuredContent`, failing loudly on an error result. */
export function structured<T = Record<string, unknown>>(result: unknown): T {
  const value = result as { structuredContent?: unknown; isError?: boolean; content?: Array<{ text?: string }> }
  if (value.isError) throw new Error(`Tool returned an error: ${value.content?.[0]?.text ?? 'unknown'}`)
  return value.structuredContent as T
}

/** Reads an error result's structured body, failing if the call unexpectedly succeeded. */
export function structuredError(result: unknown): { error: string; message: string } {
  const value = result as { structuredContent?: unknown; isError?: boolean }
  if (!value.isError) throw new Error('Expected an error result, got a success result.')
  return value.structuredContent as { error: string; message: string }
}
