import { DurableObject } from 'cloudflare:workers'
import type { MemoryEvent } from '../server/domain/events.js'

/**
 * One durable, serialized event log for the public demo deployment.
 *
 * The domain still talks only to EventRepository. This object is merely the
 * Cloudflare storage/coordination adapter: Durable Objects serialize requests
 * and persist state, which replaces the local JSON file used by the Node dev
 * server without changing the ontology above it.
 */
export class EventLog extends DurableObject {
  async append(events: MemoryEvent[]): Promise<void> {
    if (events.length === 0) return
    const current = (await this.ctx.storage.get<MemoryEvent[]>('events')) ?? []
    await this.ctx.storage.put('events', [...current, ...events])
  }

  async appendIfEmpty(events: MemoryEvent[]): Promise<boolean> {
    const current = (await this.ctx.storage.get<MemoryEvent[]>('events')) ?? []
    if (current.length > 0) return false
    await this.ctx.storage.put('events', events)
    return true
  }

  async read(problemId?: string): Promise<MemoryEvent[]> {
    const events = (await this.ctx.storage.get<MemoryEvent[]>('events')) ?? []
    return problemId ? events.filter((event) => event.problemId === problemId) : events
  }
}
