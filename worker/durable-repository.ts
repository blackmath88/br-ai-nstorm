import type { MemoryEvent } from '../server/domain/events.js'
import { staleWrite, type EventRepository } from '../server/persistence/repository.js'

interface EventLogStub {
  append(events: MemoryEvent[], ifVersion?: number): Promise<void | { stale: true; expected: number; actual: number }>
  version(): Promise<number>
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
    // The version check runs inside the Durable Object, where requests are
    // serialised, so check-then-append cannot interleave with another write.
    append: async (events, options) => {
      const result = await log().append(events, options?.ifVersion)
      // Errors do not survive RPC as DomainErrors; the object reports them as values.
      if (result?.stale) throw staleWrite(result.expected, result.actual)
    },
    version: () => log().version(),
    appendIfEmpty: (events) => log().appendIfEmpty(events),
    read: (problemId) => log().read(problemId),
  }
}

const LOG_NAME = 'canonical-memory'
