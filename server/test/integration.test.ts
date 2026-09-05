/**
 * The decisive test for v0.3.
 *
 * One shared room, three participants, two transports, one canonical memory:
 *
 *   1. Kai contributes the way React does — over HTTP.
 *   2. the contribution gets deterministic actor and timestamp.
 *   3. the curator proposes a relation/conflict.
 *   4. Achim reviews and accepts it.
 *   5. the accepted conflict is visible to the React read path.
 *   6. Lea connects through MCP.
 *   7. Lea retrieves the same canonical problem state.
 *   8. Lea contributes via MCP.
 *   9. React sees Lea's contribution.
 *  10. history shows the full provenance chain.
 *
 * Both transports are driven against ONE `Services` instance. If any layer knew
 * which transport it was serving, this file could not be written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, structured, type Harness } from './harness.js'
import type {
  ConflictRecord, ContributionRecord, CurationProposal, ProblemState,
} from '../domain/types.js'
import type { MemoryEvent } from '../domain/events.js'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})
afterEach(async () => {
  await harness.close()
})

const CONFLICTING =
  'Open sourcing the core does not create service ownership, however the shared-service plan assumes it will.'

describe('React ↔ backend ↔ MCP', () => {
  it('carries one contribution through the whole room, with provenance intact', async () => {
    const kaiToken = harness.token('Kai')
    const achimToken = harness.token('Achim')

    // 1 — Kai contributes the way React does: POST with a bearer token.
    const posted = await harness.http<{ contribution: ContributionRecord; proposals: CurationProposal[] }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      { token: kaiToken, body: { content: CONFLICTING } },
    )
    expect(posted.status).toBe(201)
    const kaiContribution = posted.body.contribution

    // 2 — deterministic actor and timestamp, taken from the token, not the body.
    expect(kaiContribution.provenance.authoredBy).toBe('person:kai')
    expect(kaiContribution.provenance.submittedBy).toBe('person:kai')
    expect(kaiContribution.provenance.source).toBe('direct')
    expect(Date.parse(kaiContribution.createdAt)).not.toBeNaN()
    expect(kaiContribution.id).toMatch(/^contrib_\d{6}$/)

    // 3 — the curator proposes; nothing is canonical yet.
    const proposal = posted.body.proposals.find((p) => p.kind === 'conflict')
    expect(proposal, 'the deterministic curator should propose a conflict here').toBeDefined()
    expect(proposal!.proposedBy).toMatch(/^curator:/)
    expect(proposal!.status).toBe('pending')
    const beforeReview = await harness.http<{ open: ConflictRecord[] }>(
      'GET',
      '/api/problems/campus-ai/conflicts',
      { token: kaiToken },
    )
    expect(beforeReview.body.open).toHaveLength(0)

    // 4 — Achim reviews and accepts.
    const accepted = await harness.http<{ proposal: CurationProposal; conflict: ConflictRecord }>(
      'POST',
      `/api/curation/${proposal!.id}/accept`,
      { token: achimToken, body: { problemId: 'campus-ai' } },
    )
    expect(accepted.status).toBe(200)
    expect(accepted.body.proposal.reviewedBy).toBe('person:achim')
    const conflict = accepted.body.conflict

    // 5 — the accepted conflict is visible on the React read path.
    const afterReview = await harness.http<{ open: ConflictRecord[] }>(
      'GET',
      '/api/problems/campus-ai/conflicts',
      { token: kaiToken },
    )
    expect(afterReview.body.open.map((c) => c.id)).toContain(conflict.id)
    expect(afterReview.body.open[0].detectedBy).toMatch(/^curator:/)
    expect(afterReview.body.open[0].reviewedBy).toBe('person:achim')

    // 6 + 7 — Lea connects over MCP and sees the same canonical state.
    const lea = await harness.mcp('Lea')
    const leaState = structured<ProblemState & { conflicts: ConflictRecord[] }>(
      await lea.callTool({ name: 'get_problem_state', arguments: { problemId: 'campus-ai' } }),
    )
    const httpState = await harness.http<ProblemState>('GET', '/api/problems/campus-ai', { token: kaiToken })

    expect(leaState.contributions.map((c) => c.id).sort()).toEqual(
      httpState.body.contributions.map((c) => c.id).sort(),
    )
    expect(leaState.conflicts.map((c) => c.id)).toContain(conflict.id)
    // Lea sees Kai's contribution attributed to Kai, not flattened.
    expect(leaState.contributions.find((c) => c.id === kaiContribution.id)?.provenance.authoredBy).toBe('person:kai')

    // 8 — Lea contributes through MCP.
    const leaResult = structured<{ contribution: ContributionRecord }>(
      await lea.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'Two institutions already publish operating cost figures we could use as a baseline.',
          kind: 'evidence',
        },
      }),
    )
    expect(leaResult.contribution.provenance.authoredBy).toBe('person:lea')
    expect(leaResult.contribution.provenance.source).toBe('mcp')

    // 9 — React sees Lea's contribution.
    const reactState = await harness.http<ProblemState>('GET', '/api/problems/campus-ai', { token: kaiToken })
    const seenByReact = reactState.body.contributions.find((c) => c.id === leaResult.contribution.id)
    expect(seenByReact).toBeDefined()
    expect(seenByReact!.provenance.authoredBy).toBe('person:lea')
    expect(seenByReact!.kind).toBe('evidence')

    // ...and it shows up in Kai's "since you were here", because it is not his.
    const updates = await harness.http<{ updates: Array<{ objectId: string; actorId: string }> }>(
      'GET',
      '/api/problems/campus-ai/updates',
      { token: kaiToken },
    )
    expect(updates.body.updates.some((u) => u.objectId === leaResult.contribution.id)).toBe(true)

    // 10 — the history carries the full provenance chain.
    const history = await harness.http<{ events: MemoryEvent[] }>('GET', '/api/problems/campus-ai/events', {
      token: kaiToken,
    })
    const events = history.body.events

    const added = events.find((e) => e.eventType === 'ContributionAdded' && e.objectId === kaiContribution.id)
    const proposed = events.find((e) => e.eventType === 'ConflictProposed' && e.objectId === proposal!.id)
    const acceptedEvent = events.find((e) => e.eventType === 'ConflictAccepted' && e.objectId === conflict.id)
    const leaAdded = events.find((e) => e.eventType === 'ContributionAdded' && e.objectId === leaResult.contribution.id)

    expect(added?.actorId).toBe('person:kai')
    // The proposal is attributed to the curator, so the log never implies Kai
    // proposed a conflict against his own statement.
    expect(proposed?.actorId).toMatch(/^curator:/)
    // ...and it is causally linked to the contribution that triggered it.
    expect(proposed?.causationId).toBe(added?.id)
    expect(proposed?.correlationId).toBe(added?.correlationId)
    expect(acceptedEvent?.actorId).toBe('person:achim')
    expect(leaAdded?.actorId).toBe('person:lea')

    // Chronology is intact and the log only ever grew.
    const order = events.map((e) => e.timestamp)
    expect([...order].sort()).toEqual(order)
    expect(events.filter((e) => e.eventType === 'ContributionAdded').length).toBeGreaterThanOrEqual(2)
  })

  it('serves the same canonical state to HTTP and MCP after every mutation', async () => {
    const token = harness.token('Mara')
    const mara = await harness.mcp('Mara')

    const compare = async () => {
      const viaHttp = await harness.http<ProblemState>('GET', '/api/problems/basel-heat', { token })
      const viaMcp = structured<ProblemState>(
        await mara.callTool({ name: 'get_problem_state', arguments: { problemId: 'basel-heat' } }),
      )
      expect(viaMcp.contributions).toEqual(viaHttp.body.contributions)
      expect(viaMcp.relations).toEqual(viaHttp.body.relations)
      expect(viaMcp.conflicts).toEqual(viaHttp.body.conflicts)
    }

    await compare()
    await harness.http('POST', '/api/problems/basel-heat/contributions', {
      token,
      body: { content: 'Shade mapping data exists for three districts already.' },
    })
    await compare()
    await mara.callTool({
      name: 'propose_contribution',
      arguments: { problemId: 'basel-heat', content: 'Cooling corridors conflict with the parking reduction schedule.' },
    })
    await compare()
  })

  it('keeps four participants distinct in one room', async () => {
    const clients = await Promise.all([
      harness.mcp('Achim'),
      harness.mcp('Kai'),
      harness.mcp('Lea'),
      harness.mcp('Mara'),
    ])
    const names = ['Achim', 'Kai', 'Lea', 'Mara']

    // Sequential, so the deterministic clock gives each a distinct timestamp.
    for (const [index, client] of clients.entries()) {
      await client.callTool({
        name: 'propose_contribution',
        arguments: { problemId: 'research-onboarding', content: `${names[index]} has a distinct view on onboarding.` },
      })
    }

    const state = await harness.services.problems.getState('research-onboarding')
    const authors = state.contributions
      .filter((c) => c.provenance.source === 'mcp')
      .map((c) => c.provenance.authoredBy)
      .sort()

    expect(authors).toEqual(['person:achim', 'person:kai', 'person:lea', 'person:mara'])
  })
})
