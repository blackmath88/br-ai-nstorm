import type { NodeKind, ProblemSpace } from '../types/domain'

const order: NodeKind[] = ['question','approach','evidence','assumption','contradiction','synthesis']

const headings: Partial<Record<NodeKind,string>> = {
  question:'Open questions',
  approach:'Approaches',
  evidence:'Evidence',
  assumption:'Assumptions',
  contradiction:'Tensions',
  synthesis:'Emerging synthesis',
}

export function StateView({ problem, onSelectNode }: { problem: ProblemSpace; onSelectNode: (id: string)=>void }) {
  return (
    <div className="state-grid">
      {order.map((kind) => {
        const nodes = problem.nodes.filter((n) => n.kind === kind)
        if (!nodes.length) return null
        return (
          <section className="state-section" key={kind}>
            <div className="section-kicker">{headings[kind]}</div>
            <div className="state-list">
              {nodes.map((node) => (
                <button className={`state-card kind-${node.kind}`} key={node.id} onClick={() => onSelectNode(node.id)}>
                  <span className="state-card-top">
                    <span className={`kind-dot ${node.kind}`} />
                    <strong>{node.label}</strong>
                  </span>
                  <span className="state-card-detail">{node.detail}</span>
                  <span className="state-card-meta">{node.status} · {node.author}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
