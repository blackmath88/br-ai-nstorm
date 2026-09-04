/**
 * Vocabulary used only by the pre-backend seed data in `src/data/problems.ts`,
 * which `server/persistence/seed.ts` imports once to bootstrap the event log.
 * The live vocabulary is `server/domain/types.ts`; the UI reads that one.
 */
export type NodeKind =
  | 'problem'
  | 'question'
  | 'approach'
  | 'evidence'
  | 'assumption'
  | 'contradiction'
  | 'synthesis'

export type RelationKind = 'supports' | 'opens' | 'contradicts' | 'relates'

export interface ProblemNode {
  id: string
  kind: NodeKind
  label: string
  detail: string
  status: string
  author: string
  createdAt: string
  weight?: number
  source?: string
}

export interface ProblemRelation {
  source: string
  target: string
  kind: RelationKind
}

export interface ActivityItem {
  title: string
  detail: string
}

export interface PersonalTrace {
  contribution: string
  impact: string
}

export interface TimelineItem {
  date: string
  title: string
  detail: string
  kind: NodeKind
}

export interface ProblemSpace {
  id: string
  title: string
  shortTitle: string
  description: string
  stateSummary: string
  nodes: ProblemNode[]
  relations: ProblemRelation[]
  updated: ActivityItem[]
  mine: PersonalTrace[]
  thinkNext: string[]
  timeline: TimelineItem[]
}

export interface ContributionPackage {
  $type: 'ai.bridgework.brainstorm.contributionPackage'
  schemaVersion: '0.1'
  problemId: string
  participantId: string
  contributions: Array<{
    kind: Exclude<NodeKind, 'problem' | 'synthesis'>
    content: string
    confidence?: 'low' | 'medium' | 'high'
    relationTo?: string[]
    endorsement?: 'participant_review_required' | 'human_endorsed'
  }>
  privateProcessDisclosed: false
}
