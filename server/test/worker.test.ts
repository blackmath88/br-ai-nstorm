/**
 * The Cloudflare Worker's API and MCP surface, exercised in-process.
 *
 * The Durable Object is replaced by an in-memory stub with the same three
 * methods; everything else — the Worker's fetch router, demo auth, the shared
 * MCP factory and the SDK's fetch-shaped handler — is the real code. A real
 * `@modelcontextprotocol/client` talks to it through a `fetch` that calls the
 * Worker directly, so no port, no wrangler and no network are involved.
 *
 * (Under workerd the SDK resolves a different JSON-schema validator via export
 * conditions; that swap is the SDK's, and is covered by `wrangler deploy
 * --dry-run` rather than here.)
 */
import { describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { MemoryEvent } from '../domain/events.js'
import { handleApi } from '../../worker/api.js'
import { createWorkerMcpHandler } from '../../worker/mcp.js'
import { buildWorkerServices, type WorkerEnv } from '../../worker/services.js'
import type { ContributionContext } from '../application/orchestration-service.js'
import type { AddContributionResult } from '../application/contribution-service.js'
import { TOOL_NAMES } from '../mcp/register-tools.js'
import { structured, structuredError } from './harness.js'

function memoryEnv(): WorkerEnv {
  let events: MemoryEvent[] = []
  const stub = {
    async append(next: MemoryEvent[]) {
      events = [...events, ...next]
    },
    async appendIfEmpty(next: MemoryEvent[]) {
      if (events.length > 0) return false
      events = [...next]
      return true
    },
    async read(problemId?: string) {
      return problemId ? events.filter((e) => e.problemId === problemId) : events
    },
  }
  return {
    EVENT_LOG: { getByName: () => stub },
    ASSETS: { fetch: async () => new Response('asset') },
  }
}

async function worker() {
  const services = await buildWorkerServices(memoryEnv())
  const mcp = createWorkerMcpHandler(services)
  const fetchWorker = (input: string | URL | Request, init?: RequestInit) =>
    handleApi(input instanceof Request ? input : new Request(input, init), services, mcp)

  const connect = async (token: string) => {
    const client = new Client({ name: 'worker-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL('https://demo.example/mcp'), {
      fetch: fetchWorker,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
    await client.connect(transport)
    return client
  }

  return { services, fetchWorker, connect }
}

describe('Worker MCP', () => {
  it('serves the same tool set as the Node runtime', async () => {
    const { connect } = await worker()
    const client = await connect('demo-lea')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
    await client.close()
  })

  it('attributes MCP writes to the token’s participant and enforces the review boundary', async () => {
    const { connect, fetchWorker } = await worker()
    const kai = await connect('demo-kai')
    const lea = await connect('demo-lea')

    const context = structured<ContributionContext>(
      await kai.callTool({ name: 'get_contribution_context', arguments: { problemId: 'campus-ai', draft: 'governance' } }),
    )
    const added = structured<AddContributionResult>(
      await kai.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'A joint steering board needs a budget line of its own.',
          preparedBy: 'ai:worker-test',
          proposals: [{ kind: 'relation', targetId: context.candidates[0].id, relationKind: 'supports', reason: 'Governance needs funding.' }],
        },
      }),
    )
    expect(added.contribution.provenance.authoredBy).toBe('person:kai')
    const mine = added.proposals.find((p) => p.onBehalfOf === 'person:kai')!

    expect(
      structuredError(await kai.callTool({
        name: 'review_curation_proposal',
        arguments: { problemId: 'campus-ai', proposalId: mine.id, accept: true },
      })).error,
    ).toBe('forbidden')
    structured(await lea.callTool({
      name: 'review_curation_proposal',
      arguments: { problemId: 'campus-ai', proposalId: mine.id, accept: true },
    }))

    // The REST read path on the same Worker sees what MCP wrote.
    const res = await fetchWorker('https://demo.example/api/problems/campus-ai', {
      headers: { authorization: 'Bearer demo-mara' },
    })
    const state = (await res.json()) as { relations: Array<{ fromProposalId?: string; createdBy: string }> }
    expect(state.relations.find((r) => r.fromProposalId === mine.id)?.createdBy).toBe('person:lea')

    await kai.close()
    await lea.close()
  })

  it('answers 401 with a bearer challenge when the token is missing or unknown', async () => {
    const { fetchWorker } = await worker()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const res = await fetchWorker('https://demo.example/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body,
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/)
    }
  })

  it('reports MCP availability and orchestration options on /health', async () => {
    const { fetchWorker } = await worker()
    const health = (await (await fetchWorker('https://demo.example/health')).json()) as {
      mcp: string
      orchestration: Array<{ mode: string; available: boolean }>
    }
    expect(health.mcp).toBe('/mcp')
    // No curator key on the demo: API orchestration is offered but unavailable.
    expect(health.orchestration.find((o) => o.mode === 'api')?.available).toBe(false)
  })
})

