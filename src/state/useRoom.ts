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
  type ParticipantProposalInput, type ProblemRecord, type ProblemState, type ProblemUpdates, type Stance,
} from '../lib/api'

/** How often an open room checks whether anyone else changed something. */
const POLL_MS = 5000

const SESSION_KEY = 'br-ai-nstorm.session'

export type Phase = 'connecting' | 'ready' | 'error'

export interface RoomData {
  state: ProblemState
  updates: ProblemUpdates
  conflicts: { open: ConflictRecord[]; all: ConflictRecord[] }
  proposals: CurationProposal[]
  events: MemoryEvent[]
  orchestrationOptions: OrchestrationOption[]
  /** The problem's version token this snapshot was read at. */
  version: number
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
  evaluate: (targetId: string, stance: Stance, note?: string) => Promise<void>
  resolveConflict: (conflictId: string, action: 'resolve' | 'dismiss', note: string) => Promise<boolean>
  supersede: (contributionId: string, supersededBy: string, reason?: string) => Promise<void>
  /** When the last change made by someone else was picked up automatically. */
  liveAt: string | null
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

  const [liveAt, setLiveAt] = useState<string | null>(null)

  const loadProblem = useCallback(
    async (token: string, id: string, options: { quiet?: boolean } = {}) => {
      const seq = ++requestId.current
      if (!options.quiet) setBusy(true)
      try {
        // Version first: if something lands mid-read, the next poll sees a
        // newer version and reads again, rather than the change going unseen.
        const { version } = await api.version(token, id)
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
          version,
        })
        setError(null)
        setPhase('ready')
      } catch (err) {
        if (seq !== requestId.current) return
        setError(message(err))
        setPhase('error')
      } finally {
        if (seq === requestId.current && !options.quiet) setBusy(false)
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

  /** Runs one mutation with the shared busy / notice / error / refresh handling. */
  const mutate = useCallback(
    async (run: (token: string, problemId: string) => Promise<string>): Promise<boolean> => {
      if (!session || !problemId) return false
      setBusy(true)
      try {
        setNotice(await run(session.token, problemId))
        setError(null)
        await loadProblem(session.token, problemId)
        return true
      } catch (err) {
        setError(message(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadProblem, problemId, session],
  )

  const evaluate: Room['evaluate'] = useCallback(
    async (targetId, stance, note) => {
      await mutate(async (token, id) => {
        await api.evaluate(token, id, targetId, stance, note)
        return `Recorded your judgement: ${stance.replace('_', ' ')}. It replaces any earlier one of yours.`
      })
    },
    [mutate],
  )

  const resolveConflict: Room['resolveConflict'] = useCallback(
    (conflictId, action, note) =>
      mutate(async (token, id) => {
        await api.resolveConflict(token, id, conflictId, action, note)
        return action === 'resolve'
          ? 'Conflict resolved. The note stays with it in history.'
          : 'Conflict dismissed. The note stays with it in history.'
      }),
    [mutate],
  )

  const supersede: Room['supersede'] = useCallback(
    async (contributionId, supersededBy, reason) => {
      await mutate(async (token, id) => {
        await api.supersede(token, id, contributionId, supersededBy, reason)
        return 'Superseded. The earlier contribution is kept, visibly retired.'
      })
    },
    [mutate],
  )

  // Liveness: poll the cheap version token while the tab is visible, and
  // re-read only when someone else changed this problem.
  const dataRef = useRef(data)
  dataRef.current = data
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    if (!session || !problemId) return
    let stopped = false
    const tick = async () => {
      if (stopped || busyRef.current || document.visibilityState !== 'visible') return
      const current = dataRef.current
      if (!current || current.state.problem.id !== problemId) return
      try {
        const { version } = await api.version(session.token, problemId)
        if (!stopped && version !== current.version) {
          await loadProblem(session.token, problemId, { quiet: true })
          if (!stopped) setLiveAt(new Date().toISOString())
        }
      } catch {
        /* a missed poll is not an error worth showing; the next one retries */
      }
    }
    const timer = setInterval(() => void tick(), POLL_MS)
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadProblem, problemId, session])

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
    evaluate,
    resolveConflict,
    supersede,
    liveAt,
    token: session?.token ?? null,
    notice,
    dismissNotice: () => setNotice(null),
  }
}
