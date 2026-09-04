/**
 * MCP adapter tests.
 *
 * These run a real `@modelcontextprotocol/client` against a real server
 * instance over `InMemoryTransport`, so the full protocol stack is exercised
 * in-process — the pattern the official SDK and the reference template both use.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, structured, structuredError, type Harness } from './harness.js'
import { TOOL_NAMES } from '../mcp/register-tools.js'
import type { ConflictRecord, ContributionRecord, CurationProposal, ProblemRecord } from '../domain/types.js'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})
afterEach(async () => {
  await harness.close()
})

describe('tool surface', () => {
  it('exposes exactly the v0.3 tool set', async () => {
    const client = await harness.mcp('Achim')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
  })

  it('declares an input and an output schema for every tool', async () => {
    const client = await harness.mcp('Achim')
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} inputSchema`).toBeDefined()
      // outputSchema is what lets a client validate structuredContent.
      expect(tool.outputSchema, `${tool.name} outputSchema`).toBeDefined()
      expect(tool.description, `${tool.name} description`).toBeTruthy()
    }
  })

  it('marks read tools as read-only and write tools as not', async () => {
    const client = await harness.mcp('Achim')
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('get_problem_state')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('propose_contribution')?.annotations?.readOnlyHint).toBe(false)
  })
})

describe('structured output', () => {
  it('returns both a text block and structuredContent', async () => {
    const client = await harness.mcp('Achim')
    const result = (await client.callTool({ name: 'list_problems', arguments: {} })) as {
      content: Array<{ type: string; text: string }>
      structuredContent: { problems: ProblemRecord[] }
    }
    expect(result.content[0].type).toBe('text')
    // The text block is the serialised structured payload, per the spec's SHOULD.
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
    expect(result.structuredContent.problems.map((p) => p.id)).toContain('campus-ai')
  })

  it('returns canonical state with provenance and conflict vocabulary', async () => {
    const client = await harness.mcp('Lea')
    const state = structured<{
      contributions: ContributionRecord[]
      conflicts: ConflictRecord[]
      conflictTypes: Record<string, string>
    }>(await client.callTool({ name: 'get_problem_state', arguments: { problemId: 'campus-ai' } }))

    expect(state.contributions.length).toBeGreaterThan(0)
    expect(state.contributions[0].provenance.authoredBy).toBeTruthy()
    // The taxonomy travels with the state so a model is told what a conflict means here.
    expect(Object.keys(state.conflictTypes)).toContain('knowledge_conflict')
  })
})

describe('actor attribution', () => {
  it('attributes a contribution to the connection’s participant', async () => {
    const client = await harness.mcp('Lea')
    const result = structured<{ contribution: ContributionRecord }>(
      await client.callTool({
        name: 'propose_contribution',
        arguments: { problemId: 'campus-ai', content: 'Operating cost has never been estimated for year three.' },
      }),
    )
    expect(result.contribution.provenance.authoredBy).toBe('person:lea')
    expect(result.contribution.provenance.source).toBe('mcp')
  })

  it('gives two participants distinct attribution on the same problem', async () => {
    const leaClient = await harness.mcp('Lea')
    const maraClient = await harness.mcp('Mara')

    const lea = structured<{ contribution: ContributionRecord }>(
      await leaClient.callTool({
        name: 'propose_contribution',
        arguments: { problemId: 'campus-ai', content: 'Lea: the funding question splits into build and run.' },
      }),
    )
    const mara = structured<{ contribution: ContributionRecord }>(
      await maraClient.callTool({
        name: 'propose_contribution',
        arguments: { problemId: 'campus-ai', content: 'Mara: local instances reduce coupling but multiply operations.' },
      }),
    )

    expect(lea.contribution.provenance.authoredBy).toBe('person:lea')
    expect(mara.contribution.provenance.authoredBy).toBe('person:mara')

    const mine = structured<{ actorId: string; contributions: ContributionRecord[] }>(
      await leaClient.callTool({ name: 'get_my_contributions', arguments: { problemId: 'campus-ai' } }),
    )
    expect(mine.actorId).toBe('person:lea')
    expect(mine.contributions.map((c) => c.id)).toContain(lea.contribution.id)
    expect(mine.contributions.map((c) => c.id)).not.toContain(mara.contribution.id)
  })

  it('keeps "AI prepared" separate from "human authored"', async () => {
    const client = await harness.mcp('Lea')
    const result = structured<{ contribution: ContributionRecord }>(
      await client.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'A model drafted this summary of the funding branch.',
          preparedBy: 'ai:test-model',
        },
      }),
    )
    expect(result.contribution.provenance.authoredBy).toBe('person:lea')
    expect(result.contribution.provenance.preparedBy).toBe('ai:test-model')
    expect(result.contribution.provenance.endorsement).toBe('participant_review_required')
  })
})

describe('round trip', () => {
  it('retrieves a contribution it just proposed', async () => {
    const client = await harness.mcp('Mara')
    const created = structured<{ contribution: ContributionRecord }>(
      await client.callTool({
        name: 'propose_contribution',
        arguments: { problemId: 'campus-ai', content: 'Governance without a budget line is a wish, not a plan.' },
      }),
    )
    const state = structured<{ contributions: ContributionRecord[] }>(
      await client.callTool({ name: 'get_problem_state', arguments: { problemId: 'campus-ai' } }),
    )
    const found = state.contributions.find((c) => c.id === created.contribution.id)
    expect(found?.content).toBe('Governance without a budget line is a wish, not a plan.')
  })
})

describe('review through MCP', () => {
  it('accepts a proposal and makes the conflict visible to get_conflicts', async () => {
    const kai = await harness.mcp('Kai')
    const achim = await harness.mcp('Achim')

    const created = structured<{ proposals: CurationProposal[] }>(
      await kai.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'Open sourcing the core does not create service ownership, however the plan assumes it will.',
        },
      }),
    )
    const proposal = created.proposals.find((p) => p.kind === 'conflict')
    expect(proposal).toBeDefined()

    const reviewed = structured<{ proposal: CurationProposal; conflict: ConflictRecord | null }>(
      await achim.callTool({
        name: 'review_curation_proposal',
        arguments: { problemId: 'campus-ai', proposalId: proposal!.id, accept: true },
      }),
    )
    expect(reviewed.proposal.reviewedBy).toBe('person:achim')
    expect(reviewed.conflict?.status).toBe('open')

    const conflicts = structured<{ open: ConflictRecord[] }>(
      await kai.callTool({ name: 'get_conflicts', arguments: { problemId: 'campus-ai' } }),
    )
    expect(conflicts.open.map((c) => c.id)).toContain(reviewed.conflict!.id)
  })
})

describe('error behaviour', () => {
  it('reports an unknown problem as an in-band error result, not a thrown fault', async () => {
    const client = await harness.mcp('Achim')
    const result = await client.callTool({ name: 'get_problem_state', arguments: { problemId: 'does-not-exist' } })
    const body = structuredError(result)
    expect(body.error).toBe('not_found')
    expect(body.message).toMatch(/not found/)
  })

  it('reports a domain rule violation in-band', async () => {
    const kai = await harness.mcp('Kai')
    const achim = await harness.mcp('Achim')
    const created = structured<{ proposals: CurationProposal[] }>(
      await kai.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'Open sourcing the core does not create service ownership, however the plan assumes it will.',
        },
      }),
    )
    const proposal = created.proposals[0]
    await achim.callTool({
      name: 'review_curation_proposal',
      arguments: { problemId: 'campus-ai', proposalId: proposal.id, accept: true },
    })
    const second = await achim.callTool({
      name: 'review_curation_proposal',
      arguments: { problemId: 'campus-ai', proposalId: proposal.id, accept: false },
    })
    expect(structuredError(second).error).toBe('invalid')
  })

  it('rejects schema-invalid arguments before reaching the domain', async () => {
    const client = await harness.mcp('Achim')
    const result = await client.callTool({
      name: 'propose_contribution',
      arguments: { problemId: 'campus-ai', content: '' },
    })
    expect((result as { isError?: boolean }).isError).toBe(true)
  })
})
