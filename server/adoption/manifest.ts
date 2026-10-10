/**
 * The adoption manifest: the smallest declaration a repository makes to opt
 * into Brainstorm.
 *
 * One JSON file at the repository root, `brainstorm.config.json`, beside
 * whatever else the repo already declares (e.g. `observstory.config.json`).
 * Its presence is also how other tools discover that a repository has
 * problem spaces at all.
 *
 *   {
 *     "version": 1,
 *     "repository": "owner/name",
 *     "problemSpaces": [
 *       { "id": "basel-38", "brief": "challenges/basel-38/BRIEF.md",
 *         "sources": ["challenges/basel-38/BRAINSTORM.md"] }
 *     ]
 *   }
 *
 * JSON rather than YAML on purpose: no parser dependency, and the same shape
 * the sibling tools in these repositories already use.
 */
import { invalid } from '../domain/errors.js'

export const MANIFEST_FILE = 'brainstorm.config.json'
export const MANIFEST_VERSION = 1

export const MAX_SPACES = 24
export const MAX_SOURCES_PER_SPACE = 12

export interface ProblemSpaceDeclaration {
  /** Becomes the problem id in a shared room. Lowercase, digits, dashes. */
  id: string
  title?: string
  shortTitle?: string
  description?: string
  /**
   * The source of truth for what the problem *is*. Read for the title and
   * description; never imported as contributions — repo facts stay repo facts.
   */
  brief?: string
  /** Documents whose content becomes reviewable contributions. Markdown only. */
  sources: string[]
}

export interface AdoptionManifest {
  version: typeof MANIFEST_VERSION
  /** `owner/name`, used for provenance and source links. */
  repository?: string
  /** Base for source links; defaults to GitHub when `repository` is set. */
  sourceUrlBase?: string
  title?: string
  problemSpaces: ProblemSpaceDeclaration[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** Relative, forward-slash, no traversal. A manifest cannot point outside its repository. */
export function assertRepoPath(path: unknown, field: string): string {
  if (typeof path !== 'string' || path.trim() === '') throw invalid(`${field} must be a non-empty path.`)
  const clean = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (clean.startsWith('/') || clean.split('/').some((part) => part === '..' || part === '')) {
    throw invalid(`${field} must be a relative path inside the repository.`, { path })
  }
  if (!/\.(md|markdown)$/i.test(clean)) throw invalid(`${field} must be a Markdown file.`, { path })
  return clean
}

const optionalText = (value: unknown, field: string, max: number): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalid(`${field} must be a string.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw invalid(`${field} may be at most ${max} characters.`)
  return trimmed || undefined
}

export function parseManifest(value: unknown): AdoptionManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${MANIFEST_FILE} must contain a JSON object.`)
  }
  const raw = value as Record<string, unknown>
  if (raw.version !== MANIFEST_VERSION) {
    throw invalid(`${MANIFEST_FILE}: "version" must be ${MANIFEST_VERSION}.`, { version: raw.version })
  }

  const repository = optionalText(raw.repository, 'repository', 200)
  if (repository && !REPO.test(repository)) throw invalid('repository must look like "owner/name".')
  const sourceUrlBase = optionalText(raw.sourceUrlBase, 'sourceUrlBase', 400)
  if (sourceUrlBase && !/^https:\/\//.test(sourceUrlBase)) throw invalid('sourceUrlBase must be an https URL.')

  if (!Array.isArray(raw.problemSpaces) || raw.problemSpaces.length === 0) {
    throw invalid('problemSpaces must be a non-empty array.')
  }
  if (raw.problemSpaces.length > MAX_SPACES) throw invalid(`At most ${MAX_SPACES} problem spaces per manifest.`)

  const seen = new Set<string>()
  const problemSpaces = raw.problemSpaces.map((entry, index): ProblemSpaceDeclaration => {
    if (!entry || typeof entry !== 'object') throw invalid(`problemSpaces[${index}] must be an object.`)
    const space = entry as Record<string, unknown>
    if (typeof space.id !== 'string' || !ID.test(space.id)) {
      throw invalid(`problemSpaces[${index}].id must be lowercase letters, digits and dashes.`, { id: space.id })
    }
    if (seen.has(space.id)) throw invalid(`Duplicate problem space id "${space.id}".`)
    seen.add(space.id)

    const sources = Array.isArray(space.sources) ? space.sources : []
    if (sources.length === 0) throw invalid(`problemSpaces[${index}].sources must list at least one file.`)
    if (sources.length > MAX_SOURCES_PER_SPACE) {
      throw invalid(`problemSpaces[${index}] may list at most ${MAX_SOURCES_PER_SPACE} sources.`)
    }

    const title = optionalText(space.title, `problemSpaces[${index}].title`, 200)
    const shortTitle = optionalText(space.shortTitle, `problemSpaces[${index}].shortTitle`, 60)
    const description = optionalText(space.description, `problemSpaces[${index}].description`, 2000)
    return {
      id: space.id,
      ...(title ? { title } : {}),
      ...(shortTitle ? { shortTitle } : {}),
      ...(description ? { description } : {}),
      ...(space.brief !== undefined ? { brief: assertRepoPath(space.brief, `problemSpaces[${index}].brief`) } : {}),
      sources: sources.map((path, i) => assertRepoPath(path, `problemSpaces[${index}].sources[${i}]`)),
    }
  })

  const title = optionalText(raw.title, 'title', 200)
  return {
    version: MANIFEST_VERSION,
    ...(repository ? { repository } : {}),
    ...(sourceUrlBase ? { sourceUrlBase } : {}),
    ...(title ? { title } : {}),
    problemSpaces,
  }
}

/** Every file a manifest needs read, deduplicated, in declaration order. */
export function manifestFiles(manifest: AdoptionManifest): string[] {
  const files: string[] = []
  for (const space of manifest.problemSpaces) {
    for (const path of [...(space.brief ? [space.brief] : []), ...space.sources]) {
      if (!files.includes(path)) files.push(path)
    }
  }
  return files
}

/**
 * A link to a line range in the source, when one can be built. GitHub by
 * default; any forge via `sourceUrlBase` (`<base>/<path>#L<a>-L<b>`).
 */
export function sourceUrl(
  manifest: Pick<AdoptionManifest, 'repository' | 'sourceUrlBase'>,
  revision: string | undefined,
  path: string,
  lines?: { start: number; end: number },
): string | undefined {
  const base =
    manifest.sourceUrlBase ??
    (manifest.repository ? `https://github.com/${manifest.repository}/blob/${revision ?? 'HEAD'}` : undefined)
  if (!base) return undefined
  const anchor = lines ? (lines.start === lines.end ? `#L${lines.start}` : `#L${lines.start}-L${lines.end}`) : ''
  return `${base.replace(/\/$/, '')}/${path}${anchor}`
}

/**
 * `owner/name` from a git remote URL, for GitHub remotes. Names may contain
 * dots ("hack.am.rhein"); only a trailing `.git` is dropped.
 */
export function repositoryFromRemote(url: string): string | undefined {
  return /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]
}
