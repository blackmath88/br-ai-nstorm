/**
 * The participant-facing panels.
 *
 * Every panel here used to be a hardcoded array. All four are now derived from
 * the event log by the server, so "what happened to my contribution" is an
 * answer rather than a mock-up.
 */
import { useEffect, useState } from 'react'
import type { ContributionRecord, EvaluationRecord, ProblemUpdates, Stance } from '../lib/api'
import { attribution } from './StateView'
import { actorLabel } from './TimelineView'

const STANCES: Array<{ stance: Stance; label: string }> = [
  { stance: 'useful', label: 'Useful' },
  { stance: 'doubtful', label: 'Doubtful' },
  { stance: 'needs_evidence', label: 'Needs evidence' },
]

/**
 * Judging and retiring the selected contribution. Both are human acts on the
 * record: a judgement is attributed and counted, never averaged; superseding
 * keeps the old contribution, visibly retired.
 */
function SelectedActions({
  selected,
  evaluations,
  actorId,
  candidates,
  onEvaluate,
  onSupersede,
  busy,
}: {
  selected: ContributionRecord
  evaluations: EvaluationRecord[]
  actorId: string | null
  candidates: ContributionRecord[]
  onEvaluate: (stance: Stance, note?: string) => Promise<boolean>
  onSupersede: (supersededBy: string, reason?: string) => void
  busy: boolean
}) {
  const [note, setNote] = useState('')
  const [replacement, setReplacement] = useState('')
  const [reason, setReason] = useState('')
  useEffect(() => {
    setNote('')
    setReplacement('')
    setReason('')
  }, [selected.id])

  const judgements = evaluations.filter((e) => e.targetId === selected.id)
  const mine = judgements.find((e) => e.actorId === actorId)
  const others = judgements.filter((e) => e.actorId !== actorId)

  return (
    <div className="selected-actions">
      <div className="section-kicker">Your judgement</div>
      <div className="segmented" role="radiogroup" aria-label="Your judgement">
        {STANCES.map(({ stance, label }) => (
          <button
            key={stance}
            role="radio"
            aria-checked={mine?.stance === stance}
            className={mine?.stance === stance ? 'active' : ''}
            disabled={busy || !actorId || selected.status !== 'active'}
            onClick={() => {
              // Keep the note if recording fails, so nothing typed is lost.
              void onEvaluate(stance, note.trim() || undefined).then((recorded) => {
                if (recorded) setNote('')
              })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="orchestration-reason"
        placeholder="Optional note with your judgement"
        value={note}
        maxLength={1000}
        onChange={(event) => setNote(event.target.value)}
      />
      {others.length > 0 && (
        <ul className="judgement-list">
          {others.map((e) => (
            <li key={e.id}>
              <strong>{actorLabel(e.actorId)}</strong> {e.stance.replace('_', ' ')}
              {e.note ? ` — “${e.note}”` : ''}
            </li>
          ))}
        </ul>
      )}

      {selected.status === 'active' && candidates.length > 0 && (
        <details className="supersede">
          <summary>Superseded by another contribution…</summary>
          <select value={replacement} onChange={(event) => setReplacement(event.target.value)}>
            <option value="">Choose the contribution that replaces this one</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            className="orchestration-reason"
            placeholder="Why (optional, recorded in history)"
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            className="button"
            disabled={busy || !replacement}
            onClick={() => onSupersede(replacement, reason.trim() || undefined)}
          >
            Supersede — keep it, visibly retired
          </button>
        </details>
      )}
    </div>
  )
}

export function SideRail({
  updates,
  selected,
  evaluations,
  contributions,
  actorId,
  onEvaluate,
  onSupersede,
  draft,
  setDraft,
  onAdd,
  onThinkPrivate,
  busy,
  canContribute,
}: {
  updates: ProblemUpdates
  selected?: ContributionRecord
  evaluations: EvaluationRecord[]
  contributions: ContributionRecord[]
  actorId: string | null
  onEvaluate: (targetId: string, stance: Stance, note?: string) => Promise<boolean>
  onSupersede: (contributionId: string, supersededBy: string, reason?: string) => void
  draft: string
  setDraft: (value: string) => void
  onAdd: () => void
  onThinkPrivate: () => void
  busy: boolean
  canContribute: boolean
}) {
  return (
    <aside className="side-rail">
      <section className="rail-card">
        <div className="section-kicker">Since you were here</div>
        <h3>What moved</h3>
        {updates.updates.length === 0 ? (
          <p className="muted">Nothing has changed since your last contribution.</p>
        ) : (
          <div className="feed-list">
            {updates.updates.slice(0, 8).map((item) => (
              <div className="feed-item" key={item.eventId}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <span className="feed-meta">
                  {actorLabel(item.actorId)} · {new Date(item.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rail-card">
        <div className="section-kicker">Your traces</div>
        <h3>What happened to your contributions</h3>
        {updates.traces.length === 0 ? (
          <p className="muted">You have not contributed to this problem yet.</p>
        ) : (
          <div className="feed-list">
            {updates.traces.map((trace) => (
              <div className="feed-item" key={trace.contribution.id}>
                <strong>{trace.contribution.label}</strong>
                {trace.impact.map((line) => (
                  <span className="impact" key={line}>
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rail-card">
        <div className="section-kicker">Orchestration</div>
        <h3>Think next</h3>
        <div className="think-list">
          {updates.thinkNext.map((item) => (
            <div className="think-item" key={item}>
              {item}
            </div>
          ))}
          {updates.unresolvedConflicts.length > 0 && (
            <div className="think-item conflict-prompt">
              {updates.unresolvedConflicts.length} unresolved conflict
              {updates.unresolvedConflicts.length === 1 ? '' : 's'} in this problem. Conflict is knowledge here — it
              is worth thinking about, not closing.
            </div>
          )}
        </div>
      </section>

      <section className="rail-card">
        <div className="section-kicker">Selected</div>
        {selected ? (
          <div className="selected-node">
            <span className={`kind-chip ${selected.kind}`}>{selected.kind}</span>
            <h3>{selected.label}</h3>
            <p>{selected.content}</p>
            <div className="provenance">
              <div>
                <strong>authored by</strong> {selected.provenance.authoredBy}
              </div>
              {selected.provenance.preparedBy && (
                <div>
                  <strong>prepared by</strong> {selected.provenance.preparedBy}
                </div>
              )}
              <div>
                <strong>submitted by</strong> {selected.provenance.submittedBy}
              </div>
              <div>
                <strong>source</strong> {selected.provenance.source}
                {selected.provenance.sourceRef ? (
                  <>
                    {` · ${selected.provenance.sourceRef.path}#L${selected.provenance.sourceRef.startLine}`}
                    {selected.provenance.sourceRef.section ? ` · § ${selected.provenance.sourceRef.section}` : ''}
                    {selected.provenance.sourceRef.url?.startsWith('https://') && (
                      <>
                        {' · '}
                        <a href={selected.provenance.sourceRef.url} target="_blank" rel="noopener noreferrer">
                          open source lines ↗
                        </a>
                      </>
                    )}
                  </>
                ) : selected.provenance.sourceDetail ? (
                  ` · ${selected.provenance.sourceDetail}`
                ) : (
                  ''
                )}
              </div>
              <div>
                <strong>endorsement</strong> {selected.provenance.endorsement.replace(/_/g, ' ')}
              </div>
              <div>
                <strong>status</strong> {selected.status} · {new Date(selected.createdAt).toLocaleString()}
              </div>
            </div>
            <SelectedActions
              selected={selected}
              evaluations={evaluations}
              actorId={actorId}
              candidates={contributions.filter((c) => c.status === 'active' && c.id !== selected.id)}
              onEvaluate={(stance, note) => onEvaluate(selected.id, stance, note)}
              onSupersede={(by, reason) => onSupersede(selected.id, by, reason)}
              busy={busy}
            />
          </div>
        ) : (
          <p className="muted">Select anything in State or Map to inspect its full provenance chain.</p>
        )}
      </section>

      <section className="rail-card">
        <div className="section-kicker">Contribute</div>
        <h3>Add a thought</h3>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="An idea, question, objection, experience, evidence…"
          disabled={!canContribute}
        />
        <div className="button-row">
          <button className="button primary" onClick={onAdd} disabled={busy || !canContribute || !draft.trim()}>
            {busy ? 'Saving…' : 'Add to problem'}
          </button>
          <button className="button" onClick={onThinkPrivate} disabled={!canContribute}>
            Think privately ↗
          </button>
        </div>
        <p className="hint">
          {canContribute
            ? 'No classification needed first. Structure is suggested after the thought exists, and only you can accept it.'
            : 'Choose a participant to contribute.'}
        </p>
      </section>
    </aside>
  )
}
