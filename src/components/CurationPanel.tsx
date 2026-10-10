/**
 * The review queue.
 *
 * This is where the architecture becomes visible to a person: a proposal sits
 * here, attributed to the curator that produced it, until a participant accepts
 * or rejects it. Nothing on this screen is canonical yet, and the copy says so.
 */
import { useState } from 'react'
import type {
  ContributionRecord, CurationProposal, OrchestrationMode, OrchestrationOption, OrchestrationSetting,
} from '../lib/api'
import { actorLabel } from './TimelineView'

const KIND_COPY: Record<CurationProposal['kind'], { title: string; accept: string }> = {
  relation: { title: 'Possible relationship', accept: 'Accept relation' },
  conflict: { title: 'Possible conflict', accept: 'Accept conflict' },
  duplicate: { title: 'Possible duplicate', accept: 'Record as related' },
  classification: { title: 'Possible reclassification', accept: 'Accept' },
}

const MODE_LABEL: Record<OrchestrationMode, string> = {
  participant: 'Participant AI',
  api: 'Server API',
  deterministic: 'No AI',
}

/** "Kai’s AI (claude)" for an agent acting for a person; the curator id otherwise. */
export function proposerLabel(proposal: CurationProposal): string {
  if (!proposal.onBehalfOf) return proposal.proposedBy
  const model = proposal.proposedBy.replace(/^agent:/, '')
  return `${actorLabel(proposal.onBehalfOf)}’s AI${model && model !== 'participant-llm' ? ` (${model})` : ''}`
}

function OrchestrationSwitch({
  setting,
  options,
  onChange,
  busy,
}: {
  setting: OrchestrationSetting
  options: OrchestrationOption[]
  onChange: (mode: OrchestrationMode, reason?: string) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  const current = options.find((o) => o.mode === setting.mode)

  return (
    <div className="orchestration">
      <div className="orchestration-head">
        <div className="section-kicker">Who does the AI judgement</div>
        {setting.changedBy && (
          <span className="curation-meta">
            set by {actorLabel(setting.changedBy)}
            {setting.changedAt ? ` · ${new Date(setting.changedAt).toLocaleDateString()}` : ''}
            {setting.reason ? ` · “${setting.reason}”` : ''}
          </span>
        )}
      </div>
      <div className="segmented" role="radiogroup" aria-label="Orchestration mode">
        {options.map((option) => (
          <button
            key={option.mode}
            role="radio"
            aria-checked={option.mode === setting.mode}
            className={option.mode === setting.mode ? 'active' : ''}
            disabled={busy || !option.available || option.mode === setting.mode}
            title={option.available ? option.summary : 'Not configured on this server.'}
            onClick={() => {
              onChange(option.mode, reason.trim() || undefined)
              setReason('')
            }}
          >
            {MODE_LABEL[option.mode]}
            {!option.available && <span className="unavailable"> · unavailable</span>}
          </button>
        ))}
      </div>
      {current && <p className="orchestration-summary">{current.summary}</p>}
      <input
        className="orchestration-reason"
        placeholder="Reason for switching (optional, recorded in history)"
        value={reason}
        maxLength={200}
        onChange={(event) => setReason(event.target.value)}
      />
    </div>
  )
}

export function CurationPanel({
  proposals,
  contributions,
  onReview,
  busy,
  actorId,
  orchestration,
  orchestrationOptions,
  onSetOrchestration,
}: {
  proposals: CurationProposal[]
  contributions: ContributionRecord[]
  onReview: (proposalId: string, accept: boolean) => void
  busy: boolean
  actorId: string | null
  orchestration: OrchestrationSetting
  orchestrationOptions: OrchestrationOption[]
  onSetOrchestration: (mode: OrchestrationMode, reason?: string) => void
}) {
  const pending = proposals.filter((p) => p.status === 'pending')
  const reviewed = proposals.filter((p) => p.status !== 'pending')
  const labels = new Map(contributions.map((c) => [c.id, c.label]))
  const label = (id?: string) => (id ? (labels.get(id) ?? id) : '—')

  return (
    <div className="curation">
      <OrchestrationSwitch
        setting={orchestration}
        options={orchestrationOptions}
        onChange={onSetOrchestration}
        busy={busy}
      />

      <p className="curation-note">
        A curator may only propose. Nothing here has changed shared memory. Accepting is a human act, recorded
        against you in history.
      </p>

      {pending.length === 0 && <p className="muted">Nothing waiting for review.</p>}

      <div className="curation-list">
        {pending.map((proposal) => {
          const own = Boolean(actorId && proposal.onBehalfOf === actorId)
          return (
          <div className="curation-card" key={proposal.id}>
            <div className="curation-head">
              <span className={`kind-chip proposal-${proposal.kind}`}>{KIND_COPY[proposal.kind].title}</span>
              <span className="curation-meta">
                {proposerLabel(proposal)} · confidence {proposal.confidence.toFixed(2)}
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

            {own ? (
              <p className="hint">Your AI proposed this. Another participant has to review it.</p>
            ) : (
              <div className="button-row">
                <button className="button primary" disabled={busy} onClick={() => onReview(proposal.id, true)}>
                  {KIND_COPY[proposal.kind].accept}
                </button>
                <button className="button" disabled={busy} onClick={() => onReview(proposal.id, false)}>
                  Reject
                </button>
              </div>
            )}
          </div>
          )
        })}
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
