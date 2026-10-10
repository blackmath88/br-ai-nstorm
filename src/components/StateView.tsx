/**
 * The canonical view: what the group currently understands.
 *
 * Unresolved accepted conflicts render first and prominently. Conflict is part
 * of the knowledge here, not an error state, so it is not tucked away in a
 * panel the reader has to go looking for.
 */
import { useState } from 'react'
import type { ConflictRecord, ContributionKind, ContributionRecord, EvaluationRecord } from '../lib/api'
import { actorLabel } from './TimelineView'

const ORDER: ContributionKind[] = ['question', 'approach', 'evidence', 'assumption', 'contradiction', 'claim', 'synthesis']

const HEADINGS: Record<ContributionKind, string> = {
  question: 'Open questions',
  approach: 'Approaches',
  evidence: 'Evidence',
  assumption: 'Assumptions',
  contradiction: 'Tensions',
  claim: 'Claims',
  synthesis: 'Emerging synthesis',
}

const STANCE_LABEL: Record<EvaluationRecord['stance'], string> = {
  useful: 'useful',
  doubtful: 'doubtful',
  needs_evidence: 'needs evidence',
}

/** Counts per stance — shown as counts, never folded into a score. */
export function stanceCounts(evaluations: EvaluationRecord[], targetId: string) {
  const counts: Partial<Record<EvaluationRecord['stance'], number>> = {}
  for (const e of evaluations) if (e.targetId === targetId) counts[e.stance] = (counts[e.stance] ?? 0) + 1
  return counts
}

function StanceChips({ counts }: { counts: Partial<Record<EvaluationRecord['stance'], number>> }) {
  const entries = Object.entries(counts) as Array<[EvaluationRecord['stance'], number]>
  if (entries.length === 0) return null
  return (
    <span className="stance-chips">
      {entries.map(([stance, n]) => (
        <span className={`stance-chip ${stance}`} key={stance}>
          {n} {STANCE_LABEL[stance]}
        </span>
      ))}
    </span>
  )
}

