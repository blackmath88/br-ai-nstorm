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
