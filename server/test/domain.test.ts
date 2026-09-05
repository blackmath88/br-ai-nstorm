/**
 * Domain tests — the properties the architecture claims, asserted directly.
 */
import { describe, expect, it } from 'vitest'
import { createIdSource, deriveLabel, highWaterMark, makeEvent, type MemoryEvent } from '../domain/events.js'
import { project, projectProblems } from '../domain/projections.js'
import { assertHumanActor, assertMayEdit, assertMayReview } from '../domain/policies.js'
import { assertAcceptableAsConflict, sameConflictPair } from '../domain/conflicts.js'
import { inferKind, proposeDeterministically, similarity } from '../curation/deterministic.js'
import { DomainError } from '../domain/errors.js'
import type { ContributionRecord, CurationProposal } from '../domain/types.js'
import { createHarness, fixedClock } from './harness.js'


const contribution = (over: Partial<ContributionRecord> = {}): ContributionRecord => ({
  id: 'c1',
  problemId: 'p1',
  kind: 'claim',
  label: 'l',
  content: 'content',
  status: 'active',
  visibility: 'problem',
  provenance: {
    authoredBy: 'person:kai',
    submittedBy: 'person:kai',
    source: 'direct',
    endorsement: 'human_endorsed',
    timestamp: '2026-09-01T09:00:00.000Z',
  },
  createdAt: '2026-09-01T09:00:00.000Z',
  ...over,
})

describe('event construction', () => {
  it('produces monotonic, reproducible ids and timestamps', () => {
    const a = makeEvent({ clock: fixedClock(), ids: createIdSource() }, {
      problemId: 'p1', actorId: 'person:kai', objectId: 'o1', eventType: 'ContributionAdded', payload: {},
    })
    const b = makeEvent({ clock: fixedClock(), ids: createIdSource() }, {
      problemId: 'p1', actorId: 'person:kai', objectId: 'o1', eventType: 'ContributionAdded', payload: {},
    })
    // Same inputs, same clock, same ids — the stream is reproducible.
    expect(a).toEqual(b)
    expect(a.id).toBe('evt_000001')
  })

  it('recovers the id high-water mark from an existing log', () => {
    const events = [
      { id: 'evt_000007', objectId: 'contrib_000042', payload: { proposalId: 'proposal_000099' } },
    ] as unknown as MemoryEvent[]
    expect(highWaterMark(events)).toBe(99)
    expect(createIdSource(highWaterMark(events)).next('evt')).toBe('evt_000100')
  })

  it('derives labels on a word boundary', () => {
    expect(deriveLabel('short')).toBe('short')
    expect(deriveLabel('a'.repeat(80))).toHaveLength(57)
    expect(deriveLabel(`${'word '.repeat(20)}`)).toMatch(/…$/)
  })
})

describe('projection', () => {
  it('reconstructs identical state from the same log, twice', async () => {
    const harness = await createHarness()
    const kai = await harness.actor('Kai')
    await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'A fresh claim about ownership.' })
    const events = await harness.services.repository.read('campus-ai')

    const first = project(events)
    const second = project(events)
    expect(first).toEqual(second)
    // And it matches what the service returns through its own read path.
    expect(first).toEqual(await harness.services.problems.getState('campus-ai'))
    await harness.close()
  })

  it('respects event order: the last edit wins', () => {
    const ids = createIdSource()
    const clock = fixedClock()
    const d = { ids, clock }
    const events: MemoryEvent[] = [
      makeEvent(d, { problemId: 'p1', actorId: 'seed:import', objectId: 'p1', eventType: 'ProblemCreated', payload: { title: 'T', shortTitle: 'T', description: '', stateSummary: '', thinkNext: [] } }),
      makeEvent(d, { problemId: 'p1', actorId: 'person:kai', objectId: 'c1', eventType: 'ContributionAdded', payload: { kind: 'claim', label: 'first', content: 'first', visibility: 'problem', provenance: contribution().provenance } }),
      makeEvent(d, { problemId: 'p1', actorId: 'person:kai', objectId: 'c1', eventType: 'ContributionEdited', payload: { content: 'second', label: 'second' } }),
      makeEvent(d, { problemId: 'p1', actorId: 'person:kai', objectId: 'c1', eventType: 'ContributionEdited', payload: { content: 'third', label: 'third' } }),
    ]
    expect(project(events)?.contributions[0].content).toBe('third')
  })

  it('returns undefined for a log with no ProblemCreated', () => {
    expect(project([])).toBeUndefined()
    expect(projectProblems([])).toEqual([])
  })

  it('preserves attribution and the full provenance envelope', async () => {
    const harness = await createHarness()
    const lea = await harness.actor('Lea')
    const { contribution: added } = await harness.services.contributions.add(lea, {
      problemId: 'campus-ai',
      content: 'Drafted with a model, submitted by me.',
      preparedBy: 'ai:test-model',
    })

    const state = await harness.services.problems.getState('campus-ai')
    const stored = state.contributions.find((c) => c.id === added.id)!

    expect(stored.provenance.authoredBy).toBe('person:lea')
    expect(stored.provenance.submittedBy).toBe('person:lea')
    // "AI prepared" is kept distinct from "human authored"...
    expect(stored.provenance.preparedBy).toBe('ai:test-model')
    // ...and is never silently treated as endorsed.
    expect(stored.provenance.endorsement).toBe('participant_review_required')
    await harness.close()
  })

  it('supersession changes status without erasing the contribution or its history', async () => {
    const harness = await createHarness()
    const kai = await harness.actor('Kai')
    const first = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Original position on funding.' })
    const second = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Revised position on funding after new numbers.' })

    const before = (await harness.services.problems.getEvents('campus-ai')).length
    await harness.services.contributions.supersede(kai, {
      problemId: 'campus-ai',
      contributionId: first.contribution.id,
      supersededBy: second.contribution.id,
    })

    const state = await harness.services.problems.getState('campus-ai')
    const superseded = state.contributions.find((c) => c.id === first.contribution.id)!

    expect(superseded.status).toBe('superseded')
    expect(superseded.supersededBy).toBe(second.contribution.id)
    // The content is still there, and history only grew.
    expect(superseded.content).toBe('Original position on funding.')
    expect((await harness.services.problems.getEvents('campus-ai')).length).toBeGreaterThan(before)
    await harness.close()
  })
})

