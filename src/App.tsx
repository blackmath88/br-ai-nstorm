/**
 * br-ai-nstorm — v0.3 "Real Shared Room".
 *
 * The frontend holds no canonical state. Everything on screen is read from the
 * backend, and every contribution and review is written through it, so what a
 * participant sees is what the shared room actually contains.
 *
 * State stays canonical. Map and Timeline are projections over the same data.
 */
import { useMemo, useState } from 'react'
import { BrainCircuit, GitBranch, History, LayoutList, ListChecks, RefreshCw, Sparkles } from 'lucide-react'
import { useRoom } from './state/useRoom'
import { ProblemTabs } from './components/ProblemTabs'
import { StateView } from './components/StateView'
import { MapView } from './components/MapView'
import { TimelineView } from './components/TimelineView'
import { CurationPanel } from './components/CurationPanel'
import { SideRail } from './components/SideRail'
import { ApertureModal } from './components/ApertureModal'
import { ParticipantSwitcher } from './components/ParticipantSwitcher'
import { createContextPackage, validateContributionPackage } from './lib/aperture'

type ViewMode = 'state' | 'map' | 'timeline' | 'curation'
type ModalMode = 'export' | 'import' | null

export default function App() {
  const room = useRoom()
  const [view, setView] = useState<ViewMode>('state')
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [modalValue, setModalValue] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const data = room.data
  const problem = data?.state.problem
  const selected = useMemo(
    () => data?.state.contributions.find((c) => c.id === selectedId),
    [data, selectedId],
  )
  const pendingCount = data?.proposals.filter((p) => p.status === 'pending').length ?? 0
  const openConflicts = data?.conflicts.open.length ?? 0

  /**
   * The seed data carries an editorial summary string ("3 approaches · 2
   * tensions"). Now that state is real it can drift from what is on screen, so
   * the header counts the projection instead of quoting the seed.
   */
  const stateSummary = useMemo(() => {
    if (!data) return ''
    const active = data.state.contributions.filter((c) => c.status === 'active')
    const count = (kind: string) => active.filter((c) => c.kind === kind).length
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    const parts = [
      plural(count('approach'), 'approach', 'approaches'),
      plural(count('question'), 'open question', 'open questions'),
      plural(data.conflicts.open.length, 'unresolved conflict', 'unresolved conflicts'),
    ]
    if (pendingCount > 0) parts.push(`${pendingCount} awaiting review`)
    return parts.join(' · ')
  }, [data, pendingCount])

  const openExport = (privateDraft = '') => {
    if (!data || !room.actor) return
    setModalValue(JSON.stringify(createContextPackage(data.state, room.actor, privateDraft), null, 2))
    setImportError(null)
    setModalMode('export')
  }

  const openImport = () => {
    if (!problem || !room.actor) return
    setModalValue(
      JSON.stringify(
        {
          $type: 'ai.bridgework.brainstorm.contributionPackage',
          schemaVersion: '0.2',
          problemId: problem.id,
          participantId: room.actor.actorId,
          contributions: [],
          privateProcessDisclosed: false,
        },
        null,
        2,
      ),
    )
    setImportError(null)
    setModalMode('import')
  }

  const handleModalPrimary = async () => {
    if (!problem) return
    if (modalMode === 'export') {
      try {
        await navigator.clipboard.writeText(modalValue)
        setImportError('Copied to clipboard.')
      } catch {
        setImportError('Clipboard unavailable — select the text and copy manually.')
      }
      return
    }
    try {
      const parsed = validateContributionPackage(JSON.parse(modalValue), problem.id)
      // Written through the backend like any other contribution, and attributed
      // to the session's participant — not to the participantId in the package.
      for (const item of parsed.contributions) {
        await room.addContribution({
          content: item.content,
          kind: item.kind,
          source: 'external_llm',
          preparedBy: 'ai:external-llm',
          sourceDetail: item.relationTo?.length ? `relates to ${item.relationTo.join(', ')}` : undefined,
        })
      }
      setModalMode(null)
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import package.')
    }
  }

  const handleAdd = async () => {
    const content = draft.trim()
    if (!content) return
    await room.addContribution({ content, source: 'direct' })
    setDraft('')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            br-<span>ai</span>-nstorm
          </div>
          <div className="tagline">a living map of collective problem solving</div>
        </div>
        <div className="top-actions">
          <button className="button" onClick={() => void room.refresh()} disabled={room.busy || !data}>
            <RefreshCw size={15} /> {room.busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="button aperture" onClick={() => openExport('')} disabled={!data}>
            <BrainCircuit size={16} /> Think with my AI ↗
          </button>
          <button className="button" onClick={openImport} disabled={!data}>
            Import AI result
          </button>
        </div>
      </header>

      <ParticipantSwitcher
        participants={room.participants}
        actor={room.actor}
        onSelect={(id) => void room.signIn(id)}
        busy={room.busy}
      />

      {room.error && (
        <div className="banner error" role="alert">
          {room.error}
        </div>
      )}
      {room.notice && !room.error && (
        <div className="banner notice" role="status" onClick={room.dismissNotice}>
          {room.notice}
        </div>
      )}

      {room.phase === 'connecting' && <div className="empty-state">Connecting to the shared room…</div>}

      {room.phase !== 'connecting' && !room.actor && (
        <div className="empty-state">
          <h2>Choose a participant to enter the room.</h2>
          <p>
            The server issues a session token and attributes everything you contribute to it. This prototype
            sign-in is the only fake part of the identity model.
          </p>
        </div>
      )}

      {room.actor && room.problems.length > 0 && (
        <ProblemTabs
          problems={room.problems}
          activeId={room.problemId ?? room.problems[0].id}
          onSelect={(id) => {
            room.selectProblem(id)
            setSelectedId(undefined)
          }}
        />
      )}

      {room.actor && !data && room.phase !== 'error' && <div className="empty-state">Loading problem…</div>}

      {data && problem && (
        <main className="workspace">
          <section className="main-panel">
            <div className="problem-header">
              <div>
                <div className="section-kicker">Shared problem</div>
                <h1>{problem.title}</h1>
                <p>{problem.description}</p>
              </div>
              <div className="state-summary">{stateSummary}</div>
            </div>

            <div className="view-switcher" role="tablist">
              <button className={view === 'state' ? 'active' : ''} onClick={() => setView('state')}>
                <LayoutList size={15} /> State
                {openConflicts > 0 && <span className="badge conflict">{openConflicts}</span>}
              </button>
              <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
                <GitBranch size={15} /> Map
              </button>
              <button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')}>
                <History size={15} /> Timeline
              </button>
              <button className={view === 'curation' ? 'active' : ''} onClick={() => setView('curation')}>
                <ListChecks size={15} /> Curation
                {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
              </button>
            </div>

            <div className="view-body">
              {view === 'state' && (
                <StateView
                  contributions={data.state.contributions}
                  conflicts={data.conflicts.all}
                  onSelect={setSelectedId}
                  selectedId={selectedId}
                />
              )}
              {view === 'map' && (
                <MapView
                  contributions={data.state.contributions}
                  relations={data.state.relations}
                  conflicts={data.conflicts.all}
                  onSelect={setSelectedId}
                />
              )}
              {view === 'timeline' && (
                <TimelineView events={data.events} contributions={data.state.contributions} />
              )}
              {view === 'curation' && (
                <CurationPanel
                  proposals={data.proposals}
                  contributions={data.state.contributions}
                  onReview={(proposalId, accept) => void room.review(proposalId, accept)}
                  busy={room.busy}
                />
              )}
            </div>
          </section>

          <SideRail
            updates={data.updates}
            selected={selected}
            draft={draft}
            setDraft={setDraft}
            onAdd={() => void handleAdd()}
            onThinkPrivate={() => openExport(draft)}
            busy={room.busy}
            canContribute={Boolean(room.actor)}
          />
        </main>
      )}

      <footer className="footer-note">
        <Sparkles size={14} /> Canonical state lives on the server. Map and Timeline are projections over the same
        event history. AI may propose; only a participant makes something canonical.
      </footer>

      {modalMode && (
        <ApertureModal
          title={modalMode === 'export' ? 'Think with your AI' : 'Import AI contribution'}
          help={
            modalMode === 'export'
              ? 'Copy this canonical state package into any LLM. Think privately there. When ready, ask it to return only the contributionPackage JSON.'
              : 'Paste the contributionPackage returned by your external LLM. Contributions are written through the backend, attributed to your session, and marked as AI-prepared and unreviewed.'
          }
          value={modalValue}
          setValue={setModalValue}
          primaryLabel={modalMode === 'export' ? 'Copy JSON' : 'Validate & contribute'}
          onPrimary={() => void handleModalPrimary()}
          onClose={() => {
            setModalMode(null)
            setImportError(null)
          }}
          status={importError}
        />
      )}
    </div>
  )
}
