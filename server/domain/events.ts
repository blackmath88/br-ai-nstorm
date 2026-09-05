/**
 * The deterministic event model.
 *
 * Events are the ONLY writable truth. Canonical state is a fold over them
 * (`projections.ts`). v0.2 stored records and events as two parallel truths
 * written by separate code paths, which could silently drift; this replaces
 * both with one append-only log.
 *
 * Determinism comes from injecting `Clock` and `IdSource` rather than calling
 * `Date.now()` / `Math.random()` here. With a fixed clock, the same sequence of
 * commands produces a byte-identical event stream.
 */
import type {
  ConflictKind, ContributionKind, ContributionRecord, EvaluationRecord,
  ProblemRecord, Provenance, RelationKind, Visibility,
} from './types.js'

export type EventType =
  | 'ProblemCreated'
  | 'ContributionAdded'
  | 'ContributionEdited'
  | 'RelationProposed'
  | 'RelationAccepted'
  | 'RelationRejected'
  | 'ConflictProposed'
  | 'ConflictAccepted'
  | 'ConflictRejected'
  | 'EvaluationAdded'
  | 'ContributionSuperseded'
  | 'VisibilityChanged'

export const EVENT_TYPES: EventType[] = [
  'ProblemCreated', 'ContributionAdded', 'ContributionEdited',
  'RelationProposed', 'RelationAccepted', 'RelationRejected',
  'ConflictProposed', 'ConflictAccepted', 'ConflictRejected',
  'EvaluationAdded', 'ContributionSuperseded', 'VisibilityChanged',
]

export interface MemoryEvent<P = Record<string, unknown>> {
  id: string
  problemId: string
  /**
   * Who caused this event. Copied from the resolved `ActorContext` and from
   * nowhere else — no curator code path can construct an event, so attribution
   * cannot be manufactured by a model.
   */
  actorId: string
  timestamp: string
  /** The object this event is about: a contribution, relation, conflict, proposal or the problem. */
  objectId: string
  eventType: EventType
  payload: P
  /** The event that directly caused this one (e.g. the proposal review that minted a conflict). */
  causationId?: string
  /** Groups every event produced by one logical operation (e.g. a contribution and its proposals). */
  correlationId?: string
}

/** Injected time source. Tests supply a fixed clock. */
export interface Clock {
  now(): string
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
}

/**
 * Injected id source. Ids are monotonic and content-independent, so an event
 * stream is reproducible. A single counter is shared across prefixes, which
 * also makes ids sortable in creation order.
 */
export interface IdSource {
  next(prefix: string): string
}

export function createIdSource(start = 0): IdSource {
  let counter = start
  return {
    next: (prefix) => `${prefix}_${String(++counter).padStart(6, '0')}`,
  }
}

/** Recovers the counter high-water mark from an existing log, so ids stay unique across restarts. */
export function highWaterMark(events: MemoryEvent[]): number {
  let max = 0
  const scan = (id: string | undefined) => {
    if (!id) return
    const match = /_(\d+)$/.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  for (const event of events) {
    scan(event.id)
    scan(event.objectId)
    // Proposal and record ids are minted inside payloads too.
    for (const value of Object.values(event.payload)) {
      if (typeof value === 'string') scan(value)
    }
  }
  return max
}

// --- payloads -------------------------------------------------------------

export interface ProblemCreatedPayload {
  title: string
  shortTitle: string
  description: string
  stateSummary: string
  thinkNext: string[]
}

export interface ContributionAddedPayload {
  kind: ContributionKind
  label: string
  content: string
  visibility: Visibility
  provenance: Provenance
}

export interface ContributionEditedPayload {
  content?: string
  kind?: ContributionKind
  label?: string
  reason?: string
}

export interface ProposalPayload {
  proposalId: string
  kind: 'relation' | 'conflict' | 'duplicate' | 'classification'
  sourceId: string
  targetId?: string
  relationKind?: RelationKind
  conflictKind?: ConflictKind
  suggestedKind?: ContributionKind
  reason: string
  confidence: number
  proposedBy: string
}

export interface RelationAcceptedPayload {
  proposalId?: string
  sourceId: string
  targetId: string
  relationKind: RelationKind
}

export interface ConflictAcceptedPayload {
  proposalId?: string
  leftObjectId: string
  rightObjectId: string
  conflictType: ConflictKind
  reason: string
  detectedBy: string
  confidence: number
}

export interface ReviewRejectedPayload {
  proposalId: string
  reason?: string
}

export interface EvaluationAddedPayload {
  targetId: string
  stance: EvaluationRecord['stance']
  note?: string
}

export interface ContributionSupersededPayload {
  supersededBy: string
  reason?: string
}

export interface VisibilityChangedPayload {
  from: Visibility
  to: Visibility
  reason?: string
}

// --- constructor ----------------------------------------------------------

export interface EventFactoryDeps {
  clock: Clock
  ids: IdSource
}

export interface NewEvent<P> {
  problemId: string
  actorId: string
  objectId: string
  eventType: EventType
  payload: P
  causationId?: string
  correlationId?: string
}

/**
 * The only way to construct an event. Curator modules deliberately do not
 * import this, which is how "AI may propose but never mutate canonical memory"
 * becomes a structural property rather than a convention.
 */
export function makeEvent<P>(deps: EventFactoryDeps, input: NewEvent<P>): MemoryEvent<P> {
  return {
    id: deps.ids.next('evt'),
    problemId: input.problemId,
    actorId: input.actorId,
    timestamp: deps.clock.now(),
    objectId: input.objectId,
    eventType: input.eventType,
    payload: input.payload,
    ...(input.causationId ? { causationId: input.causationId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  }
}

/** Derives a short display label from free text without truncating mid-word where avoidable. */
export function deriveLabel(content: string, max = 56): string {
  const flat = content.trim().replace(/\s+/g, ' ')
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Contribution shape implied by a `ContributionAdded` event, used by the projection. */
export type ContributionSeed = Pick<
  ContributionRecord,
  'id' | 'problemId' | 'kind' | 'label' | 'content' | 'status' | 'visibility' | 'provenance' | 'createdAt'
>

export type { ProblemRecord }
