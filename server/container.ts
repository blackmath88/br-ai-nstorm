/**
 * Composition root — the one place that reads the environment and wires
 * adapters to ports.
 *
 * Below this line nothing knows whether it is running under HTTP, MCP-over-stdio,
 * MCP-over-HTTP or a test, which is what lets the integration test drive one
 * service instance through two transports at once.
 */
import { createIdSource, highWaterMark, systemClock, type Clock, type IdSource } from './domain/events.js'
import { createJsonRepository, createMemoryRepository } from './persistence/json-repository.js'
import { ensureSeedData } from './persistence/seed.js'
import type { EventRepository } from './persistence/repository.js'
import { createAiCurator, nullCurator, type Curator } from './curation/ai-curator.js'
import { createProblemService, type ProblemService } from './application/problem-service.js'
import { createContributionService, type ContributionService } from './application/contribution-service.js'
import { createCurationService, type CurationService } from './application/curation-service.js'
import { createPrototypeAuth, type PrototypeAuth } from './auth/prototype-auth.js'
import type { ServiceDeps } from './application/support.js'

export interface Services {
  problems: ProblemService
  contributions: ContributionService
  curation: CurationService
  auth: PrototypeAuth
  curator: Curator
  repository: EventRepository
}

export interface BuildOptions {
  repository?: EventRepository
  clock?: Clock
  ids?: IdSource
  curator?: Curator
  auth?: PrototypeAuth
  /** Skip importing the prototype problem data. Tests that build their own history set this. */
  seed?: boolean
}

/**
 * Builds a fully wired service set. Async because the id source is seeded from
 * the existing log's high-water mark — ids stay unique across restarts without
 * reaching for randomness, which is what keeps event streams reproducible.
 */
export async function buildServices(options: BuildOptions = {}): Promise<Services> {
  const repository =
    options.repository ??
    createJsonRepository({ file: process.env.BRAINSTORM_DATA_FILE ?? 'server/data/memory.json' })

  const clock = options.clock ?? systemClock
  const ids = options.ids ?? createIdSource(highWaterMark(await repository.read()))
  const curator = options.curator ?? defaultCurator()
  const auth = options.auth ?? createPrototypeAuth()

  if (options.seed !== false) {
    await ensureSeedData({ repository, clock, ids })
  }

  const deps: ServiceDeps = { repository, clock, ids, curator }

  return {
    problems: createProblemService(deps),
    contributions: createContributionService(deps),
    curation: createCurationService(deps),
    auth,
    curator,
    repository,
  }
}

function defaultCurator(): Curator {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL
  if (!apiKey || !model) return nullCurator
  return createAiCurator({ apiKey, model })
}

/** Convenience for tests and the in-process integration harness. */
export const buildTestServices = (options: BuildOptions = {}) =>
  buildServices({
    repository: createMemoryRepository(),
    auth: createPrototypeAuth({ deterministicTokens: true }),
    curator: nullCurator,
    ...options,
  })
