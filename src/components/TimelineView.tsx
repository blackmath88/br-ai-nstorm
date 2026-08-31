import type { ProblemSpace } from '../types/domain'

export function TimelineView({ problem }: { problem: ProblemSpace }) {
  return (
    <div className="timeline">
      {problem.timeline.map((item) => (
        <div className="timeline-row" key={`${item.date}-${item.title}`}>
          <div className="timeline-date">{new Date(item.date + 'T12:00:00').toLocaleDateString(undefined,{day:'2-digit',month:'short'})}</div>
          <div className={`timeline-marker ${item.kind}`} />
          <div className="timeline-body">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