describe('Worker import route', () => {
  it('imports a repository bundle into the Durable Object log', async () => {
    const { fetchWorker } = await worker()
    const res = await fetchWorker('https://demo.example/api/imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer demo-achim' },
      body: JSON.stringify({
        manifest: { version: 1, repository: 'o/r', problemSpaces: [{ id: 'notes', sources: ['NOTES.md'] }] },
        files: { 'NOTES.md': '# Notes\n\n## Open questions\n\n- Who decides on a hot morning?\n' },
      }),
    })
    expect(res.status).toBe(201)
    const state = await fetchWorker('https://demo.example/api/problems/notes', { headers: { authorization: 'Bearer demo-kai' } })
    const body = (await state.json()) as { contributions: Array<{ kind: string; provenance: { authoredBy: string } }> }
    expect(body.contributions).toEqual([
      expect.objectContaining({ kind: 'question', provenance: expect.objectContaining({ authoredBy: 'repo:o/r' }) }),
    ])
  })
})

describe('Durable Object event log', () => {
  const event = (i: number, problemId = 'p'): MemoryEvent =>
    ({ id: `evt_${i}`, problemId, actorId: 'person:kai', timestamp: '', objectId: `o${i}`, eventType: 'ContributionAdded', payload: {} }) as MemoryEvent

  async function log() {
    const { EventLog } = await import('../../worker/durable-event-log.js')
    const { MemoryStorage } = await import('./support/cloudflare-workers.js')
    const storage = new MemoryStorage()
    return { storage, log: new EventLog({ storage } as never, {} as never) }
  }

  it('stores one key per event, in append order, across batches larger than one put()', async () => {
    const { storage, log: eventLog } = await log()
    await eventLog.append(Array.from({ length: 300 }, (_, i) => event(i)))
    await eventLog.append([event(300, 'q')])
    const all = await eventLog.read()
    expect(all.map((e) => e.id)).toEqual(Array.from({ length: 301 }, (_, i) => `evt_${i}`))
    expect((await eventLog.read('q')).map((e) => e.id)).toEqual(['evt_300'])
    // No single value holds the log.
    expect(storage.data.has('events')).toBe(false)
    expect(storage.puts).toBeGreaterThanOrEqual(3)
  })

  it('migrates the legacy single-value log on first touch, keeping order', async () => {
    const { storage, log: eventLog } = await log()
    storage.data.set('events', [event(1), event(2)])
    await eventLog.append([event(3)])
    expect((await eventLog.read()).map((e) => e.id)).toEqual(['evt_1', 'evt_2', 'evt_3'])
    expect(storage.data.has('events')).toBe(false)
  })

  it('keeps a multi-batch append all-or-nothing', async () => {
    const { storage, log: eventLog } = await log()
    await eventLog.append([event(0)])
    storage.failOnPut = storage.puts + 2 // fail on the second 128-key batch
    await expect(eventLog.append(Array.from({ length: 200 }, (_, i) => event(i + 1)))).rejects.toThrow(/injected/)
    expect((await eventLog.read()).map((e) => e.id)).toEqual(['evt_0'])
    expect(storage.data.get('seq')).toBe(1)
  })

  it('checks for the legacy value once per instance, and migrates atomically', async () => {
    const { storage, log: eventLog } = await log()
    storage.data.set('events', [event(1)])
    await eventLog.read()
    const after = storage.gets
    await eventLog.read()
    await eventLog.read()
    expect(storage.gets).toBe(after)
    expect(storage.data.has('events')).toBe(false)
    expect(storage.data.get('seq')).toBe(1)
  })

  it('appendIfEmpty installs once and only into an empty log', async () => {
    const { log: eventLog } = await log()
    expect(await eventLog.appendIfEmpty([event(1)])).toBe(true)
    expect(await eventLog.appendIfEmpty([event(2)])).toBe(false)
    expect((await eventLog.read()).map((e) => e.id)).toEqual(['evt_1'])
  })
})
