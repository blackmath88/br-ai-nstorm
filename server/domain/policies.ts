/**
 * The review boundary, as code.
 *
 * | actor                 | may                                        | may never                       |
 * |-----------------------|--------------------------------------------|---------------------------------|
 * | participant           | contribute, edit own, review proposals     | —                               |
 * | deterministic curator | propose                                    | write any event                 |
 * | AI curator            | propose (from a bounded candidate set)     | write any event, declare truth  |
 * | participant's own LLM | propose, attached to its own contribution  | write any event; be accepted by |
 * |                       |                                            | the participant it acted for    |
 *
 * The "may never write an event" half is enforced by construction: curator
 * modules do not import `makeEvent`. This module enforces the half that needs a
 * runtime check — that the actor asking for a canonical mutation is a person.
 */
import type { ActorContext } from '../auth/actor-context.js'
import type { ContributionRecord, CurationProposal, OrchestrationMode } from './types.js'
import { ORCHESTRATION_MODES } from './types.js'
import { forbidden, invalid } from './errors.js'

/** Curator identities are namespaced so they can never be mistaken for participants. */
export const CURATOR_PREFIX = 'curator:'
export const PARTICIPANT_PREFIX = 'person:'
/** A participant's own LLM, acting on their behalf. Never a person, never a server curator. */
export const AGENT_PREFIX = 'agent:'

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
  // Without this, participant-mode orchestration is self-approval with extra
  // steps: Kai's model says his claim contradicts Lea's, and Kai accepts it.
  if (proposal.onBehalfOf && proposal.onBehalfOf === actor.actorId) {
    throw forbidden('A proposal your own AI made must be reviewed by another participant.', {
      proposalId: proposal.id,
      onBehalfOf: proposal.onBehalfOf,
    })
  }
}

/**
 * Switching who does (and pays for) AI judgement is a human act, and `api`
 * is only selectable when the server actually has a curator configured — a
 * mode that silently does nothing would misreport where proposals came from.
 */
export function assertMayChangeOrchestration(
  actor: ActorContext,
  input: {
    from: OrchestrationMode
    to: unknown
    apiAvailable: boolean
    /** False while the problem only follows a default; then re-selecting it pins it. */
    pinned: boolean
  },
): OrchestrationMode {
  assertHumanActor(actor, 'change orchestration mode')
  if (typeof input.to !== 'string' || !(ORCHESTRATION_MODES as string[]).includes(input.to)) {
    throw invalid(`Unknown orchestration mode "${String(input.to)}".`, { allowed: ORCHESTRATION_MODES })
  }
  const to = input.to as OrchestrationMode
  if (to === input.from && input.pinned) throw invalid(`Orchestration is already "${to}".`)
  if (to === 'api' && !input.apiAvailable) {
    throw invalid('API orchestration is not configured on this server. Set a curator key first.', {
      allowed: ORCHESTRATION_MODES.filter((mode) => mode !== 'api'),
    })
  }
  return to
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

/**
 * Candidates handed to a participant's LLM in `participant` mode. Same bound as
 * the server curator gets, so the client-side read cost stays flat as the
 * problem grows.
 */
export const CONTEXT_CANDIDATE_LIMIT = AI_CANDIDATE_LIMIT

/** Upper bound on proposals a participant's LLM may attach to one contribution. */
export const PARTICIPANT_PROPOSAL_LIMIT = PROPOSALS_PER_CONTRIBUTION_LIMIT

export const MAX_PROPOSAL_REASON_LENGTH = 600

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
