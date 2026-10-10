/**
 * Orchestration modes — who does the AI judgement, and who pays for it.
 *
 * The properties asserted here are the ones the cost model depends on:
 *
 *   - `participant` is the default, and in it the server spends nothing;
 *   - a participant's LLM may propose, but only against real objects, within
 *     bounds, and never for its own participant to accept;
 *   - `api` spends the operator's key, and only after an explicit switch;
 *   - `deterministic` refuses AI proposals and says so;
 *   - every switch is a human act on the record.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, structured, structuredError, type Harness } from './harness.js'
import type { Curator } from '../curation/ai-curator.js'
import type { ContributionRecord, CurationProposal, OrchestrationSetting } from '../domain/types.js'
import type { AddContributionResult } from '../application/contribution-service.js'
import type { ContributionContext } from '../application/orchestration-service.js'
import type { CompactState } from '../application/problem-service.js'
import { CONTEXT_CANDIDATE_LIMIT } from '../domain/policies.js'
import { agentIdFor, rankCandidates } from '../curation/participant.js'

let harness: Harness | undefined
afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** A server curator that records whether it was asked. */
function spyCurator(): Curator & { calls: number } {
  const spy = {
    name: 'curator:spy',
    enabled: true,
    calls: 0,
    async propose({ contribution, candidates, problem }: Parameters<Curator['propose']>[0]) {
      spy.calls += 1
      const target = candidates.find((c) => c.id !== contribution.id && c.status === 'active')
      return target
        ? [{
            problemId: problem.id,
            kind: 'relation' as const,
            sourceId: contribution.id,
            targetId: target.id,
            relationKind: 'relates' as const,
            reason: 'spy',
            confidence: 0.5,
            proposedBy: 'curator:spy',
          }]
        : []
    },
  }
  return spy
}

async function firstContributionId(h: Harness, problemId = 'campus-ai'): Promise<string> {
  const state = await h.services.problems.getState(problemId)
  return state.contributions.find((c) => c.status === 'active')!.id
}

describe('default mode', () => {
  it('opens every problem in participant mode', async () => {
    harness = await createHarness()
    const problems = await harness.services.problems.list()
    expect(problems.length).toBeGreaterThan(0)
    for (const problem of problems) expect(problem.orchestration.mode).toBe('participant')
  })

  it('does not call the server curator in participant mode, even when one is configured', async () => {
    const spy = spyCurator()
    harness = await createHarness({ curator: spy })
    const kai = await harness.actor('Kai')
    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Faculty need a shared AI policy before tools are procured.',
    })
    expect(spy.calls).toBe(0)
    expect(result.curator.mode).toBe('participant')
    expect(result.curator.ai).toBe(0)
  })
})

