/**
 * Backend client.
 *
 * Every canonical read and write goes through here. The frontend holds no
 * canonical state of its own any more — that was the whole point of v0.3, and
 * it is why there is no local fallback to seed data: silently-local state is
 * exactly the illusion this milestone exists to remove.
 *
 * Identity travels as `Authorization: Bearer <token>`. The client never sends a
 * participant name as proof of who it is; the server resolves the token.
 */
import type {
  ConflictRecord, ContributionKind, ContributionRecord, CurationProposal, EvaluationRecord, OrchestrationMode,
  OrchestrationSetting, Participant, ProblemRecord, ProblemState, RelationRecord,
} from '../../server/domain/types'
import type { OrchestrationOption, ContributionContext } from '../../server/application/orchestration-service'
import type { AddContributionResult } from '../../server/application/contribution-service'
import type { ParticipantProposalInput } from '../../server/curation/participant'
import type { FieldReport } from '../../server/application/report-service'
import type { MemoryEvent } from '../../server/domain/events'
import type { ActorContext } from '../../server/auth/actor-context'
import type { ProblemUpdates } from '../../server/application/problem-service'

export type {
  ConflictRecord, ContributionKind, ContributionRecord, CurationProposal, EvaluationRecord,
  Participant, ProblemRecord, ProblemState, RelationRecord, MemoryEvent, ActorContext, ProblemUpdates,
  OrchestrationMode, OrchestrationSetting, OrchestrationOption, ContributionContext, AddContributionResult,
  ParticipantProposalInput, FieldReport,
}

export type Stance = 'useful' | 'doubtful' | 'needs_evidence'

/** Same-origin by default; the Vite dev server proxies /api to the backend. */
const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: { token?: string; method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the br-ai-nstorm server. Is `npm run dev:server` running?')
  }

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}

  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(payload.error ?? 'error'),
      String(payload.message ?? response.statusText),
      payload.detail,
    )
  }
  return payload as T
}

export interface Session {
  token: string
  actor: ActorContext
}

export const api = {
  participants: () => request<{ participants: Participant[] }>('/api/participants'),

  startSession: (participantId: string) =>
    request<Session>('/api/auth/session', { method: 'POST', body: { participantId } }),

  health: () => request<{ ok: boolean; aiCurator: boolean; curator: string }>('/health'),

  problems: (token: string) => request<{ problems: ProblemRecord[] }>('/api/problems', { token }),

  state: (token: string, problemId: string) =>
    request<ProblemState & { viewer: ActorContext }>(`/api/problems/${encodeURIComponent(problemId)}`, { token }),

  updates: (token: string, problemId: string, since?: string) =>
    request<ProblemUpdates>(
      `/api/problems/${encodeURIComponent(problemId)}/updates${since ? `?since=${encodeURIComponent(since)}` : ''}`,
      { token },
    ),

  conflicts: (token: string, problemId: string) =>
    request<{ open: ConflictRecord[]; all: ConflictRecord[] }>(
      `/api/problems/${encodeURIComponent(problemId)}/conflicts`,
      { token },
    ),

  curation: (token: string, problemId: string, status?: CurationProposal['status']) =>
    request<{ proposals: CurationProposal[] }>(
      `/api/problems/${encodeURIComponent(problemId)}/curation${status ? `?status=${status}` : ''}`,
      { token },
    ),

  events: (token: string, problemId: string) =>
    request<{ events: MemoryEvent[] }>(`/api/problems/${encodeURIComponent(problemId)}/events`, { token }),

  orchestration: (token: string, problemId: string) =>
    request<{ orchestration: OrchestrationSetting; options: OrchestrationOption[] }>(
      `/api/problems/${encodeURIComponent(problemId)}/orchestration`,
      { token },
    ),

  setOrchestration: (token: string, problemId: string, mode: OrchestrationMode, reason?: string) =>
    request<{ orchestration: OrchestrationSetting; options: OrchestrationOption[] }>(
      `/api/problems/${encodeURIComponent(problemId)}/orchestration`,
      { token, method: 'POST', body: { mode, ...(reason ? { reason } : {}) } },
    ),

  context: (token: string, problemId: string, draft = '') =>
    request<ContributionContext>(
      `/api/problems/${encodeURIComponent(problemId)}/context${draft ? `?draft=${encodeURIComponent(draft.slice(0, 1500))}` : ''}`,
      { token },
    ),

  addContribution: (
    token: string,
    problemId: string,
    body: {
      content: string
      kind?: ContributionKind
      source?: string
      sourceDetail?: string
      preparedBy?: string
      proposals?: ParticipantProposalInput[]
    },
  ) =>
    request<AddContributionResult>(
      `/api/problems/${encodeURIComponent(problemId)}/contributions`,
      { token, method: 'POST', body },
    ),

  version: (token: string, problemId: string) =>
    request<{ problemId: string; version: number; lastEventAt: string | null }>(
      `/api/problems/${encodeURIComponent(problemId)}/version`,
      { token },
    ),

  report: (token: string, problemId: string) =>
    request<FieldReport>(`/api/problems/${encodeURIComponent(problemId)}/report`, { token }),

  evaluate: (token: string, problemId: string, targetId: string, stance: Stance, note?: string) =>
    request<{ evaluation: unknown }>(`/api/problems/${encodeURIComponent(problemId)}/evaluations`, {
      token,
      method: 'POST',
      body: { targetId, stance, ...(note ? { note } : {}) },
    }),

  resolveConflict: (token: string, problemId: string, conflictId: string, action: 'resolve' | 'dismiss', note: string) =>
    request<{ conflict: ConflictRecord }>(
      `/api/problems/${encodeURIComponent(problemId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
      { token, method: 'POST', body: { action, note } },
    ),

  supersede: (token: string, problemId: string, contributionId: string, supersededBy: string, reason?: string) =>
    request<{ contribution: ContributionRecord }>(
      `/api/problems/${encodeURIComponent(problemId)}/contributions/${encodeURIComponent(contributionId)}/supersede`,
      { token, method: 'POST', body: { supersededBy, ...(reason ? { reason } : {}) } },
    ),

  review: (token: string, problemId: string, proposalId: string, accept: boolean, reason?: string) =>
    request<{ proposal: CurationProposal; relation?: unknown; conflict?: ConflictRecord }>(
      `/api/curation/${encodeURIComponent(proposalId)}/${accept ? 'accept' : 'reject'}`,
      { token, method: 'POST', body: { problemId, ...(reason ? { reason } : {}) } },
    ),
}
