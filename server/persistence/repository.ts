/**
 * The persistence port.
 *
 * Two methods, because an append-only log needs no more. The store never sees a
 * contribution, a relation or a conflict — only events — so storage technology
 * cannot define the ontology. A `postgres-repository.ts` implements these two
 * methods and nothing above it changes.
 */
import type { MemoryEvent } from '../domain/events.js'
import { conflictError } from '../domain/errors.js'

export interface AppendOptions {
  /**
   * Optimistic concurrency: append only if the log (or, with `scope`, one
   * problem's part of it) still holds exactly this many events — i.e. nothing
   * relevant was written since the caller read it. Otherwise reject with a
   * stale-write conflict and write nothing.
   */
  ifVersion?: number
  /**
   * The problem `ifVersion` refers to. Scoped checks keep a busy room's
   * unrelated activity from invalidating a decision about one problem.
   */
  scope?: string
}

export interface EventRepository {
  /** Appends events atomically, in order. Concurrent callers must not interleave. */
  append(events: MemoryEvent[], options?: AppendOptions): Promise<void>
  /** Reads the log, optionally filtered to one problem, in append order. */
  read(problemId?: string): Promise<MemoryEvent[]>
  /**
   * Event count for the whole log, or for one problem. Monotonic; the token
   * `ifVersion` compares against. Must be cheap: clients poll it.
   */
  version(problemId?: string): Promise<number>
}

/** Event count of `events` for a scope (a problem) or for the whole log. */
export const countIn = (events: readonly MemoryEvent[], scope?: string): number =>
  scope === undefined ? events.length : events.reduce((n, e) => (e.problemId === scope ? n + 1 : n), 0)

export const STALE_WRITE = 'stale_write'

/** Someone else wrote first. Callers re-read and decide again (see `withFreshState`). */
export const staleWrite = (expected: number, actual: number) =>
  conflictError('The shared log changed while this was being decided. Try again.', {
    reason: STALE_WRITE,
    expected,
    actual,
  })

export const isStaleWrite = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { detail?: { reason?: unknown } }).detail?.reason === STALE_WRITE
