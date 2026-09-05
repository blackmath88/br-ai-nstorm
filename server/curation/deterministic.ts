/**
 * Deterministic curator.
 *
 * Runs first and handles the obvious cases cheaply, so the AI curator (and the
 * human reviewer) only deal with what lexical work cannot settle.
 *
 * Note what this module does NOT import: `makeEvent`. A curator's return type is
 * a list of proposal drafts. There is no code path from here to the event log —
 * which is how "AI may propose but never mutate canonical memory" is a
 * structural property rather than a promise in a prompt.
 */
import type { ContributionKind, ContributionRecord, CurationProposal } from '../domain/types.js'
import { PROPOSALS_PER_CONTRIBUTION_LIMIT } from '../domain/policies.js'

/** A proposal before the application layer gives it an identity and a status. */
export type ProposalDraft = Omit<CurationProposal, 'id' | 'status' | 'createdAt' | 'reviewedBy' | 'reviewedAt'>

export const DETERMINISTIC_CURATOR = 'curator:deterministic'

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have',
  'not', 'but', 'you', 'our', 'their', 'its', 'can', 'will', 'would', 'should', 'could',
  'der', 'die', 'das', 'und', 'ist', 'sind', 'nicht', 'mit', 'für', 'auf', 'den', 'dem',
])

const tokenize = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  )

/** Jaccard overlap. Crude on purpose: it is a trigger for review, not a verdict. */
export function similarity(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : shared / union
}

const CONFLICT_CUE =
  /\b(but|however|contradict|conflicts?|instead|cannot|can't|doesn't|does not|isn't|is not|won't|never|aber|jedoch|widerspricht|nicht)\b/i

export function inferKind(content: string): ContributionKind {
  const text = content.trim()
  if (text.endsWith('?')) return 'question'
  if (/\b(data|evidence|study|observed|measured|source|report|survey|messung|beleg)\b/i.test(text)) return 'evidence'
  if (/\b(assume|assumption|probably|likely|we think|vermutlich|annahme)\b/i.test(text)) return 'assumption'
  if (CONFLICT_CUE.test(text) && /\b(claim|said|argued|stated)\b/i.test(text)) return 'contradiction'
  if (/\b(should|could|proposal|option|approach|try|build|vorschlag|ansatz)\b/i.test(text)) return 'approach'
  return 'claim'
}

const DUPLICATE_THRESHOLD = 0.72
const RELATION_THRESHOLD = 0.38
const CONFLICT_THRESHOLD = 0.2

export interface DeterministicInput {
  problemId: string
  contribution: ContributionRecord
  candidates: ContributionRecord[]
}

export function proposeDeterministically(input: DeterministicInput): ProposalDraft[] {
  const { problemId, contribution, candidates } = input
  const drafts: ProposalDraft[] = []

  for (const other of candidates) {
    if (other.id === contribution.id || other.status !== 'active') continue
    const score = similarity(contribution.content, other.content)

    if (score >= DUPLICATE_THRESHOLD) {
      drafts.push({
        problemId,
        kind: 'duplicate',
        sourceId: contribution.id,
        targetId: other.id,
        reason: `High lexical overlap (${score.toFixed(2)}). Review whether these say the same thing.`,
        confidence: Math.min(0.98, score),
        proposedBy: DETERMINISTIC_CURATOR,
      })
    } else if (score >= RELATION_THRESHOLD) {
      drafts.push({
        problemId,
        kind: 'relation',
        sourceId: contribution.id,
        targetId: other.id,
        relationKind: 'relates',
        reason: `Shared vocabulary suggests a possible relationship (${score.toFixed(2)}).`,
        confidence: score,
        proposedBy: DETERMINISTIC_CURATOR,
      })
    }

    // A conflict cue plus shared subject matter is a reason to *ask*, never to conclude.
    if (score >= CONFLICT_THRESHOLD && CONFLICT_CUE.test(`${contribution.content} ${other.content}`)) {
      drafts.push({
        problemId,
        kind: 'conflict',
        sourceId: contribution.id,
        targetId: other.id,
        conflictKind: 'knowledge_conflict',
        reason:
          'These share subject matter and one of them carries a contradiction cue. Human review decides whether this is a real conflict or merely a difference.',
        confidence: Math.min(0.8, 0.45 + score),
        proposedBy: DETERMINISTIC_CURATOR,
      })
    }
  }

  const inferred = inferKind(contribution.content)
  if (inferred !== contribution.kind) {
    drafts.push({
      problemId,
      kind: 'classification',
      sourceId: contribution.id,
      suggestedKind: inferred,
      reason: `Deterministic classifier reads this as “${inferred}” rather than “${contribution.kind}”.`,
      confidence: 0.62,
      proposedBy: DETERMINISTIC_CURATOR,
    })
  }

  // Cap so a review queue stays reviewable by a human.
  return drafts
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, PROPOSALS_PER_CONTRIBUTION_LIMIT)
}
