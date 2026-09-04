/**
 * The persistence port.
 *
 * Two methods, because an append-only log needs no more. The store never sees a
 * contribution, a relation or a conflict — only events — so storage technology
 * cannot define the ontology. A `postgres-repository.ts` implements these two
 * methods and nothing above it changes.
 */
import type { MemoryEvent } from '../domain/events.js'

export interface EventRepository {
  /** Appends events atomically, in order. Concurrent callers must not interleave. */
  append(events: MemoryEvent[]): Promise<void>
  /** Reads the log, optionally filtered to one problem, in append order. */
  read(problemId?: string): Promise<MemoryEvent[]>
}
