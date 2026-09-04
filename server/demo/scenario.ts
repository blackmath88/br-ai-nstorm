/**
 * A scripted multi-participant story, for exercising the room by hand.
 *
 * The point of this file is that it drives the **real application services**
 * with real `ActorContext`s — not hand-written events. Two consequences:
 *
 *   - the demo data cannot express anything the domain would refuse, so it can
 *     never drift into a state the app could not have reached on its own;
 *   - the curation proposals here are produced by the actual curator, not
 *     fabricated, so what you review is what the system really thinks.
 *
 * It exists because the seed alone leaves the interesting surfaces empty: no
 * conflicts, no proposals, nothing superseded, nothing AI-prepared. You had to
 * hand-type text that happened to trip the curator before you could see any of
 * it.
 */
import type { Services } from '../container.js'
import type { Clock } from '../domain/events.js'
import type { ActorContext } from '../auth/actor-context.js'
import type { ContributionRecord, CurationProposal } from '../domain/types.js'

/** Marks everything this scenario writes, so a re-run can detect itself. */
export const DEMO_TAG = 'demo:v0.3'

/**
 * A clock that walks forward from a starting point, so the timeline and the
 * "since you were here" feed look like a story that happened over days rather
 * than a single instant.
 */
export function steppedClock(startMsAgo: number, stepMs: number): Clock {
  let tick = 0
  const start = Date.now() - startMsAgo
  return { now: () => new Date(start + tick++ * stepMs).toISOString() }
}

export const days = (n: number) => n * 24 * 60 * 60 * 1000
export const hours = (n: number) => n * 60 * 60 * 1000

export interface DemoReport {
  contributions: number
  proposalsRaised: number
  proposalsAccepted: number
  proposalsRejected: number
  proposalsPending: number
  conflictsOpen: number
  superseded: number
  evaluations: number
  perProblem: Array<{ problemId: string; contributions: number; conflicts: number; pending: number }>
}

interface Cast {
  achim: ActorContext
  kai: ActorContext
  lea: ActorContext
  mara: ActorContext
}

/** Picks the first pending proposal of a kind, if the curator raised one. */
const pick = (proposals: CurationProposal[], kind: CurationProposal['kind']): CurationProposal | undefined =>
  proposals.find((p) => p.kind === kind)

export async function hasRun(services: Services): Promise<boolean> {
  const events = await services.repository.read()
  return events.some(
    (event) =>
      event.eventType === 'ContributionAdded' &&
      typeof (event.payload as { provenance?: { sourceDetail?: string } }).provenance?.sourceDetail === 'string' &&
      (event.payload as { provenance: { sourceDetail: string } }).provenance.sourceDetail.includes(DEMO_TAG),
  )
}

