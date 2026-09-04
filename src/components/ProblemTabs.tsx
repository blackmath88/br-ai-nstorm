import type { ProblemRecord } from '../lib/api'

export function ProblemTabs({
  problems, activeId, onSelect,
}: {
  problems: ProblemRecord[]
  activeId: string
  onSelect: (id: string) => void
}) {
  return (
    <nav className="problem-tabs" aria-label="Problems">
      {problems.map((problem) => (
        <button
          key={problem.id}
          className={problem.id === activeId ? 'problem-tab active' : 'problem-tab'}
          onClick={() => onSelect(problem.id)}
        >
          {problem.shortTitle}
        </button>
      ))}
    </nav>
  )
}
