/**
 * The shared-memory ontology.
 *
 * This is the single vocabulary for the whole system. v0.2 kept two divergent
 * ones (`src/types/domain.ts` had `synthesis` but no `claim`; `server/domain.ts`
 * had `claim` but no `synthesis`) and silently coerced between them at the seed
 * boundary. There is now one definition, and it lives server-side.
 *
 * Nothing here imports a transport, a clock, or a store.
 */

export type ContributionKind =
  | 'question'
  | 'claim'
  | 'evidence'
  | 'assumption'
  | 'approach'
  | 'contradiction'
  | 'synthesis'

export const CONTRIBUTION_KINDS: ContributionKind[] = [
  'question', 'claim', 'evidence', 'assumption', 'approach', 'contradiction', 'synthesis',
]

export type RelationKind = 'supports' | 'opens' | 'contradicts' | 'relates' | 'supersedes'

export const RELATION_KINDS: RelationKind[] = ['supports', 'opens', 'contradicts', 'relates', 'supersedes']

/**
 * Conflict is part of knowledge, not an error state. The taxonomy distinguishes
 * *what kind of disagreement* this is, because "two sources disagree" and "two
 * people have committed to incompatible actions" are not the same problem.
 */
export type ConflictKind =
  | 'source_conflict'
  | 'knowledge_conflict'
  | 'decision_conflict'
  | 'assumption_conflict'
  | 'commitment_conflict'

export const CONFLICT_KINDS: ConflictKind[] = [
  'source_conflict', 'knowledge_conflict', 'decision_conflict', 'assumption_conflict', 'commitment_conflict',
]

export type ProposalKind = 'relation' | 'conflict' | 'duplicate' | 'classification'

/**
 * Who does the AI judgement for a problem — and therefore who pays for it.
 *
 *  - `participant`   the contributor's own LLM proposes relations/conflicts as
 *                    part of its contribution, from a bounded candidate set the
 *                    server hands out. The server spends nothing on inference.
 *  - `api`           the server's AI curator runs on every contribution, on the
 *                    operator's key. Only selectable when one is configured.
 *  - `deterministic` lexical curation only. No AI judgement from anyone.
 *
 * The deterministic curator runs in every mode as the floor. One mode per
 * problem, never per participant, so a reviewer can always tell why a
 * contribution did or did not arrive with AI proposals.
 */
export type OrchestrationMode = 'participant' | 'api' | 'deterministic'

export const ORCHESTRATION_MODES: OrchestrationMode[] = ['participant', 'api', 'deterministic']

export const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = 'participant'

export interface OrchestrationSetting {
  mode: OrchestrationMode
  /** Absent while the problem is still on the default it was created with. */
  changedBy?: string
  changedAt?: string
  reason?: string
}

/**
 * How a contribution reached shared memory. This is deliberately *not* the same
 * field as who authored it — see {@link Provenance}.
 */
export type ContributionSource =
  | 'direct'          // typed straight into the shared room
  | 'ai_assisted'     // drafted with an AI, submitted by a human
  | 'external_llm'    // returned through the clipboard aperture
  | 'mcp'             // arrived through an MCP client
  | 'seed'            // imported from the pre-backend prototype data
  | 'repo_import'     // extracted deterministically from a source repository's documents

export type Endorsement = 'participant_review_required' | 'human_endorsed'

/**
 * A qualified attribution, in the sense of W3C PROV-O's `prov:qualifiedAttribution`.
 *
 * A single flat `author` string cannot express the role an agent played, which
 * is why PROV-O qualifies attribution and why we do too. The two collapses this
 * type exists to prevent:
 *
 *   - "AI prepared" must not become "human authored"  -> `preparedBy` is separate
 *     from `authoredBy`, and is never a person.
 *   - "Person said X" must not become "X is true"     -> `endorsement` is a
 *     property of the contribution, and inclusion in shared state implies nothing.
 */