export async function runDemoScenario(services: Services): Promise<DemoReport> {
  const actor = async (name: string) => services.auth.verify(services.auth.issueStable(name))
  const cast: Cast = {
    achim: await actor('Achim'),
    kai: await actor('Kai'),
    lea: await actor('Lea'),
    mara: await actor('Mara'),
  }

  const raised: CurationProposal[] = []
  const added: ContributionRecord[] = []

  const contribute = async (
    who: ActorContext,
    problemId: string,
    content: string,
    extra: Parameters<Services['contributions']['add']>[1] extends infer T
      ? T extends { problemId: string; content: string }
        ? Partial<Omit<T, 'problemId' | 'content'>>
        : never
      : never = {},
  ) => {
    const result = await services.contributions.add(who, {
      problemId,
      content,
      sourceDetail: DEMO_TAG,
      ...extra,
    })
    added.push(result.contribution)
    raised.push(...result.proposals)
    return result
  }

  // ---------------------------------------------------------------------
  // campus-ai — the fully populated problem
  // ---------------------------------------------------------------------
  const P = 'campus-ai'

  // Kai pushes back on the open-source branch. This overlaps the seeded
  // "OSS ≠ service ownership" tension and carries a contradiction cue, so the
  // curator should raise a conflict for review.
  const kaiPushback = await contribute(
    cast.kai,
    P,
    'Open sourcing the core does not create service ownership, however the shared-service plan assumes it will.',
  )

  // Lea restates the overlapping-needs evidence with a source. Deliberately
  // high lexical overlap (measured at 0.78 against the seeded evidence) so the
  // curator raises a duplicate for someone to judge.
  await contribute(
    cast.lea,
    P,
    'Several institutions describe similar governance and AI-service needs in strategy papers.',
    { kind: 'evidence' },
  )

  // Mara sharpens the shared-service approach. Moderate overlap — a possible
  // relation rather than a duplicate.
  await contribute(
    cast.mara,
    P,
    'A shared service across several institutions needs one accountable owner with a budget line.',
    { kind: 'approach' },
  )

  // Achim brings back something he worked out with an AI. Note that the model
  // is recorded as `preparedBy`, so this shows up as authored-by-Achim,
  // drafted-by-a-model, and NOT endorsed.
  await contribute(
    cast.achim,
    P,
    'Three funding shapes seem possible: per-seat contribution, central grant with matched institutional share, ' +
      'or a consortium fee scaled by student numbers. None has been costed.',
    {
      kind: 'approach',
      source: 'external_llm',
      preparedBy: 'ai:external-llm',
    },
  )

  // Lea contributes the way an MCP client does.
  await contribute(cast.lea, P, 'Two institutions already publish operating cost figures we could use as a baseline.', {
    kind: 'evidence',
    source: 'mcp',
  })

  // Kai asks the question the funding branch keeps circling.
  const kaiQuestion = await contribute(
    cast.kai,
    P,
    'Who signs for the recurring operating cost once the build funding runs out?',
  )

  // Mara names an untested assumption.
  await contribute(
    cast.mara,
    P,
    'We assume institutions actually want operational coupling rather than just a shared codebase.',
    { kind: 'assumption' },
  )

  // --- review: some accepted, some rejected, some left pending -----------

  let accepted = 0
  let rejected = 0

  // Achim accepts the conflict Kai's pushback raised. This is the moment
  // something becomes canonical, and it takes a person.
  const conflictProposal = pick(raised, 'conflict')
  if (conflictProposal) {
    await services.curation.accept(cast.achim, { problemId: P, proposalId: conflictProposal.id })
    accepted += 1
  }

  // Lea accepts a relation.
  const relationProposal = pick(
    raised.filter((p) => p.id !== conflictProposal?.id),
    'relation',
  )
  if (relationProposal) {
    await services.curation.accept(cast.lea, { problemId: P, proposalId: relationProposal.id })
    accepted += 1
  }

  // Mara declines the duplicate — the two statements are close in wording but
  // she judges them to be making different points. A rejection is a decision,
  // and it stays in the history.
  const duplicateProposal = pick(raised, 'duplicate')
  if (duplicateProposal) {
    await services.curation.reject(cast.mara, {
      problemId: P,
      proposalId: duplicateProposal.id,
      reason: 'Close wording, but one is about need and the other about evidence for that need.',
    })
    rejected += 1
  }

  // --- fresh proposals, deliberately left unreviewed --------------------
  //
  // These come AFTER the reviews above, so their proposals stay pending. It
  // matters that the leftover queue has variety: the first draft of this
  // scenario reviewed the only conflict and the only duplicate, so everything
  // still pending was a reclassification and you could not exercise the
  // "Accept conflict" or "Record as related" paths at all.

  // Overlaps the seeded assumption and carries a contradiction cue, so this
  // leaves a conflict waiting for someone to judge (measured at 0.80).
  await contribute(
    cast.lea,
    P,
    'The shared-service model assumes institutions want operational coupling, but two of them have said they do not.',
  )

  // Mara asks a question the group already has, phrased slightly differently —
  // the everyday case duplicate detection is actually for (measured at 0.90).
  await contribute(
    cast.mara,
    P,
    'What does shared product ownership actually mean across institutions, in practice?',
  )

  // --- supersession: Kai revises his own question ------------------------

  const kaiRevision = await contribute(
    cast.kai,
    P,
    'Who signs for the recurring operating cost after year three, and against which budget?',
  )
  await services.contributions.supersede(cast.kai, {
    problemId: P,
    contributionId: kaiQuestion.contribution.id,
    supersededBy: kaiRevision.contribution.id,
    reason: 'Sharpened after the funding discussion; the original was too vague to answer.',
  })

  // --- evaluations -------------------------------------------------------

  await services.contributions.evaluate(cast.lea, {
    problemId: P,
    targetId: kaiPushback.contribution.id,
    stance: 'useful',
    note: 'This is the distinction the whole ownership branch was missing.',
  })
  await services.contributions.evaluate(cast.achim, {
    problemId: P,
    targetId: kaiRevision.contribution.id,
    stance: 'needs_evidence',
    note: 'Needs an actual number before anyone can sign anything.',
  })

  // ---------------------------------------------------------------------
  // basel-heat — lighter, so switching problems shows a different shape
  // ---------------------------------------------------------------------
  const B = 'basel-heat'

  await contribute(
    cast.mara,
    B,
    'Shade mapping data already exists for some walking corridors and is openly licensed.',
    { kind: 'evidence', source: 'mcp' },
  )
  // Overlaps the seeded "cool transit stops" approach and carries a
  // contradiction cue, so the curator raises both a relation and a conflict —
  // and nobody reviews them, which is the point: this problem's queue has work
  // waiting in it.
  await contribute(
    cast.achim,
    B,
    'Cooling interventions at transit waiting locations would help, however they conflict with the parking reduction schedule.',
  )
  await contribute(cast.lea, B, 'Who owns the decision when a cooling measure and a mobility measure collide?')

  // Left entirely unreviewed: this problem is the "queue has work in it" case.

  // research-onboarding is deliberately left as pure seed, so there is also a
  // quiet problem to look at — empty states matter too.

  // ---------------------------------------------------------------------

  const perProblem = []
  let conflictsOpen = 0
  let pending = 0
  let superseded = 0
  let evaluations = 0

  for (const problem of await services.problems.list()) {
    const state = await services.problems.getState(problem.id)
    const open = state.conflicts.filter((c) => c.status === 'open').length
    const problemPending = state.proposals.filter((p) => p.status === 'pending').length
    conflictsOpen += open
    pending += problemPending
    superseded += state.contributions.filter((c) => c.status === 'superseded').length
    evaluations += state.evaluations.length
    perProblem.push({
      problemId: problem.id,
      contributions: state.contributions.length,
      conflicts: open,
      pending: problemPending,
    })
  }

  return {
    contributions: added.length,
    proposalsRaised: raised.length,
    proposalsAccepted: accepted,
    proposalsRejected: rejected,
    proposalsPending: pending,
    conflictsOpen,
    superseded,
    evaluations,
    perProblem,
  }
}
