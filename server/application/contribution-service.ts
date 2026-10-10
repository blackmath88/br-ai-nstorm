/**
 * Write side for contributions.
 *
 * Order matters here and is deliberate: the contribution is appended and
 * durable **before** curation runs. Curation failure can therefore never lose a
 * contribution, and the AI curator is free to be best-effort.
 *
 * Attribution is taken from the `ActorContext` argument and from nowhere else.
 * No request body field, no header, and no curator output can influence it.
 */
import { deriveLabel, makeEvent, type MemoryEvent } from '../domain/events.js'
import type {
  ContributionKind, ContributionRecord, ContributionSource, Endorsement, Visibility,
} from '../domain/types.js'
import { CONTRIBUTION_KINDS } from '../domain/types.js'
import { invalid, notFound } from '../domain/errors.js'
import {
  assertContributionContent, assertMayEdit, assertMaySupersede, assertHumanActor, PROPOSALS_PER_CONTRIBUTION_LIMIT,
} from '../domain/policies.js'
import type { ActorContext } from '../auth/actor-context.js'
import { proposeDeterministically, inferKind, type ProposalDraft } from '../curation/deterministic.js'
import { agentIdFor, screenParticipantProposals, type DroppedProposal } from '../curation/participant.js'
import { loadState, type ServiceDeps } from './support.js'

export interface AddContributionInput {
  problemId: string
  content: string
  kind?: ContributionKind
  source?: ContributionSource
  sourceDetail?: string
  /** Set when an AI drafted the text. Never collapsed into the author. */
  preparedBy?: string
  endorsement?: Endorsement
  visibility?: Visibility
  /**
   * Proposals the contributor's own LLM attached (`participant` orchestration).
   * Unvalidated on arrival; screened against canonical state before anything
   * is appended. See `curation/participant.ts`.
   */
  proposals?: unknown
}

export interface AddContributionResult {
  contribution: ContributionRecord
  proposals: import('../domain/types.js').CurationProposal[]
  curator: {
    /** The problem's orchestration mode at the time of this contribution. */
    mode: import('../domain/types.js').OrchestrationMode
    deterministic: number
    ai: number
    participant: number
    trimmed: number
    aiEnabled: boolean
  }
  /** Participant proposals that were not recorded, each with the reason. */
  dropped: DroppedProposal[]
}

export interface ContributionService {
  add(actor: ActorContext, input: AddContributionInput): Promise<AddContributionResult>
  edit(actor: ActorContext, input: { problemId: string; contributionId: string; content?: string; kind?: ContributionKind; reason?: string }): Promise<ContributionRecord>
  supersede(actor: ActorContext, input: { problemId: string; contributionId: string; supersededBy: string; reason?: string }): Promise<ContributionRecord>
  changeVisibility(actor: ActorContext, input: { problemId: string; contributionId: string; to: Visibility; reason?: string }): Promise<ContributionRecord>
  evaluate(actor: ActorContext, input: { problemId: string; targetId: string; stance: 'useful' | 'doubtful' | 'needs_evidence'; note?: string }): Promise<void>
}

const assertKind = (kind: unknown): ContributionKind => {
  if (typeof kind !== 'string' || !(CONTRIBUTION_KINDS as string[]).includes(kind)) {
    throw invalid(`Unknown contribution kind "${String(kind)}".`, { allowed: CONTRIBUTION_KINDS })
  }
  return kind as ContributionKind
}

