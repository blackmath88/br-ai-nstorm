/**
 * The clipboard aperture, now over real canonical state.
 *
 * This remains the universal fallback: it works with any LLM, needs no
 * infrastructure, and carries the same semantic contract MCP carries. What
 * changed in v0.3 is that the exported package is the server's canonical state
 * rather than a local mock, and the imported contributions are written through
 * the backend like any other contribution.
 */
import type {
  ActorContext, ContributionContext, ContributionKind, ParticipantProposalInput, ProblemState,
} from './api'

export interface ContributionPackage {
  $type: 'ai.bridgework.brainstorm.contributionPackage'
  schemaVersion: '0.2'
  problemId: string
  participantId: string
  contributions: Array<{
    kind: ContributionKind
    content: string
    confidence?: 'low' | 'medium' | 'high'
    relationTo?: string[]
    endorsement?: 'participant_review_required' | 'human_endorsed'
    /** Participant orchestration: this model's judgement of how the item relates to existing ones. */
    proposals?: ParticipantProposalInput[]
  }>
  privateProcessDisclosed: false
}

/**
 * The orchestration section of the context package. In `participant` mode the
 * external model is the curator, so it gets the bounded candidate set and the
 * proposal vocabulary; in the other modes it is told not to bother.
 */
function orchestrationSection(context: ContributionContext | undefined) {
  if (!context) return undefined
  return {
    mode: context.orchestration.mode,
    instructions: context.instructions,
    candidateIds: context.candidates.map((c) => c.id),
    vocabulary: context.vocabulary,
    limits: context.limits,
  }
}

export function createContextPackage(
  state: ProblemState,
  actor: ActorContext,
  privateDraft = '',
  context?: ContributionContext,
) {
  const active = state.contributions.filter((c) => c.status === 'active')
  const orchestration = orchestrationSection(context)
  const proposes = orchestration?.mode === 'participant' || orchestration?.mode === 'api'
  return {
    $type: 'ai.bridgework.brainstorm.contextPackage',
    schemaVersion: '0.2',
    problem: {
      id: state.problem.id,
      title: state.problem.title,
      description: state.problem.description,
      solutionState: state.problem.stateSummary,
    },
    participant: { id: actor.actorId, name: actor.displayName },
    sharedState: {
      contributions: active.map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        content: c.content,
        // The full provenance envelope travels with the context, so an external
        // model cannot flatten "AI prepared" into "human authored" either.
        provenance: c.provenance,
        status: c.status,
        createdAt: c.createdAt,
      })),
      relations: state.relations.map((r) => ({ source: r.sourceId, target: r.targetId, kind: r.kind })),
      conflicts: state.conflicts
        .filter((c) => c.status === 'open')
        .map((c) => ({
          left: c.leftObjectId,
          right: c.rightObjectId,
          type: c.conflictType,
          reason: c.reason,
        })),
      pendingProposals: state.proposals.filter((p) => p.status === 'pending').length,
    },
    personalState: {
      myContributions: active.filter((c) => c.provenance.authoredBy === actor.actorId).map((c) => c.id),
      orchestrationPrompts: state.problem.thinkNext,
      privateDraft: privateDraft || null,
    },
    ...(orchestration ? { orchestration } : {}),
    aperture: {
      mode: 'reviewed_contribution',
      privateProcessDisclosed: false,
      rules: [
        'Use this context to help the participant think privately.',
        'Do not treat attributed statements as universal truth.',
        'Preserve disagreement and provenance. Conflict is knowledge, not an error.',
        'Do not infer endorsement from mere inclusion in shared state.',
        'Attribution is not yours to assign; the server records who contributed.',
        'Only the final contributionPackage JSON returns to the shared problem.',
      ],
    },
    systemPrompt:
      'You are the participant’s private thinking partner for a shared problem. Explore freely. When asked to ' +
      'return a contribution, output ONLY valid JSON matching expectedOutputSchema. Produce bounded contributions ' +
      'rather than a transcript.',
    expectedOutputSchema: {
      $type: 'ai.bridgework.brainstorm.contributionPackage',
      schemaVersion: '0.2',
      problemId: state.problem.id,
      participantId: actor.actorId,
      contributions: [
        {
          kind: 'question | claim | evidence | assumption | approach | contradiction | synthesis',
          content: 'string',
          confidence: 'low | medium | high',
          relationTo: ['optional contribution ids'],
          endorsement: 'participant_review_required',
          ...(proposes
            ? {
                proposals: [
                  {
                    kind: 'relation | conflict | duplicate',
                    targetId: 'one of orchestration.candidateIds',
                    relationKind: 'supports | opens | contradicts | relates (relation only)',
                    conflictKind: 'source_conflict | knowledge_conflict | decision_conflict | assumption_conflict | commitment_conflict (conflict only)',
                    reason: 'one or two sentences a reviewer can check',
                    confidence: 0.6,
                  },
                ],
              }
            : {}),
        },
      ],
      privateProcessDisclosed: false,
    },
  }
}

export function validateContributionPackage(value: unknown, problemId: string): ContributionPackage {
  if (!value || typeof value !== 'object') throw new Error('JSON must be an object.')
  const data = value as Partial<ContributionPackage>
  if (data.$type !== 'ai.bridgework.brainstorm.contributionPackage') {
    throw new Error('Wrong $type — expected ai.bridgework.brainstorm.contributionPackage.')
  }
  if (data.problemId !== problemId) throw new Error('This package belongs to a different problem.')
  if (!Array.isArray(data.contributions) || data.contributions.length === 0) {
    throw new Error('contributions must be a non-empty array.')
  }
  if (data.privateProcessDisclosed !== false) throw new Error('privateProcessDisclosed must be false.')
  for (const item of data.contributions) {
    if (typeof item?.content !== 'string' || item.content.trim() === '') {
      throw new Error('Every contribution needs non-empty content.')
    }
    if (item.proposals !== undefined && !Array.isArray(item.proposals)) {
      throw new Error('proposals must be an array when present.')
    }
  }
  // Proposals are only shape-checked here. The server screens them against
  // canonical state and reports anything it drops, with the reason.
  // participantId in the package is a hint, never proof: the server attributes
  // the contribution to whoever the session token resolves to.
  return data as ContributionPackage
}