export interface Provenance {
  /**
   * The agent responsible for the content (`prov:wasAttributedTo`). A person,
   * or — only when no person can honestly be named — a namespaced origin:
   * `seed:*` for prototype data, `repo:<owner/name>` for repository imports.
   * Never an AI.
   */
  authoredBy: string
  /** The activity/agent that produced the text, when it was not the author directly (`prov:wasGeneratedBy`). */
  preparedBy?: string
  /** Who pushed it into shared memory. Usually equals `authoredBy`; differs for delegated submission. */
  submittedBy: string
  /** Set when a human has reviewed the contribution itself (not to be confused with proposal review). */
  reviewedBy?: string
  /** Set when a contribution is made visible beyond its original scope. */
  publishedBy?: string
  source: ContributionSource
  /** Free-text origin detail: a citation, a model id, an aperture package id. */
  sourceDetail?: string
  /**
   * Where in a repository the content came from, for `repo_import`. Structured
   * so nothing has to parse `sourceDetail` back apart.
   */
  sourceRef?: SourceRef
  endorsement: Endorsement
  /** When the contribution entered shared memory. */
  timestamp: string
}

export interface SourceRef {
  repository?: string
  revision?: string
  path: string
  startLine: number
  endLine: number
  section?: string
  url?: string
}

export interface Participant {
  id: string
  name: string
}

export interface ProblemRecord {
  id: string
  title: string
  shortTitle: string
  description: string
  /** Editorial one-line answer to "where is this problem now?". */
  stateSummary: string
  /** Orchestration prompts for the "Think next" panel. */
  thinkNext: string[]
  createdAt: string
  createdBy: string
  /** Who does the AI judgement for this problem. Folded from `OrchestrationModeChanged`. */
  orchestration: OrchestrationSetting
}

export type ContributionStatus = 'active' | 'superseded' | 'retracted'
export type Visibility = 'problem' | 'private'

export interface ContributionRecord {
  id: string
  problemId: string
  kind: ContributionKind
  /** Short display label, derived from content at creation time. */
  label: string
  content: string
  status: ContributionStatus
  visibility: Visibility
  provenance: Provenance
  createdAt: string
  updatedAt?: string
  /** Set by `ContributionSuperseded`. The record itself is never removed. */
  supersededBy?: string
}

export interface RelationRecord {
  id: string
  problemId: string
  sourceId: string
  targetId: string
  kind: RelationKind
  /** Only accepted relations exist as records; rejection leaves an event and no record. */
  createdBy: string
  createdAt: string
  fromProposalId?: string
}

export type ConflictStatus = 'open' | 'resolved' | 'dismissed'

export interface ConflictRecord {
  id: string
  problemId: string
  leftObjectId: string
  rightObjectId: string
  conflictType: ConflictKind
  reason: string
  /** The curator that proposed it — never a person. */
  detectedBy: string
  confidence: number
  status: ConflictStatus
  createdAt: string
  /** The person who accepted the proposal, making the conflict canonical. */
  reviewedBy?: string
  resolvedBy?: string
  resolvedAt?: string
  resolutionNote?: string
  fromProposalId?: string
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected'

export interface CurationProposal {
  id: string
  problemId: string
  kind: ProposalKind
  sourceId: string
  targetId?: string
  relationKind?: RelationKind
  conflictKind?: ConflictKind
  suggestedKind?: ContributionKind
  reason: string
  confidence: number
  /**
   * e.g. `curator:deterministic`, `curator:openai:<model>`, or `agent:<model>`
   * for a participant's own LLM. Never a person.
   */
  proposedBy: string
  /**
   * Set when the proposing agent acted for a participant (`prov:actedOnBehalfOf`)
   * — i.e. the contributor's own LLM proposed it in `participant` mode. That
   * participant may not be the one who accepts it.
   */
  onBehalfOf?: string
  status: ProposalStatus
  createdAt: string
  /** Always a person. Only a person can move a proposal out of `pending`. */
  reviewedBy?: string
  reviewedAt?: string
}

export interface EvaluationRecord {
  id: string
  problemId: string
  targetId: string
  actorId: string
  stance: 'useful' | 'doubtful' | 'needs_evidence'
  note?: string
  createdAt: string
}

/** The canonical projection: everything true about one problem right now. */
export interface ProblemState {
  problem: ProblemRecord
  contributions: ContributionRecord[]
  relations: RelationRecord[]
  conflicts: ConflictRecord[]
  proposals: CurationProposal[]
  evaluations: EvaluationRecord[]
}
