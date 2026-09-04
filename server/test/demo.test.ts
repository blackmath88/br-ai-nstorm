/**
 * Guards the demo scenario.
 *
 * The scenario's whole value is that every UI surface has something in it. But
 * it depends on the deterministic curator's thresholds: the first draft of it
 * looked fine and silently produced no duplicate proposal (0.700 against a 0.72
 * threshold) and nothing at all for basel-heat, so two surfaces came out empty
 * and nothing said so.
 *
 * These assertions are the alarm for that.
 */
import { describe, expect, it } from 'vitest'
import { buildServices } from '../container.js'
import { createMemoryRepository } from '../persistence/json-repository.js'
import { createPrototypeAuth } from '../auth/prototype-auth.js'
import { nullCurator } from '../curation/ai-curator.js'
import { createIdSource } from '../domain/events.js'
import { days, hasRun, hours, runDemoScenario, steppedClock, DEMO_TAG } from '../demo/scenario.js'
import type { Services } from '../container.js'

const build = () =>
  buildServices({
    repository: createMemoryRepository(),
    clock: steppedClock(days(7), hours(3)),
    ids: createIdSource(),
    auth: createPrototypeAuth({ deterministicTokens: true }),
    // The AI curator is off, so every proposal below is the deterministic one.
    curator: nullCurator,
  })

const run = async (): Promise<{ services: Services; report: Awaited<ReturnType<typeof runDemoScenario>> }> => {
  const services = await build()
  return { services, report: await runDemoScenario(services) }
}

describe('demo scenario', () => {
  it('leaves every reviewable surface non-empty', async () => {
    const { report } = await run()

    expect(report.contributions, 'contributions added').toBeGreaterThan(8)
    expect(report.proposalsRaised, 'curator proposals').toBeGreaterThan(4)

    // The four surfaces that are empty without it.
    expect(report.conflictsOpen, 'accepted, unresolved conflicts for the State band').toBeGreaterThan(0)
    expect(report.proposalsPending, 'pending proposals for the Curation queue').toBeGreaterThan(0)
    expect(report.proposalsAccepted, 'accepted proposals for the Curation history').toBeGreaterThan(0)
    expect(report.proposalsRejected, 'rejected proposals for the Curation history').toBeGreaterThan(0)
    expect(report.superseded, 'superseded contributions for the State footer').toBeGreaterThan(0)
    expect(report.evaluations, 'evaluations').toBeGreaterThan(0)
  })

  it('gives more than one problem something to review, and leaves one quiet', async () => {
    const { report } = await run()
    const withWork = report.perProblem.filter((p) => p.pending > 0 || p.conflicts > 0)
    const quiet = report.perProblem.filter((p) => p.pending === 0 && p.conflicts === 0)

    expect(withWork.length, 'problems with something to review').toBeGreaterThanOrEqual(2)
    // A quiet problem is deliberate: the empty states need somewhere to show.
    expect(quiet.length, 'at least one untouched problem').toBeGreaterThanOrEqual(1)
  })

  it('gives all four participants their own traces', async () => {
    const { services } = await run()
    for (const name of ['Achim', 'Kai', 'Lea', 'Mara']) {
      const actor = await services.auth.verify(services.auth.issueStable(name))
      const mine = await services.problems.getMyContributions('campus-ai', actor)
      expect(mine.length, `${name} should have contributed to campus-ai`).toBeGreaterThan(0)
    }
  })

  it('records an AI-prepared contribution without collapsing it into human authorship', async () => {
    const { services } = await run()
    const state = await services.problems.getState('campus-ai')
    const prepared = state.contributions.filter(
      (c) => c.provenance.preparedBy && c.provenance.source === 'external_llm',
    )

    expect(prepared.length, 'an AI-drafted contribution to inspect').toBeGreaterThan(0)
    for (const item of prepared) {
      expect(item.provenance.authoredBy).toMatch(/^person:/)
      expect(item.provenance.preparedBy).not.toMatch(/^person:/)
      expect(item.provenance.endorsement).toBe('participant_review_required')
    }
  })

  it('attributes every proposal to a curator and every review to a person', async () => {
    const { services } = await run()
    for (const problem of await services.problems.list()) {
      const state = await services.problems.getState(problem.id)
      for (const proposal of state.proposals) {
        expect(proposal.proposedBy, 'proposals come from curators').toMatch(/^curator:/)
        if (proposal.status !== 'pending') {
          expect(proposal.reviewedBy, 'reviews come from people').toMatch(/^person:/)
        }
      }
      for (const conflict of state.conflicts) {
        expect(conflict.detectedBy).toMatch(/^curator:/)
        expect(conflict.reviewedBy).toMatch(/^person:/)
      }
    }
  })

  it('tags what it wrote, so a second run can refuse instead of duplicating', async () => {
    const services = await build()
    expect(await hasRun(services)).toBe(false)
    await runDemoScenario(services)
    expect(await hasRun(services)).toBe(true)

    const state = await services.problems.getState('campus-ai')
    expect(state.contributions.some((c) => c.provenance.sourceDetail?.includes(DEMO_TAG))).toBe(true)
  })

  it('spreads the story over days rather than one instant', async () => {
    const { services } = await run()
    const events = await services.problems.getEvents('campus-ai')
    const demoEvents = events.filter((e) => Date.parse(e.timestamp) > Date.parse('2026-09-01T00:00:00.000Z'))
    const stamps = demoEvents.map((e) => Date.parse(e.timestamp))

    expect(new Set(stamps).size, 'distinct timestamps').toBeGreaterThan(5)
    expect(Math.max(...stamps) - Math.min(...stamps), 'span in ms').toBeGreaterThan(days(1))
  })
})
