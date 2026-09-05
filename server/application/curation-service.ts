/**
 * The review boundary in one place.
 *
 * This is the *only* module that can turn a proposal into canonical memory, and
 * it requires a human `ActorContext` to do it. Curator modules never import
 * `makeEvent`; this one does. That asymmetry is the architecture.
 */
import { makeEvent } from '../domain/events.js'
import type { ConflictRecord, CurationProposal, RelationRecord } from '../domain/types.js'
import { notFound, invalid } from '../domain/errors.js'
import { assertMayReview } from '../domain/policies.js'
import { assertAcceptableAsConflict, sameConflictPair } from '../domain/conflicts.js'
import type { ActorContext } from '../auth/actor-context.js'
import { loadState, type ServiceDeps } from './support.js'

export interface ReviewResult {
  proposal: CurationProposal
  relation?: RelationRecord
  conflict?: ConflictRecord
}

export interface CurationService {
  list(problemId: string, options?: { status?: CurationProposal['status'] }): Promise<CurationProposal[]>
  accept(actor: ActorContext, input: { problemId: string; proposalId: string }): Promise<ReviewResult>
  reject(actor: ActorContext, input: { problemId: string; proposalId: string; reason?: string }): Promise<ReviewResult>
}

export function createCurationService(deps: ServiceDeps): CurationService {
  const findProposal = async (problemId: string, proposalId: string) => {
    const state = await loadState(deps, problemId)
    const proposal = state.proposals.find((p) => p.id === proposalId)
    if (!proposal) throw notFound('Curation proposal', proposalId)
    return { state, proposal }
  }

  return {
    async list(problemId, options) {
      const state = await loadState(deps, problemId)
      return options?.status ? state.proposals.filter((p) => p.status === options.status) : state.proposals
    },

    async accept(actor, input) {
      const { state, proposal } = await findProposal(input.problemId, input.proposalId)
      assertMayReview(actor, proposal)

      if (proposal.kind === 'conflict') {
        assertAcceptableAsConflict(proposal)
        const candidate = { leftObjectId: proposal.sourceId, rightObjectId: proposal.targetId }
        if (state.conflicts.some((existing) => sameConflictPair(existing, candidate))) {
          throw invalid('That conflict is already recorded.', { proposalId: proposal.id })
        }

        const conflictId = deps.ids.next('conflict')
        const event = makeEvent(deps, {
          problemId: input.problemId,
          actorId: actor.actorId,
          objectId: conflictId,
          eventType: 'ConflictAccepted',
          payload: {
            proposalId: proposal.id,
            leftObjectId: proposal.sourceId,
            rightObjectId: proposal.targetId,
            conflictType: proposal.conflictKind,
            reason: proposal.reason,
            detectedBy: proposal.proposedBy,
            confidence: proposal.confidence,
          },
        })
        await deps.repository.append([event])

        return {
          proposal: { ...proposal, status: 'accepted', reviewedBy: actor.actorId, reviewedAt: event.timestamp },
          conflict: {
            id: conflictId,
            problemId: input.problemId,
            leftObjectId: proposal.sourceId,
            rightObjectId: proposal.targetId,
            conflictType: proposal.conflictKind,
            reason: proposal.reason,
            detectedBy: proposal.proposedBy,
            confidence: proposal.confidence,
            status: 'open',
            createdAt: event.timestamp,
            reviewedBy: actor.actorId,
            fromProposalId: proposal.id,
          },
        }
      }

      // `relation`, `duplicate` and `classification` all become an accepted
      // relation; the kind decides which relation, so a duplicate is recorded
      // as a `relates` edge rather than silently merging two contributions.
      const targetId = proposal.targetId
      if (!targetId) throw invalid('This proposal has no counterpart to relate to.', { proposalId: proposal.id })
      const relationKind =
        proposal.kind === 'duplicate' ? 'relates' : (proposal.relationKind ?? 'relates')

      const relationId = deps.ids.next('rel')
      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: relationId,
        eventType: 'RelationAccepted',
        payload: { proposalId: proposal.id, sourceId: proposal.sourceId, targetId, relationKind },
      })
      await deps.repository.append([event])

      return {
        proposal: { ...proposal, status: 'accepted', reviewedBy: actor.actorId, reviewedAt: event.timestamp },
        relation: {
          id: relationId,
          problemId: input.problemId,
          sourceId: proposal.sourceId,
          targetId,
          kind: relationKind,
          createdBy: actor.actorId,
          createdAt: event.timestamp,
          fromProposalId: proposal.id,
        },
      }
    },

    async reject(actor, input) {
      const { proposal } = await findProposal(input.problemId, input.proposalId)
      assertMayReview(actor, proposal)

      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: proposal.id,
        eventType: proposal.kind === 'conflict' ? 'ConflictRejected' : 'RelationRejected',
        payload: { proposalId: proposal.id, ...(input.reason ? { reason: input.reason } : {}) },
      })
      await deps.repository.append([event])

      return {
        proposal: { ...proposal, status: 'rejected', reviewedBy: actor.actorId, reviewedAt: event.timestamp },
      }
    },
  }
}
