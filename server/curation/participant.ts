/**
 * Participant-side orchestration: the contributor's own LLM does the
 * judgement, the server does only the cheap, deterministic parts.
 *
 *   1. `rankCandidates` picks a bounded set of existing contributions for the
 *      participant's model to compare its draft against — lexical neighbours
 *      first, then the most recent, so a semantic link lexical matching misses
 *      is still in reach.
 *   2. `screenParticipantProposals` checks what comes back. It does not judge
 *      whether a proposal is *right* — that is the reviewer's job — only that
 *      it is well-formed, names real objects, and stays within bounds.
 *
 * Like the other curators, this module does not import `makeEvent`. Its output
 * is a list of drafts; only the application layer can append them.
 */
import type {
  ConflictKind, ContributionRecord, OrchestrationMode, RelationKind,
} from '../domain/types.js'
import { CONFLICT_KINDS, RELATION_KINDS } from '../domain/types.js'
import {
  AGENT_PREFIX, CONTEXT_CANDIDATE_LIMIT, MAX_PROPOSAL_REASON_LENGTH, PARTICIPANT_PROPOSAL_LIMIT,
} from '../domain/policies.js'
import { similarity, type ProposalDraft } from './deterministic.js'

/** What a participant's LLM may attach to a contribution. */
export interface ParticipantProposalInput {
  kind: 'relation' | 'conflict' | 'duplicate'
  targetId: string
  relationKind?: RelationKind
  conflictKind?: ConflictKind
  reason: string
  confidence?: number
}

export const PARTICIPANT_PROPOSAL_KINDS = ['relation', 'conflict', 'duplicate'] as const

export interface DroppedProposal {
  index: number
  reason: string
}

export interface ScreenResult {
  drafts: ProposalDraft[]
  dropped: DroppedProposal[]
}

export interface ScoredCandidate {
  contribution: ContributionRecord
  /** Lexical overlap with the draft, 0..1. Zero for recency fill. */
  overlap: number
}

/**
 * Turns a free-text model name into an agent id. The prefix guarantees it can
 * never be mistaken for a person or a server curator, whatever the client sent.
 */
export function agentIdFor(preparedBy: string | undefined): string {
  const slug = (preparedBy ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${AGENT_PREFIX}${slug || 'participant-llm'}`
}

/**
 * Bounded candidate set for a draft. Deterministic: same draft, same state,
 * same list.
 */
export function rankCandidates(
  draft: string,
  contributions: ContributionRecord[],
  limit = CONTEXT_CANDIDATE_LIMIT,
): ScoredCandidate[] {
  const active = contributions.filter((c) => c.status === 'active')
  const scored = active.map((contribution) => ({
    contribution,
    overlap: draft.trim() ? similarity(draft, contribution.content) : 0,
  }))

  const neighbours = scored
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.contribution.id.localeCompare(b.contribution.id))
    .slice(0, limit)

  if (neighbours.length >= limit) return neighbours

  const taken = new Set(neighbours.map((s) => s.contribution.id))
  const recent = scored
    .filter((s) => !taken.has(s.contribution.id))
    .sort(
      (a, b) =>
        b.contribution.createdAt.localeCompare(a.contribution.createdAt) ||
        b.contribution.id.localeCompare(a.contribution.id),
    )
    .slice(0, limit - neighbours.length)
    .map((s) => ({ ...s, overlap: 0 }))

  return [...neighbours, ...recent]
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Screens proposals a participant's LLM attached to its contribution.
 *
 * In `deterministic` mode every one is dropped — the problem has opted out of
 * AI judgement, and the response says so rather than silently ignoring them.
 */
export function screenParticipantProposals(input: {
  problemId: string
  mode: OrchestrationMode
  contribution: ContributionRecord
  contributions: ContributionRecord[]
  proposals: unknown
  agentId: string
  onBehalfOf: string
}): ScreenResult {
  const raw = input.proposals
  if (raw === undefined || raw === null) return { drafts: [], dropped: [] }
  if (!Array.isArray(raw)) {
    return { drafts: [], dropped: [{ index: -1, reason: 'proposals must be an array.' }] }
  }
  if (input.mode === 'deterministic') {
    return {
      drafts: [],
      dropped: raw.map((_, index) => ({
        index,
        reason: 'This problem uses deterministic orchestration; AI proposals are not accepted.',
      })),
    }
  }

  const known = new Map(
    input.contributions.filter((c) => c.status === 'active').map((c) => [c.id, c]),
  )
  const drafts: ProposalDraft[] = []
  const dropped: DroppedProposal[] = []
  const seen = new Set<string>()

  raw.forEach((item: unknown, index) => {
    const drop = (reason: string) => dropped.push({ index, reason })
    if (drafts.length >= PARTICIPANT_PROPOSAL_LIMIT) {
      return drop(`At most ${PARTICIPANT_PROPOSAL_LIMIT} proposals per contribution.`)
    }
    if (!item || typeof item !== 'object') return drop('Each proposal must be an object.')
    const p = item as Record<string, unknown>

    const kind = p.kind
    if (typeof kind !== 'string' || !(PARTICIPANT_PROPOSAL_KINDS as readonly string[]).includes(kind)) {
      return drop(`kind must be one of ${PARTICIPANT_PROPOSAL_KINDS.join(', ')}.`)
    }
    const targetId = p.targetId
    if (typeof targetId !== 'string' || !known.has(targetId)) {
      // The model does not get to invent object ids — the same rule the server
      // curator is held to.
      return drop('targetId must name an active contribution in this problem.')
    }
    if (targetId === input.contribution.id) return drop('A contribution cannot relate to itself.')

    const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
    if (!reason) return drop('Every proposal needs a reason a reviewer can read.')
    if (reason.length > MAX_PROPOSAL_REASON_LENGTH) {
      return drop(`reason may be at most ${MAX_PROPOSAL_REASON_LENGTH} characters.`)
    }

    let relationKind: RelationKind | undefined
    let conflictKind: ConflictKind | undefined
    if (kind === 'relation') {
      const value = p.relationKind ?? 'relates'
      if (typeof value !== 'string' || !(RELATION_KINDS as string[]).includes(value) || value === 'supersedes') {
        // Supersession is an authorial act, not something a model proposes.
        return drop(`relationKind must be one of ${RELATION_KINDS.filter((k) => k !== 'supersedes').join(', ')}.`)
      }
      relationKind = value as RelationKind
    }
    if (kind === 'conflict') {
      const value = p.conflictKind ?? 'knowledge_conflict'
      if (typeof value !== 'string' || !(CONFLICT_KINDS as string[]).includes(value)) {
        return drop(`conflictKind must be one of ${CONFLICT_KINDS.join(', ')}.`)
      }
      conflictKind = value as ConflictKind
    }

    const key = `${kind}:${targetId}`
    if (seen.has(key)) return drop('Duplicate of an earlier proposal in this request.')
    seen.add(key)

    const confidence = typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? clamp(p.confidence) : 0.5

    drafts.push({
      problemId: input.problemId,
      kind,
      sourceId: input.contribution.id,
      targetId,
      ...(relationKind ? { relationKind } : {}),
      ...(conflictKind ? { conflictKind } : {}),
      reason,
      confidence,
      proposedBy: input.agentId,
      onBehalfOf: input.onBehalfOf,
    } as ProposalDraft)
  })

  return { drafts, dropped }
}
