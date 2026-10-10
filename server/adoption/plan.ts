/**
 * Plans a repository import: manifest + file contents + the existing log in,
 * events and a report out. Pure — no I/O, no clock of its own.
 *
 * The synchronisation rules, which are what keep the repository and the room
 * from becoming two competing truths:
 *
 *  1. **Identity is content-addressed.** A unit's contribution id is a hash of
 *     (problem, path, text). Re-importing unchanged text is a no-op, whatever
 *     the revision; moving it to another line is a no-op too.
 *  2. **Add-only.** A unit whose text changed in the repository arrives as a
 *     new contribution. The old one is reported as *stale*; it is not edited,
 *     superseded or removed, because supersession is a human act.
 *  3. **Imported text is not editable in the room.** Its author is the
 *     repository, not a person, so no participant passes `assertMayEdit`. A
 *     correction happens in the repository and arrives on the next import.
 *  4. **Nothing is endorsed by import.** Every unit is
 *     `participant_review_required`; inclusion means "the document says so",
 *     never "the group agrees".
 *  5. **The brief is read, not imported.** It supplies the title and
 *     description; the challenge's own wording stays in the repository.
 */
import { deriveLabel, makeEvent, type EventFactoryDeps, type MemoryEvent } from '../domain/events.js'
import type { ContributionKind, Provenance } from '../domain/types.js'
import { MAX_CONTRIBUTION_LENGTH } from '../domain/policies.js'
import { project } from '../domain/projections.js'
import type { AdoptionManifest, ProblemSpaceDeclaration } from './manifest.js'
import { sourceUrl } from './manifest.js'
import { briefSummary, extractUnits, kindFor, type MarkdownUnit } from './markdown.js'

export interface ImportBundle {
  manifest: AdoptionManifest
  /** Repository-relative path → file content. Only files the manifest names are read. */
  files: Record<string, string>
  /** Commit or tag the files were read at. Provenance only; never part of identity. */
  revision?: string
}

export interface PlannedUnit {
  id: string
  kind: ContributionKind
  label: string
  path: string
  startLine: number
  endLine: number
  section: string
  url?: string
}

export interface SpaceReport {
  problemId: string
  title: string
  created: boolean
  added: PlannedUnit[]
  unchanged: number
  /** Imported earlier from this space's sources, no longer present in them. */
  stale: Array<{ id: string; label: string; sourceDetail?: string }>
  missingFiles: string[]
  skipped: { code: number; table: number; short: number; leadIn: number; tooLong: number }
}

export interface ImportPlan {
  events: MemoryEvent[]
  report: { repository?: string; revision?: string; spaces: SpaceReport[] }
}

export const REPO_AGENT_PREFIX = 'repo:'
const MAX_THINK_NEXT = 3

/** FNV-1a, twice with different seeds: 16 hex chars, stable across runtimes, no crypto API needed. */
export function stableHash(input: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x01000193 ^ 0x5bd1e995)
}

export const unitId = (problemId: string, path: string, text: string) =>
  `${problemId}:src:${stableHash(`${problemId}\u0000${path}\u0000${text}`)}`

/** The non-person agent an imported unit is attributed to. */
export const repoAgent = (manifest: AdoptionManifest) =>
  `${REPO_AGENT_PREFIX}${manifest.repository ?? 'local'}`

function shortTitleFor(space: ProblemSpaceDeclaration, title: string): string {
  if (space.shortTitle) return space.shortTitle
  const head = title.split(/\s+[—–-]\s+|:\s+/)[0] ?? title
  return deriveLabel(head.length >= 4 ? head : title, 32)
}

