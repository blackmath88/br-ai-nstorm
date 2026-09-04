/**
 * Local JSON event log.
 *
 * Deliberately disposable: its job is to prove the event/provenance/curation
 * model before infrastructure is introduced. See ADR-003 §4 for the recorded
 * triggers that would move this to Postgres.
 *
 * One thing here is *not* disposable. v0.2 read the whole document, mutated it
 * and wrote it back with no serialisation, so two concurrent contributions
 * raced and one was silently lost — a multi-user correctness bug, in the exact
 * area this milestone is trying to prove. Writes are serialised through a
 * promise chain, and the file is replaced atomically via a temp file + rename
 * so a crash mid-write cannot leave a truncated log.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { MemoryEvent } from '../domain/events.js'
import type { EventRepository } from './repository.js'

export interface JsonRepositoryOptions {
  file: string
}

interface LogDocument {
  version: 1
  events: MemoryEvent[]
}

export function createJsonRepository(options: JsonRepositoryOptions): EventRepository {
  const file = resolve(options.file)
  let cache: MemoryEvent[] | undefined
  /**
   * The file identity the cache was built from. Two processes share this log in
   * normal use — `npm run dev:server` and `npm run mcp` — so a cache that only
   * checked "have I loaded once?" would make each process blind to the other's
   * writes, and an append would clobber them. That is proof point 8 (a
   * contribution from MCP becoming visible in React) failing in real use while
   * the in-process tests still passed.
   */
  let stamp: string | undefined
  /** Serialises every read-or-write so file access never interleaves. */
  let queue: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Identity of the file as it is on disk right now, or undefined if absent. */
  const currentStamp = async (): Promise<string | undefined> => {
    try {
      const info = await stat(file)
      return `${info.mtimeMs}:${info.size}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return undefined
    }
  }

  const loadUnsafe = async (): Promise<MemoryEvent[]> => {
    const disk = await currentStamp()
    // Reuse the cache only while the file on disk is the one we cached.
    if (cache && stamp === disk) return cache
    if (disk === undefined) {
      cache = []
      stamp = undefined
      return cache
    }
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as LogDocument | MemoryEvent[]
    cache = Array.isArray(parsed) ? parsed : (parsed.events ?? [])
    stamp = disk
    return cache
  }

  const saveUnsafe = async (events: MemoryEvent[]): Promise<void> => {
    await mkdir(dirname(file), { recursive: true })
    const document: LogDocument = { version: 1, events }
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(document, null, 2))
    await rename(temp, file)
    stamp = await currentStamp()
  }

  return {
    append: (events) =>
      enqueue(async () => {
        if (events.length === 0) return
        // Re-reads through loadUnsafe, which re-checks the file, so appends
        // land on top of another process's writes instead of erasing them.
        const current = await loadUnsafe()
        const next = [...current, ...events]
        cache = next
        await saveUnsafe(next)
      }),

    read: (problemId) =>
      enqueue(async () => {
        const events = await loadUnsafe()
        return problemId ? events.filter((event) => event.problemId === problemId) : [...events]
      }),
  }
}

/** In-memory log for tests and for the in-process integration harness. */
export function createMemoryRepository(seed: MemoryEvent[] = []): EventRepository {
  let events = [...seed]
  return {
    async append(next) {
      events = [...events, ...next]
    },
    async read(problemId) {
      return problemId ? events.filter((event) => event.problemId === problemId) : [...events]
    },
  }
}
