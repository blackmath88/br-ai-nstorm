/**
 * Level-2 adoption: bring a repository's declared problem spaces into a shared
 * room.
 *
 * The CLI (`npm run brainstorm -- push`) reads the files locally and sends
 * them; the server never fetches a repository itself. That keeps the trust
 * decision small — the server sees exactly the files the manifest names, and
 * nothing else — and works the same on Node and on the Worker.
 */
import type { ActorContext } from '../auth/actor-context.js'
import { assertHumanActor } from '../domain/policies.js'
import { invalid } from '../domain/errors.js'
import { manifestFiles, parseManifest } from '../adoption/manifest.js'
import { planImport, type ImportPlan } from '../adoption/plan.js'
import type { ServiceDeps } from './support.js'

/** Characters, not bytes: what a JS string length measures. */
export const MAX_IMPORT_FILE_CHARS = 256 * 1024
export const MAX_IMPORT_TOTAL_CHARS = 2 * 1024 * 1024
export const MAX_IMPORT_FILES = 64

export interface ImportService {
  /** Plans without writing — what an import *would* add, and what has gone stale. */
  preview(actor: ActorContext, bundle: unknown): Promise<ImportPlan['report']>
  apply(actor: ActorContext, bundle: unknown): Promise<ImportPlan['report']>
}

function readBundle(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Import body must be a JSON object.')
  const body = raw as Record<string, unknown>
  const manifest = parseManifest(body.manifest)

  const filesRaw = body.files
  if (!filesRaw || typeof filesRaw !== 'object' || Array.isArray(filesRaw)) {
    throw invalid('files must map repository paths to file contents.')
  }
  // Only what the manifest names is read; anything else in the body is ignored.
  const wanted = manifestFiles(manifest)
  if (wanted.length > MAX_IMPORT_FILES) throw invalid(`A manifest may name at most ${MAX_IMPORT_FILES} files.`)
  const files: Record<string, string> = {}
  let total = 0
  for (const path of wanted) {
    const content = (filesRaw as Record<string, unknown>)[path]
    if (content === undefined) continue
    if (typeof content !== 'string') throw invalid(`files["${path}"] must be a string.`)
    if (content.length > MAX_IMPORT_FILE_CHARS) {
      throw invalid(`files["${path}"] exceeds ${MAX_IMPORT_FILE_CHARS} characters.`)
    }
    total += content.length
    if (total > MAX_IMPORT_TOTAL_CHARS) {
      throw invalid(`An import may carry at most ${MAX_IMPORT_TOTAL_CHARS} characters of source in total.`)
    }
    files[path] = content
  }

  const revision = body.revision
  if (revision !== undefined && (typeof revision !== 'string' || !/^[\w./-]{1,80}$/.test(revision))) {
    throw invalid('revision must be a commit, tag or branch name.')
  }
  return { manifest, files, ...(typeof revision === 'string' ? { revision } : {}) }
}

export function createImportService(deps: ServiceDeps): ImportService {
  const plan = async (actor: ActorContext, raw: unknown) => {
    assertHumanActor(actor, 'import a repository')
    const bundle = readBundle(raw)
    const existing = await deps.repository.read()
    return planImport({ bundle, existing, deps, importedBy: actor.actorId })
  }

  return {
    async preview(actor, raw) {
      return (await plan(actor, raw)).report
    },
    async apply(actor, raw) {
      const { events, report } = await plan(actor, raw)
      if (events.length > 0) await deps.repository.append(events)
      return report
    },
  }
}