/** Closing a conflict asks for the note the group keeps; nothing closes silently. */
function CloseConflict({
  onClose,
  busy,
}: {
  onClose: (action: 'resolve' | 'dismiss', note: string) => Promise<boolean>
  busy: boolean
}) {
  const [action, setAction] = useState<'resolve' | 'dismiss' | null>(null)
  const [note, setNote] = useState('')
  if (!action) {
    return (
      <div className="button-row conflict-actions">
        <button className="button" disabled={busy} onClick={() => setAction('resolve')}>
          Resolve…
        </button>
        <button className="button" disabled={busy} onClick={() => setAction('dismiss')}>
          Not a real conflict…
        </button>
      </div>
    )
  }
  return (
    <div className="conflict-close">
      <textarea
        className="note-input"
        value={note}
        maxLength={1000}
        autoFocus
        placeholder={action === 'resolve' ? 'How was it resolved? This note stays with the conflict.' : 'Why is this not a real conflict?'}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy || note.trim().length < 10}
          onClick={() => {
            void onClose(action, note.trim()).then((done) => {
              if (done) {
                setAction(null)
                setNote('')
              }
            })
          }}
        >
          {action === 'resolve' ? 'Record resolution' : 'Dismiss with note'}
        </button>
        <button className="button" disabled={busy} onClick={() => setAction(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const CONFLICT_LABEL: Record<string, string> = {
  source_conflict: 'source conflict',
  knowledge_conflict: 'knowledge conflict',
  decision_conflict: 'decision conflict',
  assumption_conflict: 'assumption conflict',
  commitment_conflict: 'commitment conflict',
}

/** Reads the person out of a provenance envelope without flattening the roles. */
export function attribution(contribution: ContributionRecord): string {
  const { authoredBy, preparedBy, endorsement, source, sourceRef } = contribution.provenance
  if (source === 'repo_import') {
    // "name · path#L5-L7 · unreviewed"
    const repo = authoredBy.replace(/^repo:/, '').split('/').pop()
    const where = sourceRef ? `${sourceRef.path}#L${sourceRef.startLine}` : undefined
    return `${repo}${where ? ` · ${where}` : ''}${endorsement === 'human_endorsed' ? '' : ' · unreviewed'}`
  }
  const who = authoredBy.replace(/^person:/, '').replace(/^seed:/, '')
  if (!preparedBy) return who
  // "AI prepared" is never displayed as "human authored".
  return `${who} · drafted by ${preparedBy}${endorsement === 'human_endorsed' ? ' · endorsed' : ' · unreviewed'}`
}

export function StateView({
  contributions,
  conflicts,
  evaluations,
  onSelect,
  selectedId,
  onCloseConflict,
  busy,
}: {
  contributions: ContributionRecord[]
  conflicts: ConflictRecord[]
  evaluations: EvaluationRecord[]
  onSelect: (id: string) => void
  selectedId?: string
  onCloseConflict: (conflictId: string, action: 'resolve' | 'dismiss', note: string) => Promise<boolean>
  busy: boolean
}) {
  const active = contributions.filter((c) => c.status === 'active')
  const superseded = contributions.filter((c) => c.status === 'superseded')
  const byId = new Map(contributions.map((c) => [c.id, c]))
  const open = conflicts.filter((c) => c.status === 'open')
  const closed = conflicts.filter((c) => c.status !== 'open')
  const label = (id: string) => byId.get(id)?.label ?? id

  return (
    <div className="state-stack">
      {open.length > 0 && (
        <section className="conflict-band">
          <div className="section-kicker">Unresolved conflicts · canonical</div>
          <div className="conflict-list">
            {open.map((conflict) => (
              <div className="conflict-card" key={conflict.id}>
                <div className="conflict-head">
                  <span className="conflict-chip">{CONFLICT_LABEL[conflict.conflictType] ?? conflict.conflictType}</span>
                  <span className="conflict-meta">
                    detected by {conflict.detectedBy} · accepted by {conflict.reviewedBy?.replace('person:', '') ?? '—'}
                  </span>
                </div>
                <div className="conflict-pair">
                  <button className="conflict-side" onClick={() => onSelect(conflict.leftObjectId)}>
                    {byId.get(conflict.leftObjectId)?.label ?? conflict.leftObjectId}
                  </button>
                  <span className="conflict-vs">↔</span>
                  <button className="conflict-side" onClick={() => onSelect(conflict.rightObjectId)}>
                    {byId.get(conflict.rightObjectId)?.label ?? conflict.rightObjectId}
                  </button>
                </div>
                <p className="conflict-reason">{conflict.reason}</p>
                <CloseConflict busy={busy} onClose={(action, note) => onCloseConflict(conflict.id, action, note)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="state-grid">
        {ORDER.map((kind) => {
          const items = active.filter((c) => c.kind === kind)
          if (items.length === 0) return null
          return (
            <section className="state-section" key={kind}>
              <div className="section-kicker">
                {HEADINGS[kind]} · {items.length}
              </div>
              <div className="state-list">
                {items.map((contribution) => (
                  <button
                    className={`state-card kind-${contribution.kind}${selectedId === contribution.id ? ' selected' : ''}`}
                    key={contribution.id}
                    onClick={() => onSelect(contribution.id)}
                  >
                    <span className="state-card-top">
                      <span className={`kind-dot ${contribution.kind}`} />
                      <strong>{contribution.label}</strong>
                    </span>
                    <span className="state-card-detail">{contribution.content}</span>
                    <span className="state-card-meta">{attribution(contribution)}</span>
                    <StanceChips counts={stanceCounts(evaluations, contribution.id)} />
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {superseded.length > 0 && (
        <section className="state-section superseded">
          <div className="section-kicker">Superseded · kept, never deleted · {superseded.length}</div>
          <div className="state-list">
            {superseded.map((contribution) => (
              <button className="state-card muted-card" key={contribution.id} onClick={() => onSelect(contribution.id)}>
                <span className="state-card-top">
                  <strong>{contribution.label}</strong>
                </span>
                <span className="state-card-meta">
                  {attribution(contribution)} · superseded by {byId.get(contribution.supersededBy ?? '')?.label ?? '—'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section className="state-section closed-conflicts">
          <div className="section-kicker">Closed conflicts · kept with their notes · {closed.length}</div>
          <div className="state-list">
            {closed.map((conflict) => (
              <div className="state-card muted-card closed-conflict" key={conflict.id}>
                <span className="state-card-top">
                  <span className={`status-chip ${conflict.status}`}>{conflict.status}</span>
                  <strong>
                    {label(conflict.leftObjectId)} ↔ {label(conflict.rightObjectId)}
                  </strong>
                </span>
                <span className="state-card-detail">“{conflict.resolutionNote}”</span>
                <span className="state-card-meta">
                  {conflict.resolvedBy ? actorLabel(conflict.resolvedBy) : '—'}
                  {conflict.resolvedAt ? ` · ${new Date(conflict.resolvedAt).toLocaleDateString()}` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {active.length === 0 && open.length === 0 && (
        <p className="muted">This problem has no contributions yet. Add the first one from the panel on the right.</p>
      )}
    </div>
  )
}
