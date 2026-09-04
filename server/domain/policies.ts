/**
 * The review boundary, as code.
 *
 * | actor                 | may                                        | may never                       |
 * |-----------------------|--------------------------------------------|---------------------------------|
 * | participant           | contribute, edit own, review proposals     | —                               |
 * | deterministic curator | propose                                    | write any event                 |
 * | AI curator            | propose (from a bounded candidate set)     | write any event, declare truth  |
 *
 * The "may never write an event" half is enforced by construction: curator
 * modules do not import `makeEvent`. This module enforces the half that needs a
 * runtime check — that the actor asking for a canonical mutation is a person.
 */
import type { ActorContext } from '../auth/actor-context.js'
import type { ContributionRecord, CurationProposal } from './types.js'
import { forbidden, invalid } from './errors.js'

/** Curator identities are namespaced so they can never be mistaken for participants. */
export const CURATOR_PREFIX = 'curator:'
export const PARTICIPANT_PREFIX = 'person:'

export const isCurator = (actorId: string): boolean => actorId.startsWith(CURATOR_PREFIX)
export const isParticipant = (actorId: string): boolean => actorId.startsWith(PARTICIPANT_PREFIX)

/**
 * Guards every canonical mutation. A curator id reaching this point means a
 * wiring mistake let a proposal path into a command path — fail loudly.
 */
export function assertHumanActor(actor: ActorContext, action: string): void {
  if (!isParticipant(actor.actorId)) {
    throw forbidden(`Only a participant may ${action}.`, { actorId: actor.actorId })
  }
}

/** Reviewing a curation proposal is a human act, by definition of the review boundary. */
export function assertMayReview(actor: ActorContext, proposal: CurationProposal): void {
  assertHumanActor(actor, 'review a curation proposal')
  if (proposal.status !== 'pending') {
    throw invalid('This proposal has already been reviewed.', {
      proposalId: proposal.id,
      status: proposal.status,
      reviewedBy: proposal.reviewedBy,
    })
  }
}

/**
 * Editing is restricted to the author. Anyone else who disagrees contributes
 * their own statement — which is the point of a shared room that keeps
 * disagreement rather than resolving it by overwrite.
 */
export function assertMayEdit(actor: ActorContext, contribution: ContributionRecord): void {
  assertHumanActor(actor, 'edit a contribution')
  if (contribution.provenance.authoredBy !== actor.actorId) {
    throw forbidden('Only the author may edit a contribution. Add your own contribution instead.', {
      contributionId: contribution.id,
    })
  }
  if (contribution.status !== 'active') {
    throw invalid(`A ${contribution.status} contribution cannot be edited.`, { contributionId: contribution.id })
  }
}

export function assertMaySupersede(actor: ActorContext, contribution: ContributionRecord): void {
  assertHumanActor(actor, 'supersede a contribution')
  if (contribution.status !== 'active') {
    throw invalid(`A ${contribution.status} contribution cannot be superseded again.`, {
      contributionId: contribution.id,
    })
  }
}

/** The AI curator never sees the store — only this many sibling contributions. */
export const AI_CANDIDATE_LIMIT = 12

/** Upper bound on proposals a single contribution may generate, so review stays reviewable. */
export const PROPOSALS_PER_CONTRIBUTION_LIMIT = 8

export const MAX_CONTRIBUTION_LENGTH = 8000

export function assertContributionContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) throw invalid('A contribution needs content.')
  if (trimmed.length > MAX_CONTRIBUTION_LENGTH) {
    throw invalid(`A contribution may be at most ${MAX_CONTRIBUTION_LENGTH} characters.`, {
      length: trimmed.length,
    })
  }
  return trimmed
}
