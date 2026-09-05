/**
 * The participant-facing panels.
 *
 * Every panel here used to be a hardcoded array. All four are now derived from
 * the event log by the server, so "what happened to my contribution" is an
 * answer rather than a mock-up.
 */
import type { ContributionRecord, ProblemUpdates } from '../lib/api'
import { attribution } from './StateView'
import { actorLabel } from './TimelineView'

export function SideRail({
  updates,
  selected,
  draft,
  setDraft,
  onAdd,
  onThinkPrivate,
  busy,
  canContribute,
}: {
  updates: ProblemUpdates
  selected?: ContributionRecord
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
                {selected.provenance.sourceDetail ? ` · ${selected.provenance.sourceDetail}` : ''}
              </div>
              <div>
                <strong>endorsement</strong> {selected.provenance.endorsement.replace(/_/g, ' ')}
              </div>
              <div>
                <strong>status</strong> {selected.status} · {new Date(selected.createdAt).toLocaleString()}
              </div>
            </div>
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
