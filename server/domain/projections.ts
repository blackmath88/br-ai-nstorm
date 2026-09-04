/**
 * The canonical projection: a pure fold from the event log to problem state.
 *
 * No I/O, no clock, no randomness. Given the same events it always produces the
 * same state, which is what makes "rebuild from history" a testable property
 * rather than an aspiration.
 *
 * Supersession sets a status and records a pointer. It never removes a
 * contribution and never removes an event.
 */
import type {
  ConflictAcceptedPayload, ContributionAddedPayload, ContributionEditedPayload,
  ContributionSupersededPayload, EvaluationAddedPayload, MemoryEvent,
  ProblemCreatedPayload, ProposalPayload, RelationAcceptedPayload,
  ReviewRejectedPayload, VisibilityChangedPayload,
} from './events.js'
import type {
  ConflictRecord, ContributionRecord, CurationProposal, EvaluationRecord,
  ProblemRecord, ProblemState, RelationRecord,
} from './types.js'

const asPayload = <T>(event: MemoryEvent): T => event.payload as unknown as T

interface Accumulator {
  problem?: ProblemRecord
  contributions: Map<string, ContributionRecord>
  relations: Map<string, RelationRecord>
  conflicts: Map<string, ConflictRecord>
  proposals: Map<string, CurationProposal>
  evaluations: Map<string, EvaluationRecord>
}

const empty = (): Accumulator => ({
  contributions: new Map(),
  relations: new Map(),
  conflicts: new Map(),
  proposals: new Map(),
  evaluations: new Map(),
})

