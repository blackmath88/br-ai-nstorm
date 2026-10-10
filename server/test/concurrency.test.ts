/**
 * Optimistic concurrency: read, decide, append-if-unchanged.
 *
 * With three people in a room at once, "two people accept the same proposal in
 * the same second" stops being hypothetical. Each decision is appended only if
 * the log is still the one it was decided on; otherwise it is decided again on
 * fresh state, where it may legitimately fail.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './harness.js'
import { createJsonRepository } from '../persistence/json-repository.js'
import { isStaleWrite } from '../persistence/repository.js'
import type { MemoryEvent } from '../domain/events.js'

let harness: Harness | undefined
afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function pendingConflictProposal(h: Harness): Promise<string> {
  const kai = await h.actor('Kai')
  const state = await h.services.problems.getState('campus-ai')
  const target = state.contributions.find((c) => c.status === 'active')!
  const { proposals } = await h.services.contributions.add(kai, {
    problemId: 'campus-ai',
    content: 'A shared service needs one accountable owner.',
    proposals: [{ kind: 'conflict', targetId: target.id, conflictKind: 'decision_conflict', reason: 'Ownership vs federation.' }],
  })
  return proposals.find((p) => p.onBehalfOf)!.id
}

describe('two people review the same proposal at once', () => {
  it('lets exactly one succeed and tells the other it was already reviewed', async () => {
    harness = await createHarness()
    const proposalId = await pendingConflictProposal(harness)
    const lea = await harness.actor('Lea')
    const mara = await harness.actor('Mara')

    const results = await Promise.allSettled([
      harness.services.curation.accept(lea, { problemId: 'campus-ai', proposalId }),
      harness.services.curation.accept(mara, { problemId: 'campus-ai', proposalId }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toMatchObject({ code: 'invalid', message: expect.stringMatching(/already been reviewed/) })

    const state = await harness.services.problems.getState('campus-ai')
    expect(state.conflicts.filter((c) => c.fromProposalId === proposalId)).toHaveLength(1)
  })

  it('accept racing reject: one decision, recorded once', async () => {
    harness = await createHarness()
    const proposalId = await pendingConflictProposal(harness)
    const lea = await harness.actor('Lea')
    const mara = await harness.actor('Mara')
    await Promise.allSettled([
      harness.services.curation.accept(lea, { problemId: 'campus-ai', proposalId }),
      harness.services.curation.reject(mara, { problemId: 'campus-ai', proposalId }),
    ])
    const events = await harness.services.problems.getEvents('campus-ai')
    const decisions = events.filter(
      (e) => ['ConflictAccepted', 'ConflictRejected'].includes(e.eventType) && (e.payload as { proposalId?: string }).proposalId === proposalId,
    )
    expect(decisions).toHaveLength(1)
  })
})

describe('scoped checks', () => {
  it('are not invalidated by activity on other problems', async () => {
    harness = await createHarness()
    const proposalId = await pendingConflictProposal(harness)
    const lea = await harness.actor('Lea')
    const mara = await harness.actor('Mara')
    let writes = 0
    const repo = harness.services.repository
    const original = repo.version.bind(repo)
    // Every time Lea's review reads the version, someone writes elsewhere.
    repo.version = async (problemId?: string) => {
      const v = await original(problemId)
      if (problemId === 'campus-ai' && writes < 6) {
        writes += 1
        await harness!.services.contributions.add(mara, { problemId: 'basel-heat', content: `Elsewhere ${writes}` })
      }
      return v
    }
    const result = await harness.services.curation.accept(lea, { problemId: 'campus-ai', proposalId })
    expect(result.proposal.status).toBe('accepted')
    expect(writes).toBe(1) // first attempt succeeded despite the concurrent write
  })
})

describe('superseding', () => {
  it('requires an active replacement, so cycles cannot form', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const { contribution: x } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Estimate: 2 FTE.' })
    const { contribution: y } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Estimate: 3 FTE.' })
    await harness.services.contributions.supersede(kai, { problemId: 'campus-ai', contributionId: x.id, supersededBy: y.id })
    // y cannot now be retired in favour of x, which is no longer active...
    await expect(
      harness.services.contributions.supersede(kai, { problemId: 'campus-ai', contributionId: y.id, supersededBy: x.id }),
    ).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/itself superseded/) })
  })

  it('records one of two crossing supersessions, never both', async () => {
    harness = await createHarness()
    const kai = await harness.actor('Kai')
    const lea = await harness.actor('Lea')
    const { contribution: x } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Plan A.' })
    const { contribution: y } = await harness.services.contributions.add(kai, { problemId: 'campus-ai', content: 'Plan B.' })
    await Promise.allSettled([
      harness.services.contributions.supersede(kai, { problemId: 'campus-ai', contributionId: x.id, supersededBy: y.id }),
      harness.services.contributions.supersede(lea, { problemId: 'campus-ai', contributionId: y.id, supersededBy: x.id }),
    ])
    const state = await harness.services.problems.getState('campus-ai')
    const statuses = [x.id, y.id].map((id) => state.contributions.find((c) => c.id === id)!.status)
    expect(statuses.filter((s) => s === 'active')).toHaveLength(1)
  })
})

describe('overlapping imports', () => {
  it('append each unit once, even when both runs planned against an empty problem', async () => {
    harness = await createHarness()
    const achim = await harness.actor('Achim')
    const kai = await harness.actor('Kai')
    const bundle = {
      manifest: { version: 1, repository: 'o/r', problemSpaces: [{ id: 'notes', sources: ['NOTES.md'] }] },
      files: { 'NOTES.md': '# Notes\n\n## Ideas\n\n- Route people to cool rooms by tram.\n- Phone people who live alone.\n' },
    }
    await Promise.all([harness.services.imports.apply(achim, bundle), harness.services.imports.apply(kai, bundle)])
    const events = await harness.services.problems.getEvents('notes')
    expect(events.filter((e) => e.eventType === 'ProblemCreated')).toHaveLength(1)
    expect(events.filter((e) => e.eventType === 'ContributionAdded')).toHaveLength(2)
  })
})

describe('JSON file store', () => {
  it('rejects a stale append and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brainstorm-'))
    try {
      const repo = createJsonRepository({ file: join(dir, 'log.json') })
      const event = (id: string) => ({ id, problemId: 'p', actorId: 'person:kai', timestamp: '', objectId: id, eventType: 'ContributionAdded', payload: {} }) as MemoryEvent
      await repo.append([event('a')], { ifVersion: 0 })
      const error = await repo.append([event('b')], { ifVersion: 0 }).catch((e: unknown) => e)
      expect(isStaleWrite(error)).toBe(true)
      expect((await repo.read()).map((e) => e.id)).toEqual(['a'])
      expect(await repo.version()).toBe(1)
      // Unconditional appends still work as before.
      await repo.append([event('c')])
      expect(await repo.version()).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
