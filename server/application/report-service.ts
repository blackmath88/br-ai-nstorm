/**
 * The field-test report: the numbers the next validation round needs.
 *
 * The cost model behind orchestration modes only holds if participants' own
 * models curate about as well as the server's. This report answers that from
 * the log: for each origin of proposals (a participant's AI, the server's AI,
 * lexical matching), how many were proposed, how many people accepted, and how
 * long review took — plus who took part through which channel.
 *
 * Everything is derived from events; nothing is stored. Pure apart from the
 * one read.
 */
import type { MemoryEvent } from '../domain/events.js'
import type { CurationProposal, OrchestrationMode, ProblemState } from '../domain/types.js'
import { DEFAULT_ORCHESTRATION_MODE } from '../domain/types.js'
import { AGENT_PREFIX, isParticipant } from '../domain/policies.js'
import { DETERMINISTIC_CURATOR } from '../curation/deterministic.js'
import { loadStateAndEvents, type ServiceDeps } from './support.js'

export type ProposalOrigin = 'participant_ai' | 'server_ai' | 'deterministic'

export interface DecisionStats {
  proposed: number
  pending: number
  accepted: number
  rejected: number
  /** accepted / (accepted + rejected); null until something was reviewed. */
  acceptanceRate: number | null
  /** Median time from proposal to review, in minutes; null until something was reviewed. */
  medianMinutesToReview: number | null
}

export interface ParticipantStats {
  actorId: string
  contributions: number
  /** Contributions whose text an AI drafted (`preparedBy` set). */
  aiPrepared: number
  bySource: Record<string, number>
  /** Proposals this person's own AI attached to their contributions. */
  agentProposals: number
  reviews: number
  evaluations: number
}

export interface FieldReport {
  problemId: string
  title: string
  orchestration: {
    current: OrchestrationMode
    history: Array<{ at: string; by: string; from: OrchestrationMode; to: OrchestrationMode; reason?: string }>
  }
  proposals: {
    total: DecisionStats
    byOrigin: Record<ProposalOrigin, DecisionStats>
    /** Proposals grouped by the problem's mode at the moment they were made. */
    byMode: Partial<Record<OrchestrationMode, DecisionStats>>
  }
  participants: ParticipantStats[]
  conflicts: { accepted: number; open: number; resolved: number; dismissed: number }
  evaluations: { useful: number; doubtful: number; needs_evidence: number }
  contributions: { active: number; superseded: number; imported: number }
}

export const originOf = (proposedBy: string): ProposalOrigin =>
  proposedBy.startsWith(AGENT_PREFIX)
    ? 'participant_ai'
    : proposedBy === DETERMINISTIC_CURATOR
      ? 'deterministic'
      : 'server_ai'

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function decisionStats(proposals: CurationProposal[]): DecisionStats {
  const accepted = proposals.filter((p) => p.status === 'accepted').length
  const rejected = proposals.filter((p) => p.status === 'rejected').length
  const minutes = proposals
    .filter((p) => p.reviewedAt)
    .map((p) => (Date.parse(p.reviewedAt!) - Date.parse(p.createdAt)) / 60000)
    .filter((n) => Number.isFinite(n) && n >= 0)
  const m = median(minutes)
  return {
    proposed: proposals.length,
    pending: proposals.filter((p) => p.status === 'pending').length,
    accepted,
    rejected,
    acceptanceRate: accepted + rejected > 0 ? Number((accepted / (accepted + rejected)).toFixed(3)) : null,
    medianMinutesToReview: m === null ? null : Number(m.toFixed(1)),
  }
}