describe('curation lifecycle', () => {
  it('accepting a conflict proposal makes exactly one canonical conflict, reviewed by a person', async () => {
    const harness = await createHarness()
    const kai = await harness.actor('Kai')
    const achim = await harness.actor('Achim')

    const added = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Open sourcing the code does not establish service ownership; however the group keeps assuming it does.',
    })
    const proposal = added.proposals.find((p) => p.kind === 'conflict')
    expect(proposal, 'expected the deterministic curator to propose a conflict').toBeDefined()

    // Before review: proposed, not canonical.
    expect((await harness.services.problems.getConflicts('campus-ai')).all).toHaveLength(0)

    const result = await harness.services.curation.accept(achim, {
      problemId: 'campus-ai',
      proposalId: proposal!.id,
    })

    expect(result.conflict?.status).toBe('open')
    expect(result.conflict?.reviewedBy).toBe('person:achim')
    // The curator is recorded as detector, never as reviewer.
    expect(result.conflict?.detectedBy).toBe('curator:deterministic')

    const conflicts = await harness.services.problems.getConflicts('campus-ai')
    expect(conflicts.open).toHaveLength(1)
    await harness.close()
  })

  it('rejecting a proposal creates no canonical object but is recorded in history', async () => {
    const harness = await createHarness()
    const kai = await harness.actor('Kai')
    const achim = await harness.actor('Achim')
    const added = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Shared product ownership is the bottleneck, but local instances do not solve it either.',
    })
    const proposal = added.proposals[0]
    expect(proposal).toBeDefined()

    await harness.services.curation.reject(achim, { problemId: 'campus-ai', proposalId: proposal.id, reason: 'Different topic.' })

    const state = await harness.services.problems.getState('campus-ai')
    expect(state.proposals.find((p) => p.id === proposal.id)?.status).toBe('rejected')
    expect(state.conflicts).toHaveLength(0)
    expect(
      (await harness.services.problems.getEvents('campus-ai')).some(
        (e) => e.eventType === 'ConflictRejected' || e.eventType === 'RelationRejected',
      ),
    ).toBe(true)
    await harness.close()
  })

  it('a proposal cannot be reviewed twice', async () => {
    const harness = await createHarness()
    const kai = await harness.actor('Kai')
    const achim = await harness.actor('Achim')
    const added = await harness.services.contributions.add(kai, {
      problemId: 'campus-ai',
      content: 'Open source alone does not solve operations, however the codebase is shared.',
    })
    const proposal = added.proposals[0]
    await harness.services.curation.accept(achim, { problemId: 'campus-ai', proposalId: proposal.id })
    await expect(
      harness.services.curation.accept(achim, { problemId: 'campus-ai', proposalId: proposal.id }),
    ).rejects.toThrow(/already been reviewed/)
    await harness.close()
  })
})

