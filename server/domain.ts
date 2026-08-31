export type ContributionKind = 'question' | 'claim' | 'evidence' | 'assumption' | 'approach' | 'contradiction'
export type RelationKind = 'supports' | 'opens' | 'contradicts' | 'relates' | 'supersedes'
export type ConflictKind = 'source_conflict' | 'knowledge_conflict' | 'decision_conflict' | 'assumption_conflict' | 'commitment_conflict'
export type ProposalKind = 'relation' | 'conflict' | 'duplicate' | 'classification'

export interface Actor {
  id: string
  name: string
}

export interface ProblemRecord {
  id: string
  title: string
  description: string
  createdAt: string
  createdBy: string
}

export interface ContributionRecord {
  id: string
  problemId: string
  authorId: string
  kind: ContributionKind
  content: string
  status: 'active' | 'superseded' | 'retracted'
  visibility: 'problem'
  createdAt: string
  source?: string
}

export interface RelationRecord {
  id: string
  problemId: string
  sourceId: string
  targetId: string
  kind: RelationKind
  status: 'accepted' | 'rejected'
  createdBy: string
  createdAt: string
}

export interface ConflictRecord {
  id: string
  problemId: string
  leftId: string
  rightId: string
  kind: ConflictKind
  status: 'open' | 'resolved' | 'dismissed'
  reason: string
  detectedBy: string
  confidence: number
  createdAt: string
}

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
  proposedBy: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export interface MemoryEvent {
  id: string
  type:
    | 'ProblemCreated'
    | 'ContributionAdded'
    | 'RelationProposed'
    | 'RelationAccepted'
    | 'RelationRejected'
    | 'ConflictProposed'
    | 'ConflictAccepted'
    | 'ConflictRejected'
    | 'ContributionClassified'
  problemId: string
  actorId: string
  objectId: string
  timestamp: string
  payload: Record<string, unknown>
}

export interface SharedMemoryData {
  actors: Actor[]
  problems: ProblemRecord[]
  contributions: ContributionRecord[]
  relations: RelationRecord[]
  conflicts: ConflictRecord[]
  proposals: CurationProposal[]
  events: MemoryEvent[]
}

export const now = () => new Date().toISOString()
export const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
