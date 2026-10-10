import type { MemoryEvent } from '../server/domain/events.js'
import type { EventRepository } from '../server/persistence/repository.js'

interface EventLogStub {
  append(events: MemoryEvent[]): Promise<void>
  appendIfEmpty(events: MemoryEvent[]): Promise<boolean>
  read(problemId?: string): Promise<MemoryEvent[]>
}

interface EventLogNamespace {
  getByName(name: string): EventLogStub
}

export interface DurableEventRepository extends EventRepository {
  appendIfEmpty(events: MemoryEvent[]): Promise<boolean>
}

/**
 * EventRepository adapter backed by one named Durable Object.
 *
 * Keeping one named log preserves the current single-room/shared-memory model
 * and gives Cloudflare the same serialized append boundary the JSON adapter
 * provides locally.
 */
export function createDurableEventRepository(namespace: EventLogNamespace): DurableEventRepository {
  // The stub is resolved per operation, never cached. Services are built once
  // per isolate, and workerd refuses to let an I/O object created while
  // serving one request be used by another ("Cannot perform I/O on behalf of
  // a different request"). Getting a stub is cheap; reusing one breaks every
  // request after the first.
  const log = () => namespace.getByName(LOG_NAME)

  return {
    append: (events) => log().append(events),
    appendIfEmpty: (events) => log().appendIfEmpty(events),
    read: (problemId) => log().read(problemId),
  }
}

const LOG_NAME = 'canonical-memory'
