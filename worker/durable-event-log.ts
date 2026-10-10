import { DurableObject } from 'cloudflare:workers'
import type { MemoryEvent } from '../server/domain/events.js'

/**
 * One durable, serialized event log for the public demo deployment.
 *
 * The domain still talks only to EventRepository. This object is merely the
 * Cloudflare storage/coordination adapter: Durable Objects serialize requests
 * and persist state, which replaces the local JSON file used by the Node dev
 * server without changing the ontology above it.
 *
 * Storage layout: one key per event (`e:<12-digit sequence>`) plus a `seq`
 * counter. The first version kept the whole log in a single `events` value,
 * which hits the per-value size limit after a few thousand events — or after
 * one large repository import. That value is migrated on first touch.
 */
const LEGACY_KEY = 'events'
const SEQ_KEY = 'seq'
const EVENT_PREFIX = 'e:'
/** Durable Object `put(entries)` accepts at most 128 keys per call. */
const PUT_BATCH = 128

const keyFor = (seq: number) => `${EVENT_PREFIX}${String(seq).padStart(12, '0')}`

export class EventLog extends DurableObject {
  /** Per instance: once the legacy value is gone, it never comes back. */
  private migrated = false

  private async migrateLegacy(): Promise<void> {
    if (this.migrated) return
    const legacy = await this.ctx.storage.get<MemoryEvent[]>(LEGACY_KEY)
    // Rewrite and delete in one transaction, so eviction between the two can
    // neither lose the log nor leave both copies behind.
    if (legacy) await this.write(legacy, 0, { deleteLegacy: true })
    this.migrated = true
  }

  /** Writes events after `from` and advances the counter, in one transaction. */
  private async write(events: MemoryEvent[], from: number, options: { deleteLegacy?: boolean } = {}): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      for (let i = 0; i < events.length; i += PUT_BATCH) {
        const entries: Record<string, MemoryEvent> = {}
        events.slice(i, i + PUT_BATCH).forEach((event, j) => {
          entries[keyFor(from + i + j + 1)] = event
        })
        await txn.put(entries)
      }
      await txn.put(SEQ_KEY, from + events.length)
      if (options.deleteLegacy) await txn.delete(LEGACY_KEY)
    })
  }

  async append(events: MemoryEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.migrateLegacy()
    const seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0
    await this.write(events, seq)
  }

  async appendIfEmpty(events: MemoryEvent[]): Promise<boolean> {
    await this.migrateLegacy()
    const seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0
    if (seq > 0) return false
    await this.write(events, 0)
    return true
  }

  async read(problemId?: string): Promise<MemoryEvent[]> {
    await this.migrateLegacy()
    // `list` returns keys in ascending order, which is append order.
    const stored = await this.ctx.storage.list<MemoryEvent>({ prefix: EVENT_PREFIX })
    const events = [...stored.values()]
    return problemId ? events.filter((event) => event.problemId === problemId) : events
  }
}
