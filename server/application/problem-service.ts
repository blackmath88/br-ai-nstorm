/**
 * Read side: canonical state, and the participant-facing derivations the
 * "one eyesight" UI needs — what changed, what happened to my contributions,
 * and what is still unresolved.
 *
 * These derivations used to be hardcoded arrays in `src/data/problems.ts`.
 * They are now computed from the event log, so they are true by construction.
 */
import type {
  ConflictRecord, ContributionKind, ContributionRecord, ContributionSource, CurationProposal,
  Endorsement, EvaluationRecord, ProblemRecord, ProblemState, RelationRecord,
} from '../domain/types.js'
import type { MemoryEvent } from '../domain/events.js'
import { projectProblems } from '../domain/projections.js'
import { openConflicts } from '../domain/conflicts.js'
import type { ActorContext } from '../auth/actor-context.js'
import { notFound } from '../domain/errors.js'
import { loadState, loadStateAndEvents, byTimeThenId, withDefaultOrchestration, type ServiceDeps } from './support.js'

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

/**
 * A contribution without its body. Enough to see the shape of the problem and
 * to decide which full texts are worth reading.
 */
export interface CompactContribution {
  id: string
  kind: ContributionKind
  label: string
  status: ContributionRecord['status']
  authoredBy: string
  preparedBy?: string
  source: ContributionSource
  endorsement: Endorsement
  createdAt: string
  /** Length of the omitted content, so a reader knows what a full read costs. */
  contentLength: number
}

/**
 * The cheap read for LLM clients. Labels and ids instead of full texts; only
 * pending proposals; evaluations counted rather than listed. A participant's
 * model reads this, then fetches the handful of full texts it needs.
 */
export interface CompactState {
  detail: 'compact'
  problem: ProblemRecord
  contributions: CompactContribution[]
  relations: RelationRecord[]
  conflicts: ConflictRecord[]
  pendingProposals: CurationProposal[]
  evaluationCounts: Record<string, Partial<Record<EvaluationRecord['stance'], number>>>
}

export interface ProblemService {
  list(): Promise<ProblemRecord[]>
  getState(problemId: string): Promise<ProblemState>
  getEvents(problemId: string): Promise<MemoryEvent[]>
  getConflicts(problemId: string): Promise<{ open: ConflictRecord[]; all: ConflictRecord[] }>
  getUpdates(problemId: string, actor: ActorContext, since?: string): Promise<ProblemUpdates>
  getMyContributions(problemId: string, actor: ActorContext): Promise<ContributionRecord[]>
  getCompactState(problemId: string): Promise<CompactState>
  /**
   * A cheap change token for one problem: clients poll this and re-read only
   * when it moves. Counts this problem's events, so activity elsewhere in the
   * room does not trigger a refresh.
   */
  getVersion(problemId: string): Promise<{ problemId: string; version: number }>
  getContributions(problemId: string, ids: string[]): Promise<{ contributions: ContributionRecord[]; missing: string[] }>
}

/** Upper bound on full texts fetched in one call, so "on demand" stays bounded. */
export const MAX_CONTRIBUTIONS_PER_FETCH = 20

export function compactState(state: ProblemState): CompactState {
  const evaluationCounts: CompactState['evaluationCounts'] = {}
  for (const evaluation of state.evaluations) {
    const counts = (evaluationCounts[evaluation.targetId] ??= {})
    counts[evaluation.stance] = (counts[evaluation.stance] ?? 0) + 1
  }
  return {
    detail: 'compact',
    problem: state.problem,
    contributions: state.contributions.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      status: c.status,
      authoredBy: c.provenance.authoredBy,
      ...(c.provenance.preparedBy ? { preparedBy: c.provenance.preparedBy } : {}),
      source: c.provenance.source,
      endorsement: c.provenance.endorsement,
      createdAt: c.createdAt,
      contentLength: c.content.length,
    })),
    relations: state.relations,
    conflicts: state.conflicts,
    pendingProposals: state.proposals.filter((p) => p.status === 'pending'),
    evaluationCounts,
  }
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
    case 'ConflictResolved': {
      const conflict = state.conflicts.find((c) => c.id === event.objectId)
      const pair = conflict
        ? `${labelOf(state, conflict.leftObjectId)} ↔ ${labelOf(state, conflict.rightObjectId)}`
        : event.objectId
      return {
        title: p.action === 'resolve' ? 'Conflict resolved' : 'Conflict dismissed',
        detail: `${pair} · ${String(p.note ?? '')}`,
      }
    }
    case 'OrchestrationModeChanged':
      return {
        title: 'Orchestration changed',
        detail: `${String(p.from)} → ${String(p.to)}${p.reason ? ` · ${String(p.reason)}` : ''}`,
      }
    default:
      return { title: event.eventType, detail: '' }
  }
}

