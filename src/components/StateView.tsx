/**
 * The canonical view: what the group currently understands.
 *
 * Unresolved accepted conflicts render first and prominently. Conflict is part
 * of the knowledge here, not an error state, so it is not tucked away in a
 * panel the reader has to go looking for.
 */
import type { ConflictRecord, ContributionKind, ContributionRecord } from '../lib/api'

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

const CONFLICT_LABEL: Record<string, string> = {
  source_conflict: 'source conflict',
  knowledge_conflict: 'knowledge conflict',
  decision_conflict: 'decision conflict',
  assumption_conflict: 'assumption conflict',
  commitment_conflict: 'commitment conflict',
}

/** Reads the person out of a provenance envelope without flattening the roles. */
export function attribution(contribution: ContributionRecord): string {
  const { authoredBy, preparedBy, endorsement } = contribution.provenance
  const who = authoredBy.replace(/^person:/, '').replace(/^seed:/, '')
  if (!preparedBy) return who
  // "AI prepared" is never displayed as "human authored".
  return `${who} · drafted by ${preparedBy}${endorsement === 'human_endorsed' ? ' · endorsed' : ' · unreviewed'}`
}

export function StateView({
  contributions,
  conflicts,
  onSelect,
  selectedId,
}: {
  contributions: ContributionRecord[]
  conflicts: ConflictRecord[]
  onSelect: (id: string) => void
  selectedId?: string
}) {
  const active = contributions.filter((c) => c.status === 'active')
  const superseded = contributions.filter((c) => c.status === 'superseded')
  const byId = new Map(contributions.map((c) => [c.id, c]))
  const open = conflicts.filter((c) => c.status === 'open')

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

      {active.length === 0 && open.length === 0 && (
        <p className="muted">This problem has no contributions yet. Add the first one from the panel on the right.</p>
      )}
    </div>
  )
}
