/**
 * Conflict lifecycle.
 *
 * The rule this module exists to enforce: a `ConflictRecord` can only come into
 * existence as the result of a `ConflictAccepted` event, and only a person can
 * cause one. AI and the deterministic curator produce proposals; a rejected
 * proposal leaves a `ConflictRejected` event and no record.
 */
import type { ConflictKind, ConflictRecord, ConflictStatus, CurationProposal } from './types.js'
import { CONFLICT_KINDS } from './types.js'
import { invalid } from './errors.js'

export const isConflictKind = (value: unknown): value is ConflictKind =>
  typeof value === 'string' && (CONFLICT_KINDS as string[]).includes(value)

/**
 * Human-readable meaning of each conflict type. Surfaced in the UI so a
 * participant reviewing a proposal knows what they are being asked to affirm.
 */
export const CONFLICT_KIND_MEANING: Record<ConflictKind, string> = {
  source_conflict: 'Two sources report incompatible facts.',
  knowledge_conflict: 'Two claims about how the world works cannot both hold.',
  decision_conflict: 'Two decisions point the work in incompatible directions.',
  assumption_conflict: 'Two untested assumptions are mutually exclusive.',
  commitment_conflict: 'Two commitments cannot both be honoured.',
}

/** A conflict that is canonical and still unresolved — what the State view must show. */
export const isUnresolved = (conflict: ConflictRecord): boolean => conflict.status === 'open'

export const openConflicts = (conflicts: ConflictRecord[]): ConflictRecord[] =>
  conflicts.filter(isUnresolved)

/**
 * Validates that a proposal can legally become a conflict. Called at review
 * time, not at proposal time: a curator is allowed to propose something
 * incoherent, and the review boundary is where that is caught.
 */
export function assertAcceptableAsConflict(proposal: CurationProposal): asserts proposal is CurationProposal & {
  targetId: string
  conflictKind: ConflictKind
} {
  if (proposal.kind !== 'conflict') {
    throw invalid('Proposal is not a conflict proposal.', { proposalId: proposal.id, kind: proposal.kind })
  }
  if (!proposal.targetId) {
    throw invalid('Conflict proposal has no counterpart object.', { proposalId: proposal.id })
  }
  if (proposal.sourceId === proposal.targetId) {
    throw invalid('A contribution cannot conflict with itself.', { proposalId: proposal.id })
  }
  if (!isConflictKind(proposal.conflictKind)) {
    throw invalid('Conflict proposal has no valid conflict type.', { proposalId: proposal.id })
  }
}

/** Two conflicts are the same disagreement regardless of which side was listed first. */
export const sameConflictPair = (
  a: Pick<ConflictRecord, 'leftObjectId' | 'rightObjectId'>,
  b: Pick<ConflictRecord, 'leftObjectId' | 'rightObjectId'>,
): boolean =>
  (a.leftObjectId === b.leftObjectId && a.rightObjectId === b.rightObjectId) ||
  (a.leftObjectId === b.rightObjectId && a.rightObjectId === b.leftObjectId)

export const nextStatus = (current: ConflictStatus, action: 'resolve' | 'dismiss'): ConflictStatus => {
  if (current !== 'open') {
    throw invalid(`A ${current} conflict cannot be ${action}d again.`)
  }
  return action === 'resolve' ? 'resolved' : 'dismissed'
}