/** `evolve(state, event) => state` — the only way state advances. */
function evolve(acc: Accumulator, event: MemoryEvent): Accumulator {
  switch (event.eventType) {
    case 'ProblemCreated': {
      const p = asPayload<ProblemCreatedPayload>(event)
      acc.problem = {
        id: event.problemId,
        title: p.title,
        shortTitle: p.shortTitle,
        description: p.description,
        stateSummary: p.stateSummary,
        thinkNext: p.thinkNext ?? [],
        createdAt: event.timestamp,
        createdBy: event.actorId,
      }
      return acc
    }

    case 'ContributionAdded': {
      const p = asPayload<ContributionAddedPayload>(event)
      acc.contributions.set(event.objectId, {
        id: event.objectId,
        problemId: event.problemId,
        kind: p.kind,
        label: p.label,
        content: p.content,
        status: 'active',
        visibility: p.visibility,
        provenance: p.provenance,
        createdAt: event.timestamp,
      })
      return acc
    }

    case 'ContributionEdited': {
      const existing = acc.contributions.get(event.objectId)
      if (!existing) return acc
      const p = asPayload<ContributionEditedPayload>(event)
      acc.contributions.set(event.objectId, {
        ...existing,
        ...(p.content !== undefined ? { content: p.content } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        ...(p.label !== undefined ? { label: p.label } : {}),
        updatedAt: event.timestamp,
      })
      return acc
    }

    case 'ContributionSuperseded': {
      const existing = acc.contributions.get(event.objectId)
      if (!existing) return acc
      const p = asPayload<ContributionSupersededPayload>(event)
      // Status changes; the record and its history stay.
      acc.contributions.set(event.objectId, {
        ...existing,
        status: 'superseded',
        supersededBy: p.supersededBy,
        updatedAt: event.timestamp,
      })
      return acc
    }

    case 'VisibilityChanged': {
      const existing = acc.contributions.get(event.objectId)
      if (!existing) return acc
      const p = asPayload<VisibilityChangedPayload>(event)
      acc.contributions.set(event.objectId, {
        ...existing,
        visibility: p.to,
        provenance: { ...existing.provenance, publishedBy: event.actorId },
        updatedAt: event.timestamp,
      })
      return acc
    }

    case 'RelationProposed':
    case 'ConflictProposed': {
      const p = asPayload<ProposalPayload>(event)
      acc.proposals.set(p.proposalId, {
        id: p.proposalId,
        problemId: event.problemId,
        kind: p.kind,
        sourceId: p.sourceId,
        ...(p.targetId ? { targetId: p.targetId } : {}),
        ...(p.relationKind ? { relationKind: p.relationKind } : {}),
        ...(p.conflictKind ? { conflictKind: p.conflictKind } : {}),
        ...(p.suggestedKind ? { suggestedKind: p.suggestedKind } : {}),
        reason: p.reason,
        confidence: p.confidence,
        proposedBy: p.proposedBy,
        status: 'pending',
        createdAt: event.timestamp,
      })
      return acc
    }

    case 'RelationAccepted': {
      const p = asPayload<RelationAcceptedPayload>(event)
      acc.relations.set(event.objectId, {
        id: event.objectId,
        problemId: event.problemId,
        sourceId: p.sourceId,
        targetId: p.targetId,
        kind: p.relationKind,
        createdBy: event.actorId,
        createdAt: event.timestamp,
        ...(p.proposalId ? { fromProposalId: p.proposalId } : {}),
      })
      if (p.proposalId) markReviewed(acc, p.proposalId, 'accepted', event)
      return acc
    }

    case 'ConflictAccepted': {
      const p = asPayload<ConflictAcceptedPayload>(event)
      acc.conflicts.set(event.objectId, {
        id: event.objectId,
        problemId: event.problemId,
        leftObjectId: p.leftObjectId,
        rightObjectId: p.rightObjectId,
        conflictType: p.conflictType,
        reason: p.reason,
        detectedBy: p.detectedBy,
        confidence: p.confidence,
        status: 'open',
        createdAt: event.timestamp,
        reviewedBy: event.actorId,
        ...(p.proposalId ? { fromProposalId: p.proposalId } : {}),
      })
      if (p.proposalId) markReviewed(acc, p.proposalId, 'accepted', event)
      return acc
    }

    case 'RelationRejected':
    case 'ConflictRejected': {
      const p = asPayload<ReviewRejectedPayload>(event)
      markReviewed(acc, p.proposalId ?? event.objectId, 'rejected', event)
      return acc
    }

    case 'EvaluationAdded': {
      const p = asPayload<EvaluationAddedPayload>(event)
      acc.evaluations.set(event.objectId, {
        id: event.objectId,
        problemId: event.problemId,
        targetId: p.targetId,
        actorId: event.actorId,
        stance: p.stance,
        ...(p.note ? { note: p.note } : {}),
        createdAt: event.timestamp,
      })
      return acc
    }

    default:
      return acc
  }
}

function markReviewed(
  acc: Accumulator,
  proposalId: string,
  status: 'accepted' | 'rejected',
  event: MemoryEvent,
): void {
  const proposal = acc.proposals.get(proposalId)
  if (!proposal) return
  acc.proposals.set(proposalId, {
    ...proposal,
    status,
    reviewedBy: event.actorId,
    reviewedAt: event.timestamp,
  })
}

/**
 * Folds one problem's events into canonical state. Returns `undefined` when the
 * log contains no `ProblemCreated` for it.
 */
export function project(events: MemoryEvent[]): ProblemState | undefined {
  const acc = events.reduce(evolve, empty())
  if (!acc.problem) return undefined
  return {
    problem: acc.problem,
    contributions: [...acc.contributions.values()],
    relations: [...acc.relations.values()],
    conflicts: [...acc.conflicts.values()],
    proposals: [...acc.proposals.values()],
    evaluations: [...acc.evaluations.values()],
  }
}

/** Every problem present in a log, in creation order. */
export function projectProblems(events: MemoryEvent[]): ProblemRecord[] {
  const problems: ProblemRecord[] = []
  for (const event of events) {
    if (event.eventType !== 'ProblemCreated') continue
    const p = asPayload<ProblemCreatedPayload>(event)
    problems.push({
      id: event.problemId,
      title: p.title,
      shortTitle: p.shortTitle,
      description: p.description,
      stateSummary: p.stateSummary,
      thinkNext: p.thinkNext ?? [],
      createdAt: event.timestamp,
      createdBy: event.actorId,
    })
  }
  return problems
}

export const activeContributions = (state: ProblemState): ContributionRecord[] =>
  state.contributions.filter((c) => c.status === 'active')

export const pendingProposals = (state: ProblemState): CurationProposal[] =>
  state.proposals.filter((p) => p.status === 'pending')
