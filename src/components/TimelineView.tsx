/**
 * The diachronic derived view: the event log, read as a story.
 *
 * In v0.2 this was a hand-written array of four items. It is now the actual
 * history, so it can no longer disagree with what happened — including the
 * causal links between a contribution and the proposals it triggered.
 */
import type { ContributionRecord, MemoryEvent } from '../lib/api'

const MARKER: Record<string, string> = {
  ProblemCreated: 'problem',
  ContributionAdded: 'approach',
  ContributionEdited: 'approach',
  ContributionSuperseded: 'assumption',
  RelationProposed: 'question',
  ConflictProposed: 'question',
  RelationAccepted: 'evidence',
  ConflictAccepted: 'contradiction',
  RelationRejected: 'assumption',
  ConflictRejected: 'assumption',
  EvaluationAdded: 'synthesis',
  VisibilityChanged: 'synthesis',
}

export const actorLabel = (actorId: string): string =>
  actorId.startsWith('person:')
    ? actorId.slice('person:'.length).replace(/^\w/, (c) => c.toUpperCase())
    : actorId

function summarise(event: MemoryEvent, label: (id: string) => string): { title: string; detail: string } {
  const p = event.payload as Record<string, unknown>
  switch (event.eventType) {
    case 'ProblemCreated':
      return { title: 'Problem opened', detail: String(p.title ?? '') }
    case 'ContributionAdded':
      return { title: `New ${String(p.kind ?? 'contribution')}`, detail: String(p.label ?? '') }
    case 'ContributionEdited':
      return { title: 'Contribution edited', detail: label(event.objectId) }
    case 'ContributionSuperseded':
      return { title: 'Contribution superseded', detail: `${label(event.objectId)} → ${label(String(p.supersededBy))}` }
    case 'VisibilityChanged':
      return { title: 'Visibility changed', detail: `${label(event.objectId)} → ${String(p.to)}` }
    case 'RelationProposed':
      return { title: `${String(p.kind)} proposed`, detail: String(p.reason ?? '') }
    case 'ConflictProposed':
      return { title: 'Conflict proposed', detail: String(p.reason ?? '') }
    case 'RelationAccepted':
      return {
        title: 'Relation accepted',
        detail: `${label(String(p.sourceId))} — ${String(p.relationKind)} → ${label(String(p.targetId))}`,
      }
    case 'ConflictAccepted':
      return {
        title: 'Conflict accepted',
        detail: `${label(String(p.leftObjectId))} ↔ ${label(String(p.rightObjectId))}`,
      }
    case 'RelationRejected':
      return { title: 'Relation proposal rejected', detail: 'Declined on review; nothing became canonical.' }
    case 'ConflictRejected':
      return { title: 'Conflict proposal rejected', detail: 'Declined on review; nothing became canonical.' }
    case 'EvaluationAdded':
      return { title: 'Evaluation added', detail: `${String(p.stance)} · ${label(String(p.targetId))}` }
    default:
      return { title: event.eventType, detail: '' }
  }
}

export function TimelineView({
  events,
  contributions,
}: {
  events: MemoryEvent[]
  contributions: ContributionRecord[]
}) {
  if (events.length === 0) return <p className="muted">No history yet.</p>

  const labels = new Map(contributions.map((c) => [c.id, c.label]))
  const label = (id: string) => labels.get(id) ?? id
  const ordered = [...events].reverse()

  return (
    <div className="timeline">
      {ordered.map((event) => {
        const { title, detail } = summarise(event, label)
        const when = new Date(event.timestamp)
        return (
          <div className="timeline-row" key={event.id}>
            <div className="timeline-date">
              {when.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
              <span className="timeline-time">
                {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className={`timeline-marker ${MARKER[event.eventType] ?? 'problem'}`} />
            <div className="timeline-body">
              <strong>{title}</strong>
              <p>{detail}</p>
              <span className="timeline-actor">
                {actorLabel(event.actorId)} · {event.eventType}
                {event.causationId ? ' · follows a contribution' : ''}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