describe('policies', () => {
  const asActor = (actorId: string) => ({ actorId, displayName: actorId, scopes: [] })

  it('refuses a curator identity for any canonical mutation', () => {
    expect(() => assertHumanActor(asActor('curator:deterministic'), 'review')).toThrow(DomainError)
    expect(() => assertHumanActor(asActor('person:achim'), 'review')).not.toThrow()
  })

  it('lets only the author edit', () => {
    const item = contribution()
    expect(() => assertMayEdit(asActor('person:kai'), item)).not.toThrow()
    expect(() => assertMayEdit(asActor('person:lea'), item)).toThrow(/Only the author/)
  })

  it('refuses review of an already-decided proposal', () => {
    const proposal = { id: 'x', status: 'accepted' } as CurationProposal
    expect(() => assertMayReview(asActor('person:achim'), proposal)).toThrow(/already been reviewed/)
  })
})

describe('conflict model', () => {
  it('treats a conflict pair as unordered', () => {
    expect(sameConflictPair({ leftObjectId: 'a', rightObjectId: 'b' }, { leftObjectId: 'b', rightObjectId: 'a' })).toBe(true)
    expect(sameConflictPair({ leftObjectId: 'a', rightObjectId: 'b' }, { leftObjectId: 'a', rightObjectId: 'c' })).toBe(false)
  })

  it('refuses to make an incoherent proposal canonical', () => {
    const base = { id: 'p', problemId: 'x', sourceId: 'a', reason: '', confidence: 1, proposedBy: 'curator:deterministic', status: 'pending', createdAt: '' }
    expect(() => assertAcceptableAsConflict({ ...base, kind: 'relation' } as CurationProposal)).toThrow(/not a conflict/)
    expect(() => assertAcceptableAsConflict({ ...base, kind: 'conflict' } as CurationProposal)).toThrow(/no counterpart/)
    expect(() =>
      assertAcceptableAsConflict({ ...base, kind: 'conflict', targetId: 'a', conflictKind: 'knowledge_conflict' } as CurationProposal),
    ).toThrow(/cannot conflict with itself/)
  })
})

describe('deterministic curator', () => {
  it('scores identical text as fully similar and unrelated text as not', () => {
    expect(similarity('shared product ownership matters', 'shared product ownership matters')).toBe(1)
    expect(similarity('shared product ownership', 'tram timetable frequency')).toBe(0)
  })

  it('classifies without a model', () => {
    expect(inferKind('Who owns the service?')).toBe('question')
    expect(inferKind('The survey data shows adoption is flat.')).toBe('evidence')
    expect(inferKind('We assume institutions want this.')).toBe('assumption')
    expect(inferKind('We should build a shared core.')).toBe('approach')
  })

  it('never produces more proposals than a human can review', () => {
    const candidates = Array.from({ length: 40 }, (_, i) =>
      contribution({ id: `c${i}`, content: 'shared product ownership across institutions but not really' }),
    )
    const drafts = proposeDeterministically({
      problemId: 'p1',
      contribution: contribution({ id: 'new', content: 'shared product ownership across institutions but not really' }),
      candidates,
    })
    expect(drafts.length).toBeLessThanOrEqual(8)
  })

  it('proposes and never decides — every draft names a curator, not a person', () => {
    const drafts = proposeDeterministically({
      problemId: 'p1',
      contribution: contribution({ id: 'new', content: 'Open source does not equal service ownership, however.' }),
      candidates: [contribution({ id: 'other', content: 'Open source equals service ownership.' })],
    })
    expect(drafts.length).toBeGreaterThan(0)
    for (const draft of drafts) expect(draft.proposedBy).toMatch(/^curator:/)
  })
})

describe('seed import', () => {
  it('does not invent a person for non-human prototype authors', async () => {
    const harness = await createHarness()
    const state = await harness.services.problems.getState('campus-ai')
    const aiSynthesis = state.contributions.find((c) => c.provenance.preparedBy)!

    expect(aiSynthesis.provenance.authoredBy).toMatch(/^seed:/)
    expect(aiSynthesis.provenance.authoredBy).not.toMatch(/^person:/)
    expect(aiSynthesis.provenance.endorsement).toBe('participant_review_required')
    await harness.close()
  })

  it('is idempotent', async () => {
    const harness = await createHarness()
    const before = (await harness.services.repository.read()).length
    const { ensureSeedData } = await import('../persistence/seed.js')
    await ensureSeedData({ repository: harness.services.repository, clock: fixedClock(), ids: createIdSource(9000) })
    expect((await harness.services.repository.read()).length).toBe(before)
    await harness.close()
  })
})
