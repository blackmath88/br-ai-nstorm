import type { ProblemNode, ProblemSpace } from '../types/domain'

export function SideRail({
  problem, selectedNode, draft, setDraft, onAdd, onThinkPrivate,
}: {
  problem: ProblemSpace
  selectedNode?: ProblemNode
  draft: string
  setDraft: (value:string)=>void
  onAdd: ()=>void
  onThinkPrivate: ()=>void
}) {
  return (
    <aside className="side-rail">
      <section className="rail-card">
        <div className="section-kicker">Since you were here</div>
        <h3>What moved</h3>
        <div className="feed-list">
          {problem.updated.map((item)=><div className="feed-item" key={item.title}><strong>{item.title}</strong><span>{item.detail}</span></div>)}
        </div>
      </section>

      <section className="rail-card">
        <div className="section-kicker">Your traces</div>
        <h3>What happened to your contributions</h3>
        <div className="feed-list">
          {problem.mine.map((item)=><div className="feed-item" key={item.contribution}><strong>{item.contribution}</strong><span className="impact">{item.impact}</span></div>)}
        </div>
      </section>

      <section className="rail-card">
        <div className="section-kicker">Orchestration</div>
        <h3>Think next</h3>
        <div className="think-list">
          {problem.thinkNext.map((item)=><div className="think-item" key={item}>{item}</div>)}
        </div>
      </section>

      <section className="rail-card">
        <div className="section-kicker">Selected</div>
        {selectedNode ? (
          <div className="selected-node">
            <span className={`kind-chip ${selectedNode.kind}`}>{selectedNode.kind}</span>
            <h3>{selectedNode.label}</h3>
            <p>{selectedNode.detail}</p>
            <div className="provenance">By {selectedNode.author} · {selectedNode.createdAt} · {selectedNode.status}</div>
          </div>
        ) : <p className="muted">Select any item in State or Map view to inspect its provenance.</p>}
      </section>

      <section className="rail-card">
        <div className="section-kicker">Contribute</div>
        <h3>Add a thought</h3>
        <textarea value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder="An idea, question, objection, experience, evidence…" />
        <div className="button-row">
          <button className="button primary" onClick={onAdd}>Add to problem</button>
          <button className="button" onClick={onThinkPrivate}>Think privately ↗</button>
        </div>
        <p className="hint">No classification needed first. Structure can be suggested after the thought exists.</p>
      </section>
    </aside>
  )
}
