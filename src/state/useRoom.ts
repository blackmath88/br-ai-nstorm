/**
 * The room's connection to the backend.
 *
 * One hook owns session, canonical state, updates and the curation queue, so
 * every mutation has exactly one place to refresh from. Nothing here caches
 * canonical data across a mutation: after a write the server is asked again,
 * because the server is the only thing that knows what curation did.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api, ApiError,
  type ActorContext, type ConflictRecord, type ContributionKind, type CurationProposal,
  type MemoryEvent, type OrchestrationMode, type OrchestrationOption, type Participant,
  type ParticipantProposalInput, type ProblemRecord, type ProblemState, type ProblemUpdates,
} from '../lib/api'

const SESSION_KEY = 'br-ai-nstorm.session'

export type Phase = 'connecting' | 'ready' | 'error'

export interface RoomData {
  state: ProblemState
  updates: ProblemUpdates
  conflicts: { open: ConflictRecord[]; all: ConflictRecord[] }
  proposals: CurationProposal[]
  events: MemoryEvent[]
  orchestrationOptions: OrchestrationOption[]
}

export interface Room {
  phase: Phase
  error: string | null
  /** True while a refresh is in flight over already-rendered data. */
  busy: boolean

  participants: Participant[]
  actor: ActorContext | null
  signIn: (participantId: string) => Promise<void>

  problems: ProblemRecord[]
  problemId: string | null
  selectProblem: (id: string) => void

  data: RoomData | null
  refresh: () => Promise<void>

  addContribution: (input: {
    content: string
    kind?: ContributionKind
    preparedBy?: string
    sourceDetail?: string
    source?: string
    proposals?: ParticipantProposalInput[]
  }) => Promise<void>
  review: (proposalId: string, accept: boolean, reason?: string) => Promise<void>
  setOrchestration: (mode: OrchestrationMode, reason?: string) => Promise<void>
  /** The session token, for reads that are not part of the room snapshot (e.g. contribution context). */
  token: string | null

  /** Last mutation's outcome, for a short confirmation line in the UI. */
  notice: string | null
  dismissNotice: () => void
}

interface StoredSession {
  token: string
  actor: ActorContext
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function saveSession(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* private-mode browsers: the session simply does not persist */
  }
}

const message = (error: unknown): string =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unexpected error.'

export function useRoom(): Room {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [participants, setParticipants] = useState<Participant[]>([])
  const [session, setSession] = useState<StoredSession | null>(null)
  const [problems, setProblems] = useState<ProblemRecord[]>([])
  const [problemId, setProblemId] = useState<string | null>(null)
  const [data, setData] = useState<RoomData | null>(null)

  /** Tracks the newest request so a slow response cannot overwrite a newer one. */
  const requestId = useRef(0)

  const loadProblem = useCallback(
    async (token: string, id: string) => {
      const seq = ++requestId.current
      setBusy(true)
      try {
        const [state, updates, conflicts, curation, events, orchestration] = await Promise.all([
          api.state(token, id),
          api.updates(token, id),
          api.conflicts(token, id),
          api.curation(token, id),
          api.events(token, id),
          api.orchestration(token, id),
        ])
        if (seq !== requestId.current) return
        setData({
          state,
          updates,
          conflicts,
          proposals: curation.proposals,
          events: events.events,
          orchestrationOptions: orchestration.options,
        })
        setError(null)
        setPhase('ready')
      } catch (err) {
        if (seq !== requestId.current) return
        setError(message(err))
        setPhase('error')
      } finally {
        if (seq === requestId.current) setBusy(false)
      }
    },
    [],
  )

  // Bootstrap: roster, restored session, problem list.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { participants: roster } = await api.participants()
        if (cancelled) return
        setParticipants(roster)

        const stored = loadSession()
        if (!stored) {
          setPhase('ready')
          return
        }
        // A stored token may have been minted by a previous server process.
        const { problems: list } = await api.problems(stored.token)
        if (cancelled) return
        setSession(stored)
        setProblems(list)
        const first = list[0]?.id ?? null
        setProblemId(first)
        if (first) await loadProblem(stored.token, first)
        else setPhase('ready')
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          saveSession(null)
          setSession(null)
          setPhase('ready')
          return
        }
        setError(message(err))
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadProblem])

  const signIn = useCallback(
    async (participantId: string) => {
      setBusy(true)
      setError(null)
      try {
        const next = await api.startSession(participantId)
        saveSession(next)
        setSession(next)
        const { problems: list } = await api.problems(next.token)
        setProblems(list)
        const id = problemId && list.some((p) => p.id === problemId) ? problemId : (list[0]?.id ?? null)
        setProblemId(id)
        if (id) await loadProblem(next.token, id)
        else setPhase('ready')
        setNotice(`Signed in as ${next.actor.displayName}.`)
      } catch (err) {
        setError(message(err))
        setPhase('error')
      } finally {
        setBusy(false)
      }
    },
    [loadProblem, problemId],
  )

  const selectProblem = useCallback(
    (id: string) => {
      setProblemId(id)
      setData(null)
      if (session) void loadProblem(session.token, id)
    },
    [loadProblem, session],
  )

  const refresh = useCallback(async () => {
    if (session && problemId) await loadProblem(session.token, problemId)
  }, [loadProblem, problemId, session])

  const addContribution: Room['addContribution'] = useCallback(
    async (input) => {
      if (!session || !problemId) return
      setBusy(true)
      try {
        const result = await api.addContribution(session.token, problemId, input as never)
        const n = result.proposals.length
        const dropped = result.dropped.length
        setNotice(
          (n === 0
            ? 'Contribution recorded. No curation proposals.'
            : `Contribution recorded. ${n} proposal${n === 1 ? '' : 's'} added to the review queue.`) +
            (dropped > 0 ? ` ${dropped} AI proposal${dropped === 1 ? ' was' : 's were'} not accepted: ${result.dropped[0].reason}` : ''),
        )
        setError(null)
        await loadProblem(session.token, problemId)
      } catch (err) {
        setError(message(err))
      } finally {
        setBusy(false)
      }
    },
    [loadProblem, problemId, session],
  )

  const review: Room['review'] = useCallback(
    async (proposalId, accept, reason) => {
      if (!session || !problemId) return
      setBusy(true)
      try {
        const result = await api.review(session.token, problemId, proposalId, accept, reason)
        setNotice(
          accept
            ? result.conflict
              ? 'Conflict accepted. It is now canonical and unresolved.'
              : 'Relation accepted.'
            : 'Proposal rejected. The decision is recorded in history.',
        )
        setError(null)
        await loadProblem(session.token, problemId)
      } catch (err) {
        setError(message(err))
      } finally {
        setBusy(false)
      }
    },
    [loadProblem, problemId, session],
  )

  const setOrchestration: Room['setOrchestration'] = useCallback(
    async (mode, reason) => {
      if (!session || !problemId) return
      setBusy(true)
      try {
        await api.setOrchestration(session.token, problemId, mode, reason)
        setNotice(`Orchestration switched to “${mode}”. The change is recorded in history.`)
        setError(null)
        await loadProblem(session.token, problemId)
      } catch (err) {
        setError(message(err))
      } finally {
        setBusy(false)
      }
    },
    [loadProblem, problemId, session],
  )

  return {
    phase,
    error,
    busy,
    participants,
    actor: session?.actor ?? null,
    signIn,
    problems,
    problemId,
    selectProblem,
    data,
    refresh,
    addContribution,
    review,
    setOrchestration,
    token: session?.token ?? null,
    notice,
    dismissNotice: () => setNotice(null),
  }
}
