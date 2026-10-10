/**
 * Test stand-in for `cloudflare:workers`: just enough of `DurableObject` and
 * its storage API to run `worker/durable-event-log.ts` in Node. Keys are kept
 * sorted on `list`, as the real storage does; `transaction` is atomic here
 * because nothing else can interleave.
 */
export class MemoryStorage {
  readonly data = new Map<string, unknown>()
  puts = 0
  gets = 0
  /** Throw on the n-th multi-key put, to prove writes are transactional. */
  failOnPut?: number

  async get<T>(key: string): Promise<T | undefined> {
    this.gets += 1
    return structuredClone(this.data.get(key)) as T | undefined
  }

  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      this.data.set(keyOrEntries, structuredClone(value))
      return
    }
    const keys = Object.keys(keyOrEntries)
    if (keys.length > 128) throw new Error('put() accepts at most 128 keys')
    this.puts += 1
    if (this.failOnPut === this.puts) throw new Error('injected storage failure')
    for (const key of keys) this.data.set(key, structuredClone(keyOrEntries[key]))
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const keys = [...this.data.keys()].filter((k) => !options.prefix || k.startsWith(options.prefix)).sort()
    return new Map(keys.map((k) => [k, structuredClone(this.data.get(k)) as T]))
  }

  /** All-or-nothing, like the real storage: a throw restores the snapshot. */
  async transaction<T>(closure: (txn: MemoryStorage) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.data)
    try {
      return await closure(this)
    } catch (error) {
      this.data.clear()
      for (const [key, value] of snapshot) this.data.set(key, value)
      throw error
    }
  }
}

export abstract class DurableObject<Env = unknown> {
  protected ctx: { storage: MemoryStorage }
  protected env: Env
  constructor(ctx: { storage: MemoryStorage }, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