/** Pure: the report for one problem's state and its (sorted) events. */
export function buildFieldReport(
  state: ProblemState,
  events: MemoryEvent[],
  initialMode: OrchestrationMode = DEFAULT_ORCHESTRATION_MODE,
): FieldReport {
  // Replay the mode over time, so each proposal is attributed to the mode it
  // was made under — the comparison the field test is about.
  let mode = initialMode
  const modeAt = new Map<string, OrchestrationMode>()
  const history: FieldReport['orchestration']['history'] = []
  for (const event of events) {
    if (event.eventType === 'OrchestrationModeChanged') {
      const p = event.payload as { from: OrchestrationMode; to: OrchestrationMode; reason?: string }
      history.push({ at: event.timestamp, by: event.actorId, from: p.from, to: p.to, ...(p.reason ? { reason: p.reason } : {}) })
      mode = p.to
    }
    if (event.eventType === 'RelationProposed' || event.eventType === 'ConflictProposed') {
      modeAt.set(String((event.payload as { proposalId?: string }).proposalId ?? event.objectId), mode)
    }
  }

  const byOrigin = { participant_ai: [], server_ai: [], deterministic: [] } as Record<ProposalOrigin, CurationProposal[]>
  const byMode: Partial<Record<OrchestrationMode, CurationProposal[]>> = {}
  for (const proposal of state.proposals) {
    byOrigin[originOf(proposal.proposedBy)].push(proposal)
    const m = modeAt.get(proposal.id) ?? initialMode
    ;(byMode[m] ??= []).push(proposal)
  }

  const people = new Map<string, ParticipantStats>()
  const person = (actorId: string): ParticipantStats => {
    let entry = people.get(actorId)
    if (!entry) {
      entry = { actorId, contributions: 0, aiPrepared: 0, bySource: {}, agentProposals: 0, reviews: 0, evaluations: 0 }
      people.set(actorId, entry)
    }
    return entry
  }
  for (const c of state.contributions) {
    const author = c.provenance.authoredBy
    if (!isParticipant(author)) continue
    const entry = person(author)
    entry.contributions += 1
    if (c.provenance.preparedBy) entry.aiPrepared += 1
    entry.bySource[c.provenance.source] = (entry.bySource[c.provenance.source] ?? 0) + 1
  }
  for (const p of state.proposals) {
    if (p.onBehalfOf) person(p.onBehalfOf).agentProposals += 1
    if (p.reviewedBy && isParticipant(p.reviewedBy)) person(p.reviewedBy).reviews += 1
  }
  for (const e of state.evaluations) if (isParticipant(e.actorId)) person(e.actorId).evaluations += 1

  const stances = { useful: 0, doubtful: 0, needs_evidence: 0 }
  for (const e of state.evaluations) stances[e.stance] += 1

  return {
    problemId: state.problem.id,
    title: state.problem.title,
    orchestration: { current: state.problem.orchestration.mode, history },
    proposals: {
      total: decisionStats(state.proposals),
      byOrigin: {
        participant_ai: decisionStats(byOrigin.participant_ai),
        server_ai: decisionStats(byOrigin.server_ai),
        deterministic: decisionStats(byOrigin.deterministic),
      },
      byMode: Object.fromEntries(Object.entries(byMode).map(([m, list]) => [m, decisionStats(list!)])),
    },
    participants: [...people.values()].sort((a, b) => a.actorId.localeCompare(b.actorId)),
    conflicts: {
      accepted: state.conflicts.length,
      open: state.conflicts.filter((c) => c.status === 'open').length,
      resolved: state.conflicts.filter((c) => c.status === 'resolved').length,
      dismissed: state.conflicts.filter((c) => c.status === 'dismissed').length,
    },
    evaluations: stances,
    contributions: {
      active: state.contributions.filter((c) => c.status === 'active').length,
      superseded: state.contributions.filter((c) => c.status === 'superseded').length,
      imported: state.contributions.filter((c) => c.provenance.source === 'repo_import').length,
    },
  }
}

export interface ReportService {
  fieldReport(problemId: string): Promise<FieldReport>
}

export function createReportService(deps: ServiceDeps): ReportService {
  return {
    async fieldReport(problemId) {
      const { state, events } = await loadStateAndEvents(deps, problemId)
      return buildFieldReport(state, events, deps.defaultOrchestration ?? DEFAULT_ORCHESTRATION_MODE)
    },
  }
}
