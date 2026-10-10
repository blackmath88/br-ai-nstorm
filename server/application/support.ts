/**
 * Shared internals for the application services.
 *
 * Nothing here imports a transport, an environment variable or a framework —
 * services take plain values and return plain values, which is what lets one
 * service instance be driven by React, HTTP, MCP and tests at the same time.
 */
import type { Clock, IdSource, MemoryEvent } from '../domain/events.js'
import { project } from '../domain/projections.js'
import type { OrchestrationMode, ProblemRecord, ProblemState } from '../domain/types.js'
import type { EventRepository } from '../persistence/repository.js'
import type { Curator } from '../curation/ai-curator.js'
import { notFound } from '../domain/errors.js'

export interface ServiceDeps {
  repository: EventRepository
  clock: Clock
  ids: IdSource
  curator: Curator
  /**
   * Mode for problems nobody has switched yet. Unset means the domain default
   * (`participant`). A deployment that relied on the server curator before
   * orchestration modes existed sets `api` here to keep that behaviour.
   */
  defaultOrchestration?: OrchestrationMode
}

/**
 * Applies the deployment's default to a problem that has never been switched.
 * An explicit `OrchestrationModeChanged` always wins.
 */
export function withDefaultOrchestration(deps: Pick<ServiceDeps, 'defaultOrchestration'>, problem: ProblemRecord): ProblemRecord {
  if (!deps.defaultOrchestration || problem.orchestration.changedBy) return problem
  return { ...problem, orchestration: { mode: deps.defaultOrchestration } }
}

/** Loads one problem's canonical state, or fails with a domain `not_found`. */
export async function loadState(deps: ServiceDeps, problemId: string): Promise<ProblemState> {
  const events = await deps.repository.read(problemId)
  const state = project(events)
  if (!state) throw notFound('Problem', problemId)
  return { ...state, problem: withDefaultOrchestration(deps, state.problem) }
}

export async function loadStateAndEvents(
  deps: ServiceDeps,
  problemId: string,
): Promise<{ state: ProblemState; events: MemoryEvent[] }> {
  const events = await deps.repository.read(problemId)
  const state = project(events)
  if (!state) throw notFound('Problem', problemId)
  return { state: { ...state, problem: withDefaultOrchestration(deps, state.problem) }, events }
}

export const byTimeThenId = (a: MemoryEvent, b: MemoryEvent): number =>
  a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp.localeCompare(b.timestamp)

export type { Clock, IdSource, Curator, EventRepository }
