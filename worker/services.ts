import { systemClock, type IdSource, type MemoryEvent } from '../server/domain/events.js'
import { createProblemService } from '../server/application/problem-service.js'
import { createContributionService } from '../server/application/contribution-service.js'
import { createCurationService } from '../server/application/curation-service.js'
import { nullCurator } from '../server/curation/ai-curator.js'
import { ensureSeedData } from '../server/persistence/seed.js'
import type { EventRepository } from '../server/persistence/repository.js'
import { createDemoAuth } from './demo-auth.js'
import { createDurableEventRepository } from './durable-repository.js'

interface EventLogStub {
  append(events: MemoryEvent[]): Promise<void>
  appendIfEmpty(events: MemoryEvent[]): Promise<boolean>
  read(problemId?: string): Promise<MemoryEvent[]>
}

export interface WorkerEnv {
  EVENT_LOG: { getByName(name: string): EventLogStub }
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const runtimeIds: IdSource = {
  next(prefix) {
    return `${prefix}_${crypto.randomUUID()}`
  },
}

function createCaptureRepository() {
  const events: MemoryEvent[] = []
  const repository: EventRepository = {
    async append(next) {
      events.push(...next)
    },
    async read(problemId) {
      return problemId ? events.filter((event) => event.problemId === problemId) : [...events]
    },
  }
  return { repository, events }
}

export type WorkerServices = Awaited<ReturnType<typeof buildWorkerServices>>

/** Build one transport-agnostic service set against Cloudflare persistence. */
export async function buildWorkerServices(env: WorkerEnv) {
  const repository = createDurableEventRepository(env.EVENT_LOG)

  // Build the seed events without touching the Durable Object, then let the
  // object atomically install them only when its log is still empty. This
  // avoids duplicate bootstrap history when several isolates start together.
  const capture = createCaptureRepository()
  await ensureSeedData({ repository: capture.repository, clock: systemClock, ids: runtimeIds })
  await repository.appendIfEmpty(capture.events)

  const deps = {
    repository,
    clock: systemClock,
    ids: runtimeIds,
    curator: nullCurator,
  }

  return {
    problems: createProblemService(deps),
    contributions: createContributionService(deps),
    curation: createCurationService(deps),
    auth: createDemoAuth(),
    curator: nullCurator,
    repository,
  }
}