describe('participant proposals', () => {
  it('records a proposal as made by the participant’s agent, on their behalf', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const target = await firstContributionId(harness)

    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Procurement cannot wait for a policy; pilots generate the evidence a policy needs.',
      preparedBy: 'ai:claude',
      proposals: [{ kind: 'conflict', targetId: target, conflictKind: 'decision_conflict', reason: 'Order of policy vs pilots.', confidence: 0.7 }],
    })

    expect(result.curator.participant).toBe(1)
    expect(result.dropped).toEqual([])
    const proposal = result.proposals.find((p) => p.proposedBy.startsWith('agent:'))!
    expect(proposal).toMatchObject({
      kind: 'conflict',
      targetId: target,
      conflictKind: 'decision_conflict',
      proposedBy: 'agent:ai:claude',
      onBehalfOf: kai.actorId,
      status: 'pending',
    })

    // The event is attributed to the agent, not to Kai.
    const events = await harness.services.problems.getEvents('campus-ai')
    const proposed = events.find((e) => e.objectId === proposal.id)!
    expect(proposed.actorId).toBe('agent:ai:claude')
    expect(proposed.payload).toMatchObject({ onBehalfOf: kai.actorId })

    // And it survives a rebuild from history.
    const state = await harness.services.problems.getState('campus-ai')
    expect(state.proposals.find((p) => p.id === proposal.id)?.onBehalfOf).toBe(kai.actorId)
  })

  it('drops proposals that name objects the model invented, with a reason', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const target = await firstContributionId(harness)

    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'A narrowly scoped pilot is cheaper than a campus-wide licence.',
      proposals: [
        { kind: 'relation', targetId: 'contrib_made_up', relationKind: 'supports', reason: 'x' },
        { kind: 'relation', targetId: target, relationKind: 'supersedes', reason: 'x' },
        { kind: 'relation', targetId: target, reason: '' },
        { kind: 'verdict', targetId: target, reason: 'x' },
        { kind: 'relation', targetId: target, relationKind: 'supports', reason: 'Pilots are an approach to the open question.' },
        { kind: 'relation', targetId: target, relationKind: 'supports', reason: 'again' },
      ],
    })

    expect(result.curator.participant).toBe(1)
    expect(result.dropped.map((d) => d.index)).toEqual([0, 1, 2, 3, 5])
    expect(result.dropped[0].reason).toMatch(/active contribution/)
    expect(result.dropped[1].reason).toMatch(/relationKind/)
    expect(result.dropped[2].reason).toMatch(/reason/)
    expect(result.dropped[4].reason).toMatch(/Duplicate/)
  })

  it('never lets the participant accept their own agent’s proposal — another participant can', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const lea = await harness.actor('Lea')
    const target = await firstContributionId(harness)

    const { proposals } = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Student unions should co-own the evaluation criteria.',
      proposals: [{ kind: 'relation', targetId: target, relationKind: 'supports', reason: 'Governance angle.' }],
    })
    const mine = proposals.find((p) => p.onBehalfOf === kai.actorId)!

    await expect(
      harness.services.curation.accept(kai, { problemId: 'campus-ai', proposalId: mine.id }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    // Rejecting your own model's proposal is just as much self-review.
    await expect(
      harness.services.curation.reject(kai, { problemId: 'campus-ai', proposalId: mine.id }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    // Kai's own agent's work is not news to Kai; it is to Lea.
    const kaiFeed = await harness.services.problems.getUpdates('campus-ai', kai)
    expect(kaiFeed.updates.some((u) => u.objectId === mine.id)).toBe(false)
    const leaFeed = await harness.services.problems.getUpdates('campus-ai', lea)
    expect(leaFeed.updates.some((u) => u.objectId === mine.id)).toBe(true)

    const accepted = await harness.services.curation.accept(lea, { problemId: 'campus-ai', proposalId: mine.id })
    expect(accepted.proposal.reviewedBy).toBe(lea.actorId)
    expect(accepted.relation?.kind).toBe('supports')
  })

  it('sanitises agent ids so a client cannot pose as a person or a curator', () => {
    expect(agentIdFor(undefined)).toBe('agent:participant-llm')
    expect(agentIdFor('person:lea')).toBe('agent:person:lea')
    expect(agentIdFor('curator:deterministic')).toBe('agent:curator:deterministic')
    expect(agentIdFor('  GPT 5 / turbo  ')).toBe('agent:gpt-5-turbo')
  })
})

