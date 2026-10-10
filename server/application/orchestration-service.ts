/**
 * Who does the AI judgement for a problem, and what they need to do it.
 *
 * Two operations:
 *
 *  - `context` — the bounded package a participant's LLM reads *before*
 *    contributing: the problem's mode, what is expected of the model in that
 *    mode, and at most `CONTEXT_CANDIDATE_LIMIT` existing contributions to
 *    compare against. This is the cheap read path; it stays the same size as
 *    the problem grows.
 *  - `setMode` — a human switch, recorded as `OrchestrationModeChanged`, so
 *    the timeline shows who moved the cost where, and when.
 */
import { makeEvent } from '../domain/events.js'
import type {
  ConflictKind, ContributionKind, OrchestrationMode, OrchestrationSetting, RelationKind,
} from '../domain/types.js'
import { CONFLICT_KINDS, ORCHESTRATION_MODES, RELATION_KINDS } from '../domain/types.js'
import { CONFLICT_KIND_MEANING } from '../domain/conflicts.js'
import {
  assertMayChangeOrchestration, CONTEXT_CANDIDATE_LIMIT, PARTICIPANT_PROPOSAL_LIMIT,
} from '../domain/policies.js'
import { rankCandidates, PARTICIPANT_PROPOSAL_KINDS } from '../curation/participant.js'
import type { ActorContext } from '../auth/actor-context.js'
import { loadState, type ServiceDeps } from './support.js'

export interface ContextCandidate {
  id: string
  kind: ContributionKind
  label: string
  content: string
  authoredBy: string
  preparedBy?: string
  overlap: number
}

export interface OrchestrationOption {
  mode: OrchestrationMode
  available: boolean
  /** One line on who does the judgement and who pays for it. */
  summary: string
}

export interface ContributionContext {
  problem: { id: string; title: string; description: string }
  orchestration: OrchestrationSetting
  /** What a participant's model is expected to do in the current mode. */
  instructions: string[]
  candidates: ContextCandidate[]
  vocabulary: {
    proposalKinds: readonly string[]
    relationKinds: RelationKind[]
    conflictKinds: ConflictKind[]
    conflictMeaning: Record<string, string>
  }
  limits: { candidates: number; proposalsPerContribution: number }
}

export interface OrchestrationService {
  options(): OrchestrationOption[]
  get(problemId: string): Promise<{ orchestration: OrchestrationSetting; options: OrchestrationOption[] }>
  context(problemId: string, draft?: string): Promise<ContributionContext>
  setMode(
    actor: ActorContext,
    input: { problemId: string; mode: unknown; reason?: string },
  ): Promise<OrchestrationSetting>
}

const SUMMARY: Record<OrchestrationMode, string> = {
  participant:
    "Each contributor's own AI proposes relations and conflicts with their contribution. The contributor pays; the server spends nothing on inference.",
  api: "The server's AI curator reviews every contribution on the operator's key. The operator pays.",
  deterministic: 'Lexical matching only. No AI judgement, no inference cost.',
}

const INSTRUCTIONS: Record<OrchestrationMode, string[]> = {
  participant: [
    'This problem uses participant orchestration: you, the contributor’s model, propose how the new contribution relates to existing ones.',
    'Compare the draft only against the candidates listed here. Name a candidate by its id; any other id is dropped.',
    'Attach at most `limits.proposalsPerContribution` proposals to propose_contribution as `proposals`.',
    'Prefer no proposal over a weak one. Distinguish a real contradiction from a difference of emphasis.',
    'A proposal is a question for another participant, not a verdict. Your participant cannot accept it themselves.',
    'Never assert who said something; attribution is recorded by the server.',
  ],
  api: [
    'This problem uses API orchestration: the server’s curator proposes relations and conflicts after you contribute.',
    'You may still attach proposals; they are recorded alongside the curator’s and reviewed the same way.',
  ],
  deterministic: [
    'This problem uses deterministic orchestration: only lexical matching proposes relations.',
    'Do not attach proposals — they will be dropped. Just contribute.',
  ],
}

export function createOrchestrationService(deps: ServiceDeps): OrchestrationService {
  const options = (): OrchestrationOption[] =>
    ORCHESTRATION_MODES.map((mode) => ({
      mode,
      available: mode !== 'api' || deps.curator.enabled,
      summary: SUMMARY[mode],
    }))

  return {
    options,

    async get(problemId) {
      const state = await loadState(deps, problemId)
      return { orchestration: state.problem.orchestration, options: options() }
    },

    async context(problemId, draft = '') {
      const state = await loadState(deps, problemId)
      const mode = state.problem.orchestration.mode
      const candidates = rankCandidates(draft, state.contributions).map(({ contribution: c, overlap }) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        content: c.content,
        authoredBy: c.provenance.authoredBy,
        ...(c.provenance.preparedBy ? { preparedBy: c.provenance.preparedBy } : {}),
        overlap: Number(overlap.toFixed(3)),
      }))

      return {
        problem: { id: state.problem.id, title: state.problem.title, description: state.problem.description },
        orchestration: state.problem.orchestration,
        instructions: INSTRUCTIONS[mode],
        candidates,
        vocabulary: {
          proposalKinds: PARTICIPANT_PROPOSAL_KINDS,
          relationKinds: RELATION_KINDS.filter((k) => k !== 'supersedes'),
          conflictKinds: CONFLICT_KINDS,
          conflictMeaning: CONFLICT_KIND_MEANING,
        },
        limits: { candidates: CONTEXT_CANDIDATE_LIMIT, proposalsPerContribution: PARTICIPANT_PROPOSAL_LIMIT },
      }
    },

    async setMode(actor, input) {
      const state = await loadState(deps, input.problemId)
      const from = state.problem.orchestration.mode
      const to = assertMayChangeOrchestration(actor, {
        from,
        to: input.mode,
        apiAvailable: deps.curator.enabled,
        // Selecting the mode a problem merely defaults to pins it, so a later
        // change of deployment default cannot move it silently.
        pinned: Boolean(state.problem.orchestration.changedBy),
      })
      const reason = input.reason?.trim()

      const event = makeEvent(deps, {
        problemId: input.problemId,
        actorId: actor.actorId,
        objectId: input.problemId,
        eventType: 'OrchestrationModeChanged',
        payload: { from, to, ...(reason ? { reason } : {}) },
      })
      await deps.repository.append([event])

      return { mode: to, changedBy: actor.actorId, changedAt: event.timestamp, ...(reason ? { reason } : {}) }
    },
  }
}