const MAX_JUDGEMENT_PROMPTS = 3

/**
 * Prompts derived from what people have flagged: evidence someone asked for,
 * and claims more than one person doubts. Orchestration from the group's own
 * judgements rather than from a model's.
 */
export function judgementPrompts(state: ProblemState): string[] {
  const active = new Map(state.contributions.filter((c) => c.status === 'active').map((c) => [c.id, c]))
  const byTarget = new Map<string, { needs: number; doubt: number }>()
  for (const e of state.evaluations) {
    if (!active.has(e.targetId)) continue
    const entry = byTarget.get(e.targetId) ?? { needs: 0, doubt: 0 }
    if (e.stance === 'needs_evidence') entry.needs += 1
    if (e.stance === 'doubtful') entry.doubt += 1
    byTarget.set(e.targetId, entry)
  }
  const ranked = [...byTarget]
    .filter(([, c]) => c.needs > 0 || c.doubt > 1)
    .sort(([a, x], [b, y]) => y.needs + y.doubt - (x.needs + x.doubt) || a.localeCompare(b))
    .slice(0, MAX_JUDGEMENT_PROMPTS)
  return ranked.map(([id, c]) =>
    c.needs > 0
      ? `Evidence wanted (${c.needs}): “${active.get(id)!.label}” — what would support or refute it?`
      : `${c.doubt} people doubt “${active.get(id)!.label}” — what would change their minds?`,
  )
}

export function createProblemService(deps: ServiceDeps): ProblemService {
  return {
    async list() {
      return projectProblems(await deps.repository.read()).map((problem) => withDefaultOrchestration(deps, problem))
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

    async getVersion(problemId) {
      // One counter lookup, not a log read: every open tab calls this every few seconds.
      const version = await deps.repository.version(problemId)
      if (version === 0) throw notFound('Problem', problemId)
      return { problemId, version }
    },

    async getCompactState(problemId) {
      return compactState(await loadState(deps, problemId))
    },

    async getContributions(problemId, ids) {
      const state = await loadState(deps, problemId)
      const wanted = [...new Set(ids)].slice(0, MAX_CONTRIBUTIONS_PER_FETCH)
      const byId = new Map(state.contributions.map((c) => [c.id, c]))
      return {
        contributions: wanted.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        missing: wanted.filter((id) => !byId.has(id)),
      }
    },

    async getUpdates(problemId, actor, since) {
      const { state, events } = await loadStateAndEvents(deps, problemId)
      const threshold = since ? Date.parse(since) : Number.NEGATIVE_INFINITY
      const sorted = [...events].sort(byTimeThenId)

      const updates: UpdateItem[] = sorted
        .filter((event) => (Number.isNaN(threshold) ? true : Date.parse(event.timestamp) > threshold))
        // "Since you were here" is about what other people did — including
        // what other people's agents did, but not what your own agent did.
        .filter((event) => event.actorId !== actor.actorId)
        .filter((event) => (event.payload as { onBehalfOf?: unknown }).onBehalfOf !== actor.actorId)
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
        const judgements = state.evaluations.filter((e) => e.targetId === contribution.id)
        if (judgements.length > 0) {
          const counts = new Map<string, number>()
          for (const e of judgements) counts.set(e.stance, (counts.get(e.stance) ?? 0) + 1)
          impact.push(
            [...counts].map(([stance, n]) => `${n} ${stance.replace('_', ' ')}`).join(' · '),
          )
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
        thinkNext: [...state.problem.thinkNext, ...judgementPrompts(state)],
      }
    },
  }
}