export function planImport(input: {
  bundle: ImportBundle
  existing: MemoryEvent[]
  deps: EventFactoryDeps
  /** The person running the import. Opens new problems; never authors content. */
  importedBy: string
}): ImportPlan {
  const { bundle, existing, deps, importedBy } = input
  const { manifest, files, revision } = bundle
  const agent = repoAgent(manifest)
  const events: MemoryEvent[] = []
  const spaces: SpaceReport[] = []

  for (const space of manifest.problemSpaces) {
    const prior = existing.filter((e) => e.problemId === space.id)
    const priorState = project(prior)
    const missingFiles: string[] = []
    const skipped = { code: 0, table: 0, short: 0, leadIn: 0, tooLong: 0 }

    const brief = space.brief !== undefined ? files[space.brief] : undefined
    if (space.brief !== undefined && brief === undefined) missingFiles.push(space.brief)
    const summary = brief ? briefSummary(brief) : {}

    const title = space.title ?? summary.title ?? priorState?.problem.title ?? space.id
    const correlationId = deps.ids.next('corr')

    // --- units -------------------------------------------------------------
    const planned: Array<PlannedUnit & { unit: MarkdownUnit; content: string }> = []
    const seen = new Set<string>()
    for (const path of space.sources) {
      const text = files[path]
      if (text === undefined) {
        missingFiles.push(path)
        continue
      }
      const extracted = extractUnits(text)
      skipped.code += extracted.skipped.code
      skipped.table += extracted.skipped.table
      skipped.short += extracted.skipped.short
      skipped.leadIn += extracted.skipped.leadIn
      for (const unit of extracted.units) {
        if (unit.text.length > MAX_CONTRIBUTION_LENGTH) {
          skipped.tooLong += 1
          continue
        }
        const id = unitId(space.id, path, unit.text)
        if (seen.has(id)) continue // the same sentence twice in one file is one statement
        seen.add(id)
        const lines = { start: unit.startLine, end: unit.endLine }
        const url = sourceUrl(manifest, revision, path, lines)
        planned.push({
          id,
          kind: kindFor(unit),
          label: deriveLabel(unit.text),
          path,
          startLine: unit.startLine,
          endLine: unit.endLine,
          section: unit.headings.join(' › '),
          ...(url ? { url } : {}),
          unit,
          content: unit.text,
        })
      }
    }

    // --- problem -----------------------------------------------------------
    const created = !priorState
    if (created) {
      const description =
        space.description ?? summary.tagline ?? summary.description ?? `Problem space imported from ${manifest.repository ?? 'a repository'}.`
      events.push(
        makeEvent(deps, {
          problemId: space.id,
          actorId: importedBy,
          objectId: space.id,
          eventType: 'ProblemCreated',
          correlationId,
          payload: {
            title,
            shortTitle: shortTitleFor(space, title),
            description,
            stateSummary: summary.tagline ?? '',
            // The source's own open questions are the honest first prompts.
            thinkNext: planned.filter((p) => p.kind === 'question').slice(0, MAX_THINK_NEXT).map((p) => p.content),
          },
        }),
      )
    }

    // --- contributions -----------------------------------------------------
    const known = new Set(priorState?.contributions.map((c) => c.id) ?? [])
    const added = planned.filter((p) => !known.has(p.id))
    for (const unit of added) {
      const provenance: Provenance = {
        authoredBy: agent,
        submittedBy: importedBy,
        source: 'repo_import',
        sourceDetail: [
          `${manifest.repository ?? 'repo'}${revision ? `@${revision.slice(0, 12)}` : ''}:${unit.path}#L${unit.startLine}${unit.endLine !== unit.startLine ? `-L${unit.endLine}` : ''}`,
          unit.section ? `§ ${unit.section}` : '',
          unit.url ?? '',
        ]
          .filter(Boolean)
          .join(' · '),
        sourceRef: {
          ...(manifest.repository ? { repository: manifest.repository } : {}),
          ...(revision ? { revision } : {}),
          path: unit.path,
          startLine: unit.startLine,
          endLine: unit.endLine,
          ...(unit.section ? { section: unit.section } : {}),
          ...(unit.url ? { url: unit.url } : {}),
        },
        endorsement: 'participant_review_required',
        timestamp: deps.clock.now(),
      }
      events.push(
        makeEvent(deps, {
          problemId: space.id,
          actorId: agent,
          objectId: unit.id,
          eventType: 'ContributionAdded',
          correlationId,
          payload: {
            kind: unit.kind,
            label: unit.label,
            content: unit.content,
            visibility: 'problem',
            provenance,
          },
        }),
      )
    }

    // Stale means "no longer in a file we read" — never "in a file we did not
    // receive". A missing or renamed file is reported as missing, and what was
    // imported from it is left alone.
    const current = new Set(planned.map((p) => p.id))
    const readPaths = new Set(space.sources.filter((path) => files[path] !== undefined))
    const stale = (priorState?.contributions ?? [])
      .filter(
        (c) =>
          c.provenance.source === 'repo_import' &&
          c.status === 'active' &&
          c.id.startsWith(`${space.id}:src:`) &&
          !current.has(c.id) &&
          readPaths.has(c.provenance.sourceRef?.path ?? ''),
      )
      .map((c) => ({
        id: c.id,
        label: c.label,
        ...(c.provenance.sourceDetail ? { sourceDetail: c.provenance.sourceDetail } : {}),
      }))

    spaces.push({
      problemId: space.id,
      title,
      created,
      added: added.map(({ unit: _unit, content: _content, ...rest }) => rest),
      unchanged: planned.length - added.length,
      stale,
      missingFiles,
      skipped,
    })
  }

  return {
    events,
    report: {
      ...(manifest.repository ? { repository: manifest.repository } : {}),
      ...(revision ? { revision } : {}),
      spaces,
    },
  }
}
