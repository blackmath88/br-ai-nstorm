/**
 * The review queue.
 *
 * This is where the architecture becomes visible to a person: a proposal sits
 * here, attributed to the curator that produced it, until a participant accepts
 * or rejects it. Nothing on this screen is canonical yet, and the copy says so.
 */
import type { ContributionRecord, CurationProposal } from '../lib/api'

const KIND_COPY: Record<CurationProposal['kind'], { title: string; accept: string }> = {
  relation: { title: 'Possible relationship', accept: 'Accept relation' },
  conflict: { title: 'Possible conflict', accept: 'Accept conflict' },
  duplicate: { title: 'Possible duplicate', accept: 'Record as related' },
  classification: { title: 'Possible reclassification', accept: 'Accept' },
}

/**
 * Review order, most consequential first. Accepting a conflict changes what the
 * group is looking at; accepting a reclassification moves a card between two
 * columns. Insertion order buried the conflicts under a run of cheap
 * classification proposals, which is the wrong thing to put in front of someone
 * with limited attention.
 */
const KIND_RANK: Record<CurationProposal['kind'], number> = {
  conflict: 0,
  duplicate: 1,
  relation: 2,
  classification: 3,
}

const byReviewPriority = (a: CurationProposal, b: CurationProposal): number =>
  KIND_RANK[a.kind] !== KIND_RANK[b.kind]
    ? KIND_RANK[a.kind] - KIND_RANK[b.kind]
    : b.confidence - a.confidence

export function CurationPanel({
  proposals,
  contributions,
  onReview,
  busy,
}: {
  proposals: CurationProposal[]
  contributions: ContributionRecord[]
  onReview: (proposalId: string, accept: boolean) => void
  busy: boolean
}) {
  const pending = proposals.filter((p) => p.status === 'pending').sort(byReviewPriority)
  // Most recently decided first — the history is for checking what just
  // happened, not for reading from the beginning.
  const reviewed = proposals
    .filter((p) => p.status !== 'pending')
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
  const labels = new Map(contributions.map((c) => [c.id, c.label]))
  const label = (id?: string) => (id ? (labels.get(id) ?? id) : '—')

  return (
    <div className="curation">
      <p className="curation-note">
        A curator may only propose. Nothing here has changed shared memory. Accepting is a human act, recorded
        against you in history.
      </p>

      {pending.length === 0 && <p className="muted">Nothing waiting for review.</p>}

      {pending.length > 0 && (
        <div className="section-kicker">
          Awaiting review · {pending.length} · most consequential first
        </div>
      )}

      <div className="curation-list">
        {pending.map((proposal) => (
          <div className="curation-card" key={proposal.id}>
            <div className="curation-head">
              <span className={`kind-chip proposal-${proposal.kind}`}>{KIND_COPY[proposal.kind].title}</span>
              <span className="curation-meta">
                {proposal.proposedBy} · confidence {proposal.confidence.toFixed(2)}
              </span>
            </div>

            <div className="curation-pair">
              <span className="curation-side">{label(proposal.sourceId)}</span>
              <span className="curation-arrow">
                {proposal.kind === 'conflict'
                  ? (proposal.conflictKind ?? 'conflict')
                  : proposal.kind === 'classification'
                    ? `→ ${proposal.suggestedKind}`
                    : (proposal.relationKind ?? 'relates')}
              </span>
              {proposal.kind !== 'classification' && <span className="curation-side">{label(proposal.targetId)}</span>}
            </div>

            <p className="curation-reason">{proposal.reason}</p>

            <div className="button-row">
              <button className="button primary" disabled={busy} onClick={() => onReview(proposal.id, true)}>
                {KIND_COPY[proposal.kind].accept}
              </button>
              <button className="button" disabled={busy} onClick={() => onReview(proposal.id, false)}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {reviewed.length > 0 && (
        <>
          <div className="section-kicker curation-history-kicker">Reviewed · {reviewed.length}</div>
          <div className="curation-history">
            {reviewed.map((proposal) => (
              <div className="curation-history-row" key={proposal.id}>
                <span className={`status-chip ${proposal.status}`}>{proposal.status}</span>
                <span>
                  {KIND_COPY[proposal.kind].title.toLowerCase()} · {label(proposal.sourceId)}
                  {proposal.targetId ? ` ↔ ${label(proposal.targetId)}` : ''}
                </span>
                <span className="curation-meta">by {proposal.reviewedBy?.replace('person:', '') ?? '—'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