export function createContributionService(deps: ServiceDeps): ContributionService {
  const find = async (problemId: string, contributionId: string) => {
    const state = await loadState(deps, problemId)
    const contribution = state.contributions.find((c) => c.id === contributionId)
    if (!contribution) throw notFound('Contribution', contributionId)
    return { state, contribution }
  }

  return {
    async add(actor, input) {
      assertHumanActor(actor, 'add a contribution')
      const state = await loadState(deps, input.problemId)
      const content = assertContributionContent(input.content)
      const kind = input.kind ? assertKind(input.kind) : inferKind(content)

      const contributionId = deps.ids.next('contrib')
      const correlationId = deps.ids.next('corr')
      const source: ContributionSource = input.source ?? 'direct'

      const added = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: contributionId,
        eventType: 'ContributionAdded',
        correlationId,
        payload: {
          kind,
          label: deriveLabel(content),
          content,
          visibility: input.visibility ?? 'problem',
          provenance: {
            authoredBy: actor.actorId,
            ...(input.preparedBy ? { preparedBy: input.preparedBy } : {}),
            submittedBy: actor.actorId,
            source,
            ...(input.sourceDetail ? { sourceDetail: input.sourceDetail } : {}),
            // An AI-prepared contribution is never silently treated as endorsed.
            endorsement:
              input.endorsement ?? (input.preparedBy ? 'participant_review_required' : 'human_endorsed'),
            timestamp: deps.clock.now(),
          },
        },
      })

      // Durable first. Everything below is best-effort enrichment.
      await deps.repository.append([added])

      const contribution: ContributionRecord = {
        id: contributionId,
        problemId: input.problemId,
        kind,
        label: added.payload.label,
        content,
        status: 'active',
        visibility: added.payload.visibility,
        provenance: added.payload.provenance,
        createdAt: added.timestamp,
      }

      const candidates = state.contributions.filter((c) => c.status === 'active')
      const deterministic = proposeDeterministically({
        problemId: input.problemId,
        contribution,
        candidates,
      })

      const mode = state.problem.orchestration.mode

      // The operator's key is spent only when the problem has explicitly
      // switched to `api` — never as a silent fallback.
      let ai: ProposalDraft[] = []
      if (mode === 'api') {
        try {
          ai = await deps.curator.propose({ problem: state.problem, contribution, candidates })
        } catch (error) {
          console.error('[br-ai-nstorm] curator failed, continuing without it:', error)
        }
      }

      const screened = screenParticipantProposals({
        problemId: input.problemId,
        mode,
        contribution,
        contributions: state.contributions,
        proposals: input.proposals,
        agentId: agentIdFor(input.preparedBy),
        onBehalfOf: actor.actorId,
      })

      // Participant judgement first (it is the mode's curation), then the
      // server curator, then lexical matching — and one cap over all of them,
      // so a contribution never asks more of a reviewer than the limit.
      // Participant drafts are themselves capped at the same limit, so the
      // cap only ever trims curator output.
      const drafts = dedupe([...screened.drafts, ...ai, ...deterministic], state.proposals).slice(
        0,
        PROPOSALS_PER_CONTRIBUTION_LIMIT,
      )
      const proposalEvents: MemoryEvent[] = []
      const proposals: import('../domain/types.js').CurationProposal[] = []

      for (const draft of drafts) {
        const proposalId = deps.ids.next('proposal')
        const event = makeEvent(deps, {
          problemId: input.problemId,
          // A proposal is caused by the curator, not by the person who wrote
          // the contribution — so the log never implies Kai proposed a conflict
          // against his own statement.
          actorId: draft.proposedBy,
          objectId: proposalId,
          eventType: draft.kind === 'conflict' ? 'ConflictProposed' : 'RelationProposed',
          causationId: added.id,
          correlationId,
          payload: { proposalId, ...draft },
        })
        proposalEvents.push(event)
        proposals.push({ ...draft, id: proposalId, status: 'pending', createdAt: event.timestamp })
      }

      if (proposalEvents.length > 0) await deps.repository.append(proposalEvents)

      return {
        contribution,
        proposals,
        curator: {
          mode,
          // What was actually recorded from each source, after dedupe and the cap.
          deterministic: deterministic.filter((draft) => drafts.includes(draft)).length,
          ai: ai.filter((draft) => drafts.includes(draft)).length,
          participant: screened.drafts.filter((draft) => drafts.includes(draft)).length,
          /** Curator drafts not recorded because the contribution reached the cap. */
          trimmed: deterministic.length + ai.length + screened.drafts.length - drafts.length,
          aiEnabled: deps.curator.enabled,
        },
        dropped: screened.dropped,
      }
    },

    async edit(actor, input) {
      const { contribution } = await find(input.problemId, input.contributionId)
      assertMayEdit(actor, contribution)
      const content = input.content === undefined ? undefined : assertContributionContent(input.content)
      const kind = input.kind === undefined ? undefined : assertKind(input.kind)
      if (content === undefined && kind === undefined) throw invalid('Nothing to change.')

      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: contribution.id,
        eventType: 'ContributionEdited',
        payload: {
          ...(content !== undefined ? { content, label: deriveLabel(content) } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      })
      await deps.repository.append([event])
      return {
        ...contribution,
        ...(content !== undefined ? { content, label: deriveLabel(content) } : {}),
        ...(kind !== undefined ? { kind } : {}),
        updatedAt: event.timestamp,
      }
    },

    async supersede(actor, input) {
      const { state, contribution } = await find(input.problemId, input.contributionId)
      assertMaySupersede(actor, contribution)
      if (!state.contributions.some((c) => c.id === input.supersededBy)) {
        throw notFound('Superseding contribution', input.supersededBy)
      }
      if (input.supersededBy === contribution.id) throw invalid('A contribution cannot supersede itself.')

      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: contribution.id,
        eventType: 'ContributionSuperseded',
        payload: { supersededBy: input.supersededBy, ...(input.reason ? { reason: input.reason } : {}) },
      })
      await deps.repository.append([event])
      // The record stays, its history stays; only its status changes.
      return { ...contribution, status: 'superseded', supersededBy: input.supersededBy, updatedAt: event.timestamp }
    },

    async changeVisibility(actor, input) {
      const { contribution } = await find(input.problemId, input.contributionId)
      assertHumanActor(actor, 'change visibility')
      if (contribution.visibility === input.to) throw invalid(`Visibility is already "${input.to}".`)

      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: contribution.id,
        eventType: 'VisibilityChanged',
        payload: { from: contribution.visibility, to: input.to, ...(input.reason ? { reason: input.reason } : {}) },
      })
      await deps.repository.append([event])
      return {
        ...contribution,
        visibility: input.to,
        provenance: { ...contribution.provenance, publishedBy: actor.actorId },
        updatedAt: event.timestamp,
      }
    },

    async evaluate(actor, input) {
      assertHumanActor(actor, 'evaluate a contribution')
      await find(input.problemId, input.targetId)
      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: deps.ids.next('eval'),
        eventType: 'EvaluationAdded',
        payload: { targetId: input.targetId, stance: input.stance, ...(input.note ? { note: input.note } : {}) },
      })
      await deps.repository.append([event])
    },
  }
}

/** Drops drafts that restate a proposal already sitting in the queue. */
function dedupe(
  drafts: ProposalDraft[],
  existing: import('../domain/types.js').CurationProposal[],
): ProposalDraft[] {
  const seen = new Set(
    existing
      .filter((p) => p.status === 'pending')
      .map((p) => `${p.kind}:${p.sourceId}:${p.targetId ?? ''}`),
  )
  const out: ProposalDraft[] = []
  for (const draft of drafts) {
    const key = `${draft.kind}:${draft.sourceId}:${draft.targetId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(draft)
  }
  return out
}
