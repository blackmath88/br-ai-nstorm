/**
 * v0.5: finishing the life of an item, liveness, and the field report.
 *
 *  - conflicts can be closed, but only by a person, and only with a note;
 *  - evaluations are one standing judgement per person and feed think-next;
 *  - contributions can be superseded from the room;
 *  - a cheap per-problem version token drives refresh;
 *  - the field report attributes every proposal to its origin and mode.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, structured, type Harness } from './harness.js'
import type { ConflictRecord, ContributionRecord } from '../domain/types.js'
import type { FieldReport } from '../application/report-service.js'
import { buildFieldReport, originOf } from '../application/report-service.js'

let harness: Harness | undefined
afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function acceptedConflict(h: Harness): Promise<ConflictRecord> {
  const kai = await h.actor('Kai')
  const lea = await h.actor('Lea')
  const target = (await h.services.problems.getState('campus-ai')).contributions.find((c) => c.status === 'active')!
  const { proposals } = await h.services.contributions.add(kai, {
    problemId: 'campus-ai',
    content: 'A shared service needs one accountable owner, not a federation.',
    proposals: [{ kind: 'conflict', targetId: target.id, conflictKind: 'decision_conflict', reason: 'Ownership model.' }],
  })
  const mine = proposals.find((p) => p.onBehalfOf)!
  const { conflict } = await h.services.curation.accept(lea, { problemId: 'campus-ai', proposalId: mine.id })
  return conflict!
}

describe('closing a conflict', () => {
  it('requires a person and a note, records who and why, and keeps the record', async () => {
    harness = await createHarness()
    const conflict = await acceptedConflict(harness)
    const mara = await harness.actor('Mara')

    await expect(
      harness.services.curation.resolveConflict(mara, { problemId: 'campus-ai', conflictId: conflict.id, action: 'resolve', note: 'ok' }),
    ).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/how the conflict was resolved/) })
    await expect(
      harness.services.curation.resolveConflict(mara, { problemId: 'campus-ai', conflictId: conflict.id, action: 'merge', note: 'long enough note' }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      harness.services.curation.resolveConflict(
        { actorId: 'curator:deterministic', displayName: 'c', scopes: [] },
        { problemId: 'campus-ai', conflictId: conflict.id, action: 'dismiss', note: 'a curator tries to close it' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const closed = await harness.services.curation.resolveConflict(mara, {
      problemId: 'campus-ai',
      conflictId: conflict.id,
      action: 'resolve',
      note: 'Agreed: one operator, federated governance board.',
    })
    expect(closed).toMatchObject({ status: 'resolved', resolvedBy: mara.actorId, resolutionNote: 'Agreed: one operator, federated governance board.' })

    const state = await harness.services.problems.getState('campus-ai')
    expect(state.conflicts.find((c) => c.id === conflict.id)).toMatchObject({ status: 'resolved', resolvedBy: mara.actorId })
    expect((await harness.services.problems.getConflicts('campus-ai')).open.some((c) => c.id === conflict.id)).toBe(false)

    await expect(
      harness.services.curation.resolveConflict(mara, { problemId: 'campus-ai', conflictId: conflict.id, action: 'dismiss', note: 'changed my mind entirely' }),
    ).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/already resolved/) })

    const kai = await harness.actor('Kai')
    const feed = await harness.services.problems.getUpdates('campus-ai', kai)
    expect(feed.updates.some((u) => u.title === 'Conflict resolved' && u.detail.includes('federated governance'))).toBe(true)
  })

  it('works over HTTP, including dismissal', async () => {
    harness = await createHarness()
    const conflict = await acceptedConflict(harness)
    const res = await harness.http<{ conflict: ConflictRecord }>('POST', `/api/problems/campus-ai/conflicts/${conflict.id}/resolve`, {
      token: harness.token('Achim'),
      body: { action: 'dismiss', note: 'Same position, different wording.' },
    })
    expect(res.status).toBe(200)
    expect(res.body.conflict.status).toBe('dismissed')
  })
})

describe('evaluations', () => {
  it('keep one standing judgement per person, and keep every change in the log', async () => {
    harness = await createHarness()
    const lea = await harness.actor('Lea')
    const target = (await harness.services.problems.getState('campus-ai')).contributions[0]
    await harness.services.contributions.evaluate(lea, { problemId: 'campus-ai', targetId: target.id, stance: 'doubtful' })
    await harness.services.contributions.evaluate(lea, { problemId: 'campus-ai', targetId: target.id, stance: 'useful', note: 'Convinced by the pilot data.' })

    const state = await harness.services.problems.getState('campus-ai')
    const leas = state.evaluations.filter((e) => e.actorId === lea.actorId && e.targetId === target.id)
    expect(leas).toEqual([expect.objectContaining({ stance: 'useful', note: 'Convinced by the pilot data.' })])
    const events = (await harness.services.problems.getEvents('campus-ai')).filter((e) => e.eventType === 'EvaluationAdded')
    expect(events).toHaveLength(2)
  })

  it('reject unknown stances', async () => {
    harness = await createHarness()
    const res = await harness.http('POST', '/api/problems/campus-ai/evaluations', {
      token: harness.token('Lea'),
      body: { targetId: 'campus-ai:q1', stance: 'love' },
    })
    expect(res.status).toBe(422)
  })

  it('turn requests for evidence and shared doubt into think-next prompts, and show on the author’s traces', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const { contribution } = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Students will prefer a university-run model over commercial tools.',
    })
    for (const name of ['Lea', 'Mara']) {
      const who = await harness.actor(name)
      await harness.services.contributions.evaluate(who, { problemId: 'campus-ai', targetId: contribution.id, stance: 'needs_evidence' })
    }
    const achim = await harness.actor('Achim')
    const feed = await harness.services.problems.getUpdates('campus-ai', achim)
    expect(feed.thinkNext.some((p) => p.startsWith('Evidence wanted (2)') && p.includes('Students will prefer'))).toBe(true)

    const kaiFeed = await harness.services.problems.getUpdates('campus-ai', kai)
    const trace = kaiFeed.traces.find((t) => t.contribution.id === contribution.id)!
    expect(trace.impact).toContain('2 needs evidence')
  })

  it('are available to a participant’s AI over MCP', async () => {
    harness = await createHarness()
    const client = await harness.mcp('Mara')
    const target = (await harness.services.problems.getState('campus-ai')).contributions[0]
    const result = structured<{ evaluation: { stance: string; actorId: string } }>(
      await client.callTool({ name: 'evaluate_contribution', arguments: { problemId: 'campus-ai', targetId: target.id, stance: 'needs_evidence' } }),
    )
    expect(result.evaluation).toMatchObject({ stance: 'needs_evidence', actorId: 'person:mara' })
  })
})

describe('superseding from the room', () => {
  it('retires a contribution in favour of another, over HTTP', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const { contribution: older } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Budget: 2 FTE for operations.' })
    const { contribution: newer } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Budget: 3 FTE for operations, including on-call.' })
    const res = await harness.http<{ contribution: ContributionRecord }>(
      'POST',
      `/api/problems/campus-ai/contributions/${older.id}/supersede`,
      { token: harness.token('Lea'), body: { supersededBy: newer.id, reason: 'Revised estimate.' } },
    )
    expect(res.status).toBe(200)
    expect(res.body.contribution).toMatchObject({ status: 'superseded', supersededBy: newer.id })
  })
})

describe('version token', () => {
  it('moves only with this problem’s events', async () => {
    harness = await createHarness()
    const token = harness.token('Lea')
    const v = async (id: string) => (await harness!.http<{ version: number }>('GET', `/api/problems/${id}/version`, { token })).body.version
    const before = await v('campus-ai')
    const lea = await harness.actor('Lea')
    await harness.services.contributions.add(lea, { problemId: 'basel-heat', content: 'Night temperatures matter more than peaks.' })
    expect(await v('campus-ai')).toBe(before)
    await harness.services.contributions.add(lea, { problemId: 'campus-ai', content: 'Operations need an on-call rota.' })
    expect(await v('campus-ai')).toBeGreaterThan(before)
    expect((await harness.http('GET', '/api/problems/nope/version', { token })).status).toBe(404)
  })
})

describe('field report', () => {
  it('attributes proposals to origin and to the mode they were made under', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const lea = await harness.actor('Lea')
    const mara = await harness.actor('Mara')
    const state = await harness.services.problems.getState('campus-ai')
    const [a, b] = state.contributions.filter((c) => c.status === 'active')

    // Participant mode: Kai's AI proposes twice; Lea accepts one, Mara rejects the other.
    const first = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Teaching staff need training before rollout.',
      preparedBy: 'ai:test',
      proposals: [
        { kind: 'relation', targetId: a.id, relationKind: 'supports', reason: 'r1' },
        { kind: 'relation', targetId: b.id, relationKind: 'opens', reason: 'r2' },
      ],
    })
    const agent = first.proposals.filter((p) => p.onBehalfOf)
    await harness.services.curation.accept(lea, { problemId: 'campus-ai', proposalId: agent[0].id })
    await harness.services.curation.reject(mara, { problemId: 'campus-ai', proposalId: agent[1].id })

    // Then deterministic mode.
    await harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'deterministic', reason: 'compare' })
    await harness.services.contributions.add(mara, { problemId: 'campus-ai', content: a.content })

    const report = structured<FieldReport>(
      await (await harness.mcp('Achim')).callTool({ name: 'get_field_report', arguments: { problemId: 'campus-ai' } }),
    )
    expect(report.proposals.byOrigin.participant_ai).toMatchObject({ proposed: 2, accepted: 1, rejected: 1, pending: 0, acceptanceRate: 0.5 })
    expect(report.proposals.byMode.participant?.proposed).toBeGreaterThanOrEqual(2)
    expect(report.proposals.byMode.deterministic?.proposed).toBeGreaterThan(0)
    expect(report.orchestration.history).toEqual([
      expect.objectContaining({ by: 'person:lea', from: 'participant', to: 'deterministic', reason: 'compare' }),
    ])
    const kaiStats = report.participants.find((p) => p.actorId === 'person:kai')!
    expect(kaiStats).toMatchObject({ aiPrepared: 1, agentProposals: 2 })
    expect(report.participants.find((p) => p.actorId === 'person:lea')?.reviews).toBe(1)

    const http = await harness.http<FieldReport>('GET', '/api/problems/campus-ai/report', { token: harness.token('Kai') })
    expect(http.body.proposals.total.proposed).toBe(report.proposals.total.proposed)
  })

  it('classifies origins', () => {
    expect(originOf('agent:ai:claude')).toBe('participant_ai')
    expect(originOf('curator:deterministic')).toBe('deterministic')
    expect(originOf('curator:openai:gpt')).toBe('server_ai')
  })

  it('reports null rates before anything is reviewed', () => {
    const report = buildFieldReport(
      {
        problem: { id: 'p', title: 't', shortTitle: 't', description: '', stateSummary: '', thinkNext: [], createdAt: '', createdBy: '', orchestration: { mode: 'participant' } },
        contributions: [], relations: [], conflicts: [], proposals: [], evaluations: [],
      },
      [],
    )
    expect(report.proposals.total).toMatchObject({ proposed: 0, acceptanceRate: null, medianMinutesToReview: null })
  })
})
