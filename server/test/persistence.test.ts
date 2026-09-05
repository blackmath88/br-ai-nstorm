/**
 * Persistence tests.
 *
 * The concurrency test is the reason this file exists. v0.2's store read the
 * whole document, mutated it and wrote it back with no serialisation, so two
 * concurrent contributions raced and one was silently lost — a multi-user
 * correctness bug in exactly the area this milestone is trying to prove.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJsonRepository } from '../persistence/json-repository.js'
import { buildServices } from '../container.js'
import { createIdSource, type MemoryEvent } from '../domain/events.js'
import { createPrototypeAuth } from '../auth/prototype-auth.js'
import { nullCurator } from '../curation/ai-curator.js'
import { fixedClock } from './harness.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'brainstorm-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const event = (id: string): MemoryEvent => ({
  id,
  problemId: 'p1',
  actorId: 'person:kai',
  timestamp: '2026-09-01T09:00:00.000Z',
  objectId: id,
  eventType: 'ContributionAdded',
  payload: {},
})

describe('json repository', () => {
  it('starts empty when the file does not exist', async () => {
    const repository = createJsonRepository({ file: join(dir, 'missing.json') })
    expect(await repository.read()).toEqual([])
  })

  it('appends and reads back in order, filtered by problem', async () => {
    const repository = createJsonRepository({ file: join(dir, 'log.json') })
    await repository.append([event('a'), event('b')])
    await repository.append([{ ...event('c'), problemId: 'p2' }])

    expect((await repository.read()).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect((await repository.read('p1')).map((e) => e.id)).toEqual(['a', 'b'])
    expect((await repository.read('p2')).map((e) => e.id)).toEqual(['c'])
  })

  it('loses nothing when many writers append concurrently', async () => {
    const file = join(dir, 'concurrent.json')
    const repository = createJsonRepository({ file })

    // The v0.2 read-modify-write store failed this: interleaved loads meant
    // later writes clobbered earlier ones.
    await Promise.all(Array.from({ length: 50 }, (_, i) => repository.append([event(`e${i}`)])))

    const events = await repository.read()
    expect(events).toHaveLength(50)
    expect(new Set(events.map((e) => e.id)).size).toBe(50)

    // And the file on disk agrees with what the repository reports.
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { events: MemoryEvent[] }
    expect(onDisk.events).toHaveLength(50)
  })

  it('survives a reload: a second repository over the same file sees the history', async () => {
    const file = join(dir, 'reload.json')
    await createJsonRepository({ file }).append([event('a'), event('b')])
    const reopened = createJsonRepository({ file })
    expect((await reopened.read()).map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('durable round trip', () => {
  it('rebuilds identical canonical state from disk in a fresh process-equivalent', async () => {
    const file = join(dir, 'memory.json')
    const common = {
      auth: createPrototypeAuth({ deterministicTokens: true }),
      curator: nullCurator,
    }

    const first = await buildServices({
      repository: createJsonRepository({ file }),
      clock: fixedClock(),
      ids: createIdSource(),
      ...common,
    })
    const kai = await first.auth.verify(first.auth.issueStable('Kai'))
    await first.contributions.add(kai, { problemId: 'campus-ai', content: 'A durable claim about funding.' })
    const before = await first.problems.getState('campus-ai')

    // A new service set over the same file — as if the server had restarted.
    const second = await buildServices({
      repository: createJsonRepository({ file }),
      clock: fixedClock('2026-10-01T09:00:00.000Z'),
      ...common,
    })
    const after = await second.problems.getState('campus-ai')

    expect(after).toEqual(before)

    // And new ids do not collide with the restored log.
    const kai2 = await second.auth.verify(second.auth.issueStable('Kai'))
    const added = await second.contributions.add(kai2, { problemId: 'campus-ai', content: 'A second durable claim.' })
    expect(before.contributions.map((c) => c.id)).not.toContain(added.contribution.id)
  })
})
