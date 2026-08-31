import { useMemo, useState } from 'react'
import { BrainCircuit, GitBranch, History, LayoutList, Sparkles } from 'lucide-react'
import { problems as seedProblems } from './data/problems'
import type { NodeKind, ProblemSpace } from './types/domain'
import { ProblemTabs } from './components/ProblemTabs'
import { StateView } from './components/StateView'
import { MapView } from './components/MapView'
import { TimelineView } from './components/TimelineView'
import { SideRail } from './components/SideRail'
import { ApertureModal } from './components/ApertureModal'
import { createContextPackage, participant, validateContributionPackage } from './lib/aperture'

type ViewMode = 'state' | 'map' | 'timeline'
type ModalMode = 'export' | 'import' | null

function inferKind(text:string): Exclude<NodeKind,'problem'|'synthesis'> {
  if (text.trim().endsWith('?')) return 'question'
  if (/\b(evidence|data|study|observed|measured)\b/i.test(text)) return 'evidence'
  if (/\b(assume|assumption|probably|likely)\b/i.test(text)) return 'assumption'
  if (/\b(but|however|contradict|doesn't|not )\b/i.test(text)) return 'contradiction'
  return 'approach'
}

export default function App() {
  const [problems, setProblems] = useState<ProblemSpace[]>(seedProblems)
  const [problemId, setProblemId] = useState(seedProblems[0].id)
  const [view, setView] = useState<ViewMode>('state')
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [modalValue, setModalValue] = useState('')

  const problem = problems.find((p)=>p.id===problemId)!
  const selectedNode = problem.nodes.find((n)=>n.id===selectedId)

  const openExport = (privateDraft='') => {
    setModalValue(JSON.stringify(createContextPackage(problem, privateDraft),null,2))
    setModalMode('export')
  }

  const openImport = () => {
    setModalValue(JSON.stringify({
      $type:'ai.bridgework.brainstorm.contributionPackage',
      schemaVersion:'0.1',
      problemId:problem.id,
      participantId:participant.id,
      contributions:[],
      privateProcessDisclosed:false,
    },null,2))
    setModalMode('import')
  }

  const addContribution = (content:string, kind=inferKind(content), relationTo:string[]=['p']) => {
    const id = `u-${Date.now()}-${Math.random().toString(16).slice(2,6)}`
    setProblems((current)=>current.map((p)=>{
      if (p.id !== problem.id) return p
      return {
        ...p,
        updated:[{title:'New contribution added',detail:content},...p.updated],
        nodes:[...p.nodes,{
          id, kind, label:content.length>44?`${content.slice(0,44)}…`:content,
          detail:content, status:'new contribution', author:participant.name,
          createdAt:new Date().toISOString().slice(0,10), weight:16,
        }],
        relations:[...p.relations,{source:relationTo[0] ?? 'p',target:id,kind:kind==='contradiction'?'contradicts':'opens'}],
      }
    }))
    setSelectedId(id)
  }

  const handleAdd = () => {
    const content = draft.trim()
    if (!content) return
    addContribution(content)
    setDraft('')
  }

  const handleModalPrimary = async () => {
    if (modalMode === 'export') {
      await navigator.clipboard.writeText(modalValue)
      return
    }
    if (modalMode === 'import') {
      try {
        const parsed = validateContributionPackage(JSON.parse(modalValue), problem.id)
        parsed.contributions.forEach((item)=>addContribution(item.content,item.kind,item.relationTo))
        setModalMode(null)
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Could not import package.')
      }
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">br-<span>ai</span>-nstorm</div>
          <div className="tagline">a living map of collective problem solving</div>
        </div>
        <div className="top-actions">
          <button className="button aperture" onClick={()=>openExport('')}><BrainCircuit size={16}/> Think with my AI ↗</button>
          <button className="button" onClick={openImport}>Import AI result</button>
        </div>
      </header>

      <ProblemTabs problems={problems} activeId={problem.id} onSelect={(id)=>{setProblemId(id);setSelectedId(undefined)}} />

      <main className="workspace">
        <section className="main-panel">
          <div className="problem-header">
            <div>
              <div className="section-kicker">Shared problem</div>
              <h1>{problem.title}</h1>
              <p>{problem.description}</p>
            </div>
            <div className="state-summary">{problem.stateSummary}</div>
          </div>

          <div className="view-switcher" role="tablist">
            <button className={view==='state'?'active':''} onClick={()=>setView('state')}><LayoutList size={15}/> State</button>
            <button className={view==='map'?'active':''} onClick={()=>setView('map')}><GitBranch size={15}/> Map</button>
            <button className={view==='timeline'?'active':''} onClick={()=>setView('timeline')}><History size={15}/> Timeline</button>
          </div>

          <div className="view-body">
            {view==='state' && <StateView problem={problem} onSelectNode={setSelectedId}/>}
            {view==='map' && <MapView problem={problem} onSelectNode={setSelectedId}/>}
            {view==='timeline' && <TimelineView problem={problem}/>}
          </div>
        </section>

        <SideRail
          problem={problem}
          selectedNode={selectedNode}
          draft={draft}
          setDraft={setDraft}
          onAdd={handleAdd}
          onThinkPrivate={()=>openExport(draft)}
        />
      </main>

      <footer className="footer-note">
        <Sparkles size={14}/> Canonical state first. Map and timeline are synchronized views over the same problem memory.
      </footer>

      {modalMode && (
        <ApertureModal
          title={modalMode==='export'?'Think with your AI':'Import AI contribution'}
          help={modalMode==='export'
            ? 'Copy this state package into any LLM. Think privately there. When ready, ask it to return only the contributionPackage JSON.'
            : 'Paste the contributionPackage returned by your external LLM. The prototype validates the minimal schema and adds bounded contributions to shared state.'}
          value={modalValue}
          setValue={setModalValue}
          primaryLabel={modalMode==='export'?'Copy JSON':'Validate & import'}
          onPrimary={handleModalPrimary}
          onClose={()=>setModalMode(null)}
        />
      )}
    </div>
  )
}
