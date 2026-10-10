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
 * Storage layout: one key per event (`e:<12-digit sequence>`), a `seq`
 * counter for the whole log, and a `p:<problemId>` counter per problem so a
 * version check (and the clients' polling) is one lookup, not a log scan. The first version kept the whole log in a single `events` value,
 * which hits the per-value size limit after a few thousand events — or after
 * one large repository import. That value is migrated on first touch.
 */
const LEGACY_KEY = 'events'
const SEQ_KEY = 'seq'
const EVENT_PREFIX = 'e:'
const PROBLEM_PREFIX = 'p:'
/** Set once per-problem counters are known to be complete. */
const COUNTERS_READY_KEY = 'counters-ready'
/** Durable Object `put(entries)` accepts at most 128 keys per call. */
const PUT_BATCH = 128

const keyFor = (seq: number) => `${EVENT_PREFIX}${String(seq).padStart(12, '0')}`
const problemKey = (problemId: string) => `${PROBLEM_PREFIX}${problemId}`

type StaleResult = { stale: true; expected: number; actual: number }

export class EventLog extends DurableObject {
  /** Per instance: once storage is in the current layout, it stays there. */
  private prepared = false

  /**
   * Brings older layouts forward, once: the v0.3 single `events` value, and
   * per-event logs written before per-problem counters existed.
   */
  private async prepare(): Promise<void> {
    if (this.prepared) return
    const legacy = await this.ctx.storage.get<MemoryEvent[]>(LEGACY_KEY)
    if (legacy) {
      // Rewrite and delete in one transaction, so eviction between the two
      // can neither lose the log nor leave both copies behind.
      await this.write(legacy, 0, { deleteLegacy: true })
    } else if (!(await this.ctx.storage.get<boolean>(COUNTERS_READY_KEY))) {
      const stored = await this.ctx.storage.list<MemoryEvent>({ prefix: EVENT_PREFIX })
      const counts: Record<string, number> = {}
      for (const event of stored.values()) {
        counts[problemKey(event.problemId)] = (counts[problemKey(event.problemId)] ?? 0) + 1
      }
      await this.ctx.storage.transaction(async (txn) => {
        const keys = Object.keys(counts)
        for (let i = 0; i < keys.length; i += PUT_BATCH) {
          await txn.put(Object.fromEntries(keys.slice(i, i + PUT_BATCH).map((k) => [k, counts[k]])))
        }
        await txn.put(COUNTERS_READY_KEY, true)
      })
    }
    this.prepared = true
  }

  /** Writes events after `from` and advances every counter, in one transaction. */
  private async write(events: MemoryEvent[], from: number, options: { deleteLegacy?: boolean } = {}): Promise<void> {
    const added: Record<string, number> = {}
    for (const event of events) added[problemKey(event.problemId)] = (added[problemKey(event.problemId)] ?? 0) + 1

    await this.ctx.storage.transaction(async (txn) => {
      for (let i = 0; i < events.length; i += PUT_BATCH) {
        const entries: Record<string, MemoryEvent> = {}
        events.slice(i, i + PUT_BATCH).forEach((event, j) => {
          entries[keyFor(from + i + j + 1)] = event
        })
        await txn.put(entries)
      }
      for (const [key, n] of Object.entries(added)) {
        await txn.put(key, ((await txn.get<number>(key)) ?? 0) + n)
      }
      await txn.put(SEQ_KEY, from + events.length)
      await txn.put(COUNTERS_READY_KEY, true)
      if (options.deleteLegacy) await txn.delete(LEGACY_KEY)
    })
  }

  private async count(scope?: string): Promise<number> {
    return (await this.ctx.storage.get<number>(scope === undefined ? SEQ_KEY : problemKey(scope))) ?? 0
  }

  /**
   * Appends, optionally only if the log — or one problem's part of it, with
   * `scope` — still has `ifVersion` events. The check runs here, where
   * requests are serialised, so it cannot interleave with another write. A
   * stale write is reported as a value rather than thrown: errors cross the
   * RPC boundary as plain `Error`s and would lose the domain detail.
   */
  async append(events: MemoryEvent[], ifVersion?: number, scope?: string): Promise<void | StaleResult> {
    await this.prepare()
    if (ifVersion !== undefined) {
      const actual = await this.count(scope)
      if (ifVersion !== actual) return { stale: true, expected: ifVersion, actual }
    }
    if (events.length === 0) return
    await this.write(events, await this.count())
  }

  async version(problemId?: string): Promise<number> {
    await this.prepare()
    return this.count(problemId)
  }

  async appendIfEmpty(events: MemoryEvent[]): Promise<boolean> {
    await this.prepare()
    if ((await this.count()) > 0) return false
    await this.write(events, 0)
    return true
  }

  async read(problemId?: string): Promise<MemoryEvent[]> {
    await this.prepare()
    // `list` returns keys in ascending order, which is append order.
    const stored = await this.ctx.storage.list<MemoryEvent>({ prefix: EVENT_PREFIX })
    const events = [...stored.values()]
    return problemId ? events.filter((event) => event.problemId === problemId) : events
  }
}
