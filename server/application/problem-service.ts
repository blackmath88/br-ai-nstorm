/**
 * Read side: canonical state, and the participant-facing derivations the
 * "one eyesight" UI needs — what changed, what happened to my contributions,
 * and what is still unresolved.
 *
 * These derivations used to be hardcoded arrays in `src/data/problems.ts`.
 * They are now computed from the event log, so they are true by construction.
 */
import type {
  ConflictRecord, ContributionRecord, CurationProposal, ProblemRecord, ProblemState,
} from '../domain/types.js'
import type { MemoryEvent } from '../domain/events.js'
import { projectProblems } from '../domain/projections.js'
import { openConflicts } from '../domain/conflicts.js'
import type { ActorContext } from '../auth/actor-context.js'
import { loadState, loadStateAndEvents, byTimeThenId, type ServiceDeps } from './support.js'

export interface UpdateItem {
  eventId: string
  timestamp: string
  actorId: string
  title: string
  detail: string
  objectId: string
  eventType: MemoryEvent['eventType']
}

export interface TraceItem {
  contribution: ContributionRecord
  /** What has happened to this contribution since it was added. */
  impact: string[]
  relatedConflicts: ConflictRecord[]
  pendingProposals: CurationProposal[]
}

export interface ProblemUpdates {
  since: string | null
  updates: UpdateItem[]
  traces: TraceItem[]
  unresolvedConflicts: ConflictRecord[]
  pendingProposals: CurationProposal[]
  thinkNext: string[]
}

export interface ProblemService {
  list(): Promise<ProblemRecord[]>
  getState(problemId: string): Promise<ProblemState>
  getEvents(problemId: string): Promise<MemoryEvent[]>
  getConflicts(problemId: string): Promise<{ open: ConflictRecord[]; all: ConflictRecord[] }>
  getUpdates(problemId: string, actor: ActorContext, since?: string): Promise<ProblemUpdates>
  getMyContributions(problemId: string, actor: ActorContext): Promise<ContributionRecord[]>
}

const labelOf = (state: ProblemState, id: string): string =>
  state.contributions.find((c) => c.id === id)?.label ?? id

function describe(event: MemoryEvent, state: ProblemState): { title: string; detail: string } {
  const p = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'ProblemCreated':
      return { title: 'Problem opened', detail: String(p.title ?? '') }
    case 'ContributionAdded':
      return { title: `New ${String(p.kind ?? 'contribution')}`, detail: String(p.label ?? '') }
    case 'ContributionEdited':
      return { title: 'Contribution edited', detail: labelOf(state, event.objectId) }
    case 'ContributionSuperseded':
      return { title: 'Contribution superseded', detail: labelOf(state, event.objectId) }
    case 'VisibilityChanged':
      return { title: 'Visibility changed', detail: `${labelOf(state, event.objectId)} → ${String(p.to)}` }
    case 'RelationProposed':
      return { title: 'Relation proposed', detail: String(p.reason ?? '') }
    case 'ConflictProposed':
      return { title: 'Conflict proposed', detail: String(p.reason ?? '') }
    case 'RelationAccepted':
      return {
        title: 'Relation accepted',
        detail: `${labelOf(state, String(p.sourceId))} ${String(p.relationKind)} ${labelOf(state, String(p.targetId))}`,
      }
    case 'ConflictAccepted':
      return {
        title: 'Conflict accepted',
        detail: `${labelOf(state, String(p.leftObjectId))} ↔ ${labelOf(state, String(p.rightObjectId))}`,
      }
    case 'RelationRejected':
      return { title: 'Relation proposal rejected', detail: 'A proposed relation was declined on review.' }
    case 'ConflictRejected':
      return { title: 'Conflict proposal rejected', detail: 'A proposed conflict was declined on review.' }
    case 'EvaluationAdded':
      return { title: 'Evaluation added', detail: `${String(p.stance)} · ${labelOf(state, String(p.targetId))}` }
    default:
      return { title: event.eventType, detail: '' }
  }
}

export function createProblemService(deps: ServiceDeps): ProblemService {
  return {
    async list() {
      return projectProblems(await deps.repository.read())
    },

    async getState(problemId) {
      return loadState(deps, problemId)
    },

    async getEvents(problemId) {
      const events = await deps.repository.read(problemId)
      return [...events].sort(byTimeThenId)
    },

    async getConflicts(problemId) {
      const state = await loadState(deps, problemId)
      return { open: openConflicts(state.conflicts), all: state.conflicts }
    },

    async getMyContributions(problemId, actor) {
      const state = await loadState(deps, problemId)
      return state.contributions.filter((c) => c.provenance.authoredBy === actor.actorId)
    },

    async getUpdates(problemId, actor, since) {
      const { state, events } = await loadStateAndEvents(deps, problemId)
      const threshold = since ? Date.parse(since) : Number.NEGATIVE_INFINITY
      const sorted = [...events].sort(byTimeThenId)

      const updates: UpdateItem[] = sorted
        .filter((event) => (Number.isNaN(threshold) ? true : Date.parse(event.timestamp) > threshold))
        // "Since you were here" is about what other people did.
        .filter((event) => event.actorId !== actor.actorId)
        .map((event) => ({
          eventId: event.id,
          timestamp: event.timestamp,
          actorId: event.actorId,
          objectId: event.objectId,
          eventType: event.eventType,
          ...describe(event, state),
        }))
        .reverse()

      const mine = state.contributions.filter((c) => c.provenance.authoredBy === actor.actorId)

      const traces: TraceItem[] = mine.map((contribution) => {
        const relations = state.relations.filter(
          (r) => r.sourceId === contribution.id || r.targetId === contribution.id,
        )
        const conflicts = state.conflicts.filter(
          (c) => c.leftObjectId === contribution.id || c.rightObjectId === contribution.id,
        )
        const proposals = state.proposals.filter(
          (p) => p.status === 'pending' && (p.sourceId === contribution.id || p.targetId === contribution.id),
        )

        const impact: string[] = []
        for (const relation of relations) {
          const other = relation.sourceId === contribution.id ? relation.targetId : relation.sourceId
          impact.push(`${relation.kind} → ${labelOf(state, other)}`)
        }
        for (const conflict of conflicts) {
          const other = conflict.leftObjectId === contribution.id ? conflict.rightObjectId : conflict.leftObjectId
          impact.push(`${conflict.status} ${conflict.conflictType} with ${labelOf(state, other)}`)
        }
        if (contribution.status === 'superseded') {
          impact.push(`superseded by ${labelOf(state, contribution.supersededBy ?? '')}`)
        }
        if (proposals.length > 0) {
          impact.push(`${proposals.length} proposal${proposals.length === 1 ? '' : 's'} awaiting review`)
        }
        if (impact.length === 0) impact.push('No responses yet.')

        return { contribution, impact, relatedConflicts: conflicts, pendingProposals: proposals }
      })

      return {
        since: since ?? null,
        updates,
        traces,
        unresolvedConflicts: openConflicts(state.conflicts),
        // The curation queue is shared: anyone in the room may review anything.
        pendingProposals: state.proposals.filter((p) => p.status === 'pending'),
        thinkNext: state.problem.thinkNext,
      }
    },
  }
}
