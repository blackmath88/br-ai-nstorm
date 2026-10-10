/**
 * The field-test report, as a participant sees it.
 *
 * Plain tables on purpose: these are counts people will quote and compare
 * across sessions, and a table is the honest form for that. Rates are shown
 * with their denominators, so "100%" from one review never reads like a
 * finding.
 */
import { useEffect, useState } from 'react'
import { api, ApiError, type FieldReport } from '../lib/api'
import { actorLabel } from './TimelineView'

type Stats = FieldReport['proposals']['total']

const ORIGIN_LABEL: Record<keyof FieldReport['proposals']['byOrigin'], string> = {
  participant_ai: 'Participants’ own AI',
  server_ai: 'Server AI curator',
  deterministic: 'Lexical matching',
}

const rate = (s: Stats) =>
  s.acceptanceRate === null ? '—' : `${Math.round(s.acceptanceRate * 100)}% of ${s.accepted + s.rejected}`

function StatsRow({ label, stats }: { label: string; stats: Stats }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{stats.proposed}</td>
      <td>{stats.accepted}</td>
      <td>{stats.rejected}</td>
      <td>{stats.pending}</td>
      <td>{rate(stats)}</td>
      <td>{stats.medianMinutesToReview === null ? '—' : `${stats.medianMinutesToReview} min`}</td>
    </tr>
  )
}

const statsHead = (first: string) => (
  <tr>
    <th scope="col">{first}</th>
    <th scope="col">Proposed</th>
    <th scope="col">Accepted</th>
    <th scope="col">Rejected</th>
    <th scope="col">Pending</th>
    <th scope="col">Acceptance</th>
    <th scope="col">Median review time</th>
  </tr>
)

export function ReportView({ token, problemId, version }: { token: string | null; problemId: string; version: number }) {
  const [report, setReport] = useState<FieldReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api
      .report(token, problemId)
      .then((next) => {
        if (!cancelled) {
          setReport(next)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the report.')
      })
    return () => {
      cancelled = true
    }
  }, [token, problemId, version])

  if (error) return <p className="muted">{error}</p>
  if (!report) return <p className="muted">Loading report…</p>

  const modes = Object.entries(report.proposals.byMode) as Array<[string, Stats]>

  return (
    <div className="report">
      <p className="curation-note">
        Derived from the event log; nothing here is stored or scored. The question this answers for a field test: do
        participants’ own AIs propose things people accept about as often as the server’s curator does?
      </p>

      <section>
        <div className="section-kicker">Proposals by origin</div>
        <div className="table-scroll">
          <table className="report-table">
            <thead>{statsHead('Origin')}</thead>
            <tbody>
              {(Object.keys(ORIGIN_LABEL) as Array<keyof typeof ORIGIN_LABEL>).map((origin) => (
                <StatsRow key={origin} label={ORIGIN_LABEL[origin]} stats={report.proposals.byOrigin[origin]} />
              ))}
              <StatsRow label="All" stats={report.proposals.total} />
            </tbody>
          </table>
        </div>
      </section>

      {modes.length > 0 && (
        <section>
          <div className="section-kicker">Proposals by the mode they were made under</div>
          <div className="table-scroll">
            <table className="report-table">
              <thead>{statsHead('Mode at the time')}</thead>
              <tbody>
                {modes.map(([mode, stats]) => (
                  <StatsRow key={mode} label={mode} stats={stats} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="section-kicker">Participants</div>
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Contributions</th>
                <th scope="col">AI-drafted</th>
                <th scope="col">Channels</th>
                <th scope="col">Their AI proposed</th>
                <th scope="col">Reviews</th>
                <th scope="col">Judgements</th>
              </tr>
            </thead>
            <tbody>
              {report.participants.map((p) => (
                <tr key={p.actorId}>
                  <th scope="row">{actorLabel(p.actorId)}</th>
                  <td>{p.contributions}</td>
                  <td>{p.aiPrepared}</td>
                  <td>
                    {Object.entries(p.bySource)
                      .map(([source, n]) => `${source} ${n}`)
                      .join(' · ') || '—'}
                  </td>
                  <td>{p.agentProposals}</td>
                  <td>{p.reviews}</td>
                  <td>{p.evaluations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-facts">
        <div>
          <div className="section-kicker">Conflicts</div>
          <p>
            {report.conflicts.accepted} accepted · {report.conflicts.open} open · {report.conflicts.resolved} resolved ·{' '}
            {report.conflicts.dismissed} dismissed
          </p>
        </div>
        <div>
          <div className="section-kicker">Judgements</div>
          <p>
            {report.evaluations.useful} useful · {report.evaluations.doubtful} doubtful ·{' '}
            {report.evaluations.needs_evidence} needs evidence
          </p>
        </div>
        <div>
          <div className="section-kicker">Orchestration</div>
          <p>
            now <strong>{report.orchestration.current}</strong>
            {report.orchestration.history.length > 0 &&
              ` · ${report.orchestration.history.length} switch${report.orchestration.history.length === 1 ? '' : 'es'}`}
          </p>
        </div>
      </section>
    </div>
  )
}