describe('switching modes', () => {
  it('refuses api mode when no server curator is configured', async () => {
    harness = await createHarness()
    const achim = await harness.actor('Achim')
    await expect(
      harness.services.orchestration.setMode(achim, { problemId: 'campus-ai', mode: 'api' }),
    ).rejects.toMatchObject({ code: 'invalid' })
    const { options } = await harness.services.orchestration.get('campus-ai')
    expect(options.find((o) => o.mode === 'api')?.available).toBe(false)
  })

  it('spends the server key only after an explicit switch to api', async () => {
    const spy = spyCurator()
    harness = await createHarness({ curator: spy })
    const achim = await harness.actor('Achim')
    const kai = await harness.actor('Kai')

    const setting = await harness.services.orchestration.setMode(achim, {
      problemId: 'campus-ai',
      mode: 'api',
      reason: 'Workshop day: operator covers curation.',
    })
    expect(setting).toMatchObject({ mode: 'api', changedBy: achim.actorId, reason: 'Workshop day: operator covers curation.' })

    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Licence costs scale with seats, not with use.',
    })
    expect(spy.calls).toBe(1)
    expect(result.curator).toMatchObject({ mode: 'api', ai: 1 })
    expect(result.proposals.some((p) => p.proposedBy === 'curator:spy')).toBe(true)

    // Other problems are untouched — the mode is per problem.
    await harness.services.contributions.add(kai, { problemId: 'basel-heat', content: 'Shade maps are outdated.' })
    expect(spy.calls).toBe(1)
  })

  it('drops participant proposals in deterministic mode and says why', async () => {
    harness = await createHarness()
    const mara = await harness.actor('Mara')
    const kai = await harness.actor('Kai')
    const target = await firstContributionId(harness)
    await harness.services.orchestration.setMode(mara, { problemId: 'campus-ai', mode: 'deterministic' })

    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Usage data from the pilot should be published.',
      proposals: [{ kind: 'relation', targetId: target, reason: 'x' }],
    })
    expect(result.curator.participant).toBe(0)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].reason).toMatch(/deterministic/)
    // The contribution itself is still durable.
    expect(result.contribution.id).toBeTruthy()
  })

  it('records every switch as a human act in history', async () => {
    harness = await createHarness()
    const lea = await harness.actor('Lea')
    await harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'deterministic', reason: 'No AI today.' })
    await harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'participant' })

    const changes = (await harness.services.problems.getEvents('campus-ai')).filter(
      (e) => e.eventType === 'OrchestrationModeChanged',
    )
    expect(changes.map((e) => e.payload)).toEqual([
      { from: 'participant', to: 'deterministic', reason: 'No AI today.' },
      { from: 'deterministic', to: 'participant' },
    ])
    expect(changes.every((e) => e.actorId === lea.actorId)).toBe(true)

    // The list view reflects the latest mode, not the creation-time default.
    await harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'deterministic' })
    const listed = (await harness.services.problems.list()).find((p) => p.id === 'campus-ai')!
    expect(listed.orchestration.mode).toBe('deterministic')

    // Others see it in "since you were here".
    const kai = await harness.actor('Kai')
    const updates = await harness.services.problems.getUpdates('campus-ai', kai)
    expect(updates.updates.some((u) => u.title === 'Orchestration changed')).toBe(true)
  })

  it('rejects unknown modes and no-op switches, but lets a default be pinned once', async () => {
    harness = await createHarness()
    const lea = await harness.actor('Lea')
    await expect(
      harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'autopilot' }),
    ).rejects.toMatchObject({ code: 'invalid' })
    // Selecting the mode a problem merely defaults to records it explicitly...
    const pinned = await harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'participant' })
    expect(pinned.changedBy).toBe(lea.actorId)
    // ...after which the same selection is a no-op and refused.
    await expect(
      harness.services.orchestration.setMode(lea, { problemId: 'campus-ai', mode: 'participant' }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('contribution context', () => {
  it('is bounded, ranks lexical neighbours first, and is deterministic', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    for (let i = 0; i < 20; i++) {
      await harness.services.contributions.add(kai, { problemId: 'basel-heat', content: `Unrelated note number ${i} about logistics.` })
    }
    await harness.services.contributions.add(kai, {
      problemId: 'basel-heat',
      content: 'Tree canopy cover reduces street temperature on hot afternoons.',
    })

    const draft = 'More tree canopy would cool street temperature.'
    const a = await harness.services.orchestration.context('basel-heat', draft)
    const b = await harness.services.orchestration.context('basel-heat', draft)
    expect(a).toEqual(b)
    expect(a.candidates).toHaveLength(CONTEXT_CANDIDATE_LIMIT)
    expect(a.candidates[0].content).toMatch(/canopy/)
    expect(a.candidates[0].overlap).toBeGreaterThan(0)
    expect(a.orchestration.mode).toBe('participant')
    expect(a.instructions.join(' ')).toMatch(/participant orchestration/)
    expect(a.vocabulary.relationKinds).not.toContain('supersedes')
  })

  it('falls back to recent contributions when nothing overlaps', () => {
    const at = (i: number) => `2026-09-0${i}T00:00:00.000Z`
    const make = (id: string, content: string, i: number) =>
      ({ id, content, status: 'active', createdAt: at(i) }) as ContributionRecord
    const ranked = rankCandidates('zzz', [make('a', 'alpha', 1), make('b', 'beta', 3), make('c', 'gamma', 2)], 2)
    expect(ranked.map((r) => r.contribution.id)).toEqual(['b', 'c'])
  })
})

describe('over MCP', () => {
  it('runs the whole participant loop: context → propose with proposals → another participant accepts', async () => {
    harness = await createHarness()
    const kai = await harness.mcp('Kai')
    const lea = await harness.mcp('Lea')

    const context = structured<ContributionContext>(
      await kai.callTool({
        name: 'get_contribution_context',
        arguments: { problemId: 'campus-ai', draft: 'AI tutoring pilots need an evaluation plan.' },
      }),
    )
    expect(context.orchestration.mode).toBe('participant')
    expect(context.candidates.length).toBeGreaterThan(0)
    const target = context.candidates[0].id

    const added = structured<AddContributionResult>(
      await kai.callTool({
        name: 'propose_contribution',
        arguments: {
          problemId: 'campus-ai',
          content: 'AI tutoring pilots need an evaluation plan before they scale.',
          preparedBy: 'ai:test-model',
          proposals: [{ kind: 'relation', targetId: target, relationKind: 'opens', reason: 'Raises the evaluation question.', confidence: 0.6 }],
        },
      }),
    )
    const mine = added.proposals.find((p: CurationProposal) => p.proposedBy === 'agent:ai:test-model')!
    expect(mine.onBehalfOf).toBe('person:kai')

    const selfReview = await kai.callTool({
      name: 'review_curation_proposal',
      arguments: { problemId: 'campus-ai', proposalId: mine.id, accept: true },
    })
    expect(structuredError(selfReview).error).toBe('forbidden')

    const review = structured<{ relation: { kind: string } }>(
      await lea.callTool({
        name: 'review_curation_proposal',
        arguments: { problemId: 'campus-ai', proposalId: mine.id, accept: true },
      }),
    )
    expect(review.relation.kind).toBe('opens')
  })

  it('serves a compact overview without bodies, and full texts on demand', async () => {
    harness = await createHarness()
    const client = await harness.mcp('Mara')

    const overview = structured<CompactState>(
      await client.callTool({ name: 'get_problem_overview', arguments: { problemId: 'campus-ai' } }),
    )
    expect(overview.detail).toBe('compact')
    expect(overview.contributions.length).toBeGreaterThan(0)
    for (const c of overview.contributions) expect(c).not.toHaveProperty('content')

    const full = structured<{ problem: unknown }>(
      await client.callTool({ name: 'get_problem_state', arguments: { problemId: 'campus-ai' } }),
    )
    // The point of the overview: it is materially smaller than the full read.
    expect(JSON.stringify(overview).length).toBeLessThan(JSON.stringify(full).length)

    const ids = overview.contributions.slice(0, 2).map((c) => c.id)
    const fetched = structured<{ contributions: ContributionRecord[]; missing: string[] }>(
      await client.callTool({ name: 'get_contributions', arguments: { problemId: 'campus-ai', ids: [...ids, 'nope'] } }),
    )
    expect(fetched.contributions.map((c) => c.id)).toEqual(ids)
    expect(fetched.contributions[0].content).toBeTruthy()
    expect(fetched.missing).toEqual(['nope'])
  })
})

describe('over HTTP', () => {
  it('reads and switches the mode, serves context and compact state', async () => {
    harness = await createHarness()
    const token = harness.token('Achim')

    const initial = await harness.http<{ orchestration: OrchestrationSetting; options: Array<{ mode: string; available: boolean }> }>(
      'GET', '/api/problems/campus-ai/orchestration', { token },
    )
    expect(initial.status).toBe(200)
    expect(initial.body.orchestration.mode).toBe('participant')

    const refused = await harness.http('POST', '/api/problems/campus-ai/orchestration', { token, body: { mode: 'api' } })
    expect(refused.status).toBe(422)

    const switched = await harness.http<{ orchestration: OrchestrationSetting }>(
      'POST', '/api/problems/campus-ai/orchestration', { token, body: { mode: 'deterministic', reason: 'offline workshop' } },
    )
    expect(switched.status).toBe(200)
    expect(switched.body.orchestration).toMatchObject({ mode: 'deterministic', changedBy: 'person:achim' })

    const context = await harness.http<ContributionContext>(
      'GET', `/api/problems/campus-ai/context?draft=${encodeURIComponent('policy')}`, { token },
    )
    expect(context.status).toBe(200)
    expect(context.body.orchestration.mode).toBe('deterministic')

    const compact = await harness.http<CompactState>('GET', '/api/problems/campus-ai?detail=compact', { token })
    expect(compact.body.detail).toBe('compact')

    const health = await harness.http<{ orchestration: unknown[] }>('GET', '/health')
    expect(health.body.orchestration).toHaveLength(3)
  })

  it('accepts participant proposals on the REST contribution route', async () => {
    harness = await createHarness()
    const target = await firstContributionId(harness)
    const res = await harness.http<AddContributionResult>('POST', '/api/problems/campus-ai/contributions', {
      token: harness.token('Lea'),
      body: {
        content: 'Exam formats need rethinking regardless of tooling.',
        proposals: [{ kind: 'relation', targetId: target, relationKind: 'relates', reason: 'Same assessment concern.' }],
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.curator.participant).toBe(1)
  })
})

describe('review fixes', () => {
  it('caps all proposals for one contribution at the limit, participant judgement first', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const state = await harness.services.problems.getState('campus-ai')
    const targets = state.contributions.filter((c) => c.status === 'active').slice(0, 8)
    // Echo the targets' own text so the lexical curator has plenty to propose too.
    const content = targets.map((c) => c.content).join(' However, ').slice(0, 7000)
    const lexical = (await import('../curation/deterministic.js')).proposeDeterministically({
      problemId: 'campus-ai',
      contribution: { ...targets[0], id: 'probe', content },
      candidates: state.contributions,
    })
    expect(lexical.length, 'precondition: the lexical curator proposes something').toBeGreaterThan(0)

    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content,
      proposals: targets.map((t) => ({ kind: 'conflict', targetId: t.id, reason: 'Model judgement.' })),
    })
    expect(result.proposals).toHaveLength(8)
    expect(result.proposals.every((p) => p.proposedBy.startsWith('agent:'))).toBe(true)
  })

  it('honours a deployment default until a problem is switched', async () => {
    const { buildTestServices } = await import('../container.js')
    const spy = spyCurator()
    const services = await buildTestServices({ curator: spy, defaultOrchestration: 'api' })
    const kai = await services.auth.verify(services.auth.issueStable('Kai'))
    const achim = await services.auth.verify(services.auth.issueStable('Achim'))

    expect((await services.problems.list()).every((p) => p.orchestration.mode === 'api')).toBe(true)
    await services.contributions.add(kai, { problemId: 'campus-ai', content: 'Seat licences scale badly.' })
    expect(spy.calls).toBe(1)

    await services.orchestration.setMode(achim, { problemId: 'campus-ai', mode: 'participant' })
    await services.contributions.add(kai, { problemId: 'campus-ai', content: 'Usage-based pricing is fairer.' })
    expect(spy.calls).toBe(1)
    expect((await services.problems.list()).find((p) => p.id === 'campus-ai')?.orchestration.mode).toBe('participant')

    // Pinning the default protects a problem from a later change of default.
    await services.orchestration.setMode(achim, { problemId: 'basel-heat', mode: 'api' })
    const after = await buildTestServices({ curator: spy, repository: services.repository, defaultOrchestration: 'deterministic', seed: false })
    const listed = await after.problems.list()
    expect(listed.find((p) => p.id === 'basel-heat')?.orchestration.mode).toBe('api')
    expect(listed.find((p) => p.id === 'research-onboarding')?.orchestration.mode).toBe('deterministic')
  })

  it('reports per-source counts after the cap', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const state = await harness.services.problems.getState('campus-ai')
    const targets = state.contributions.filter((c) => c.status === 'active').slice(0, 8)
    const result = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: targets.map((c) => c.content).join(' However, ').slice(0, 7000),
      proposals: targets.map((t) => ({ kind: 'relation', targetId: t.id, reason: 'Model judgement.' })),
    })
    const { participant, deterministic, ai } = result.curator
    expect(participant + deterministic + ai).toBe(result.proposals.length)
    expect(deterministic).toBe(0)
  })
})
