/**
 * `npm run brainstorm -- <command> <repo-dir> [options]`
 *
 * The adoption ladder as a CLI. Nothing here is required to use the shared
 * room; it is how a repository gets from "no Brainstorm" to "a useful view"
 * in minutes, and from there to a shared room when collaboration earns it.
 *
 *   init    <repo>                     propose a brainstorm.config.json from the repo's layout (prints; never overwrites)
 *   build   <repo> [--out <dir>]       Level 1: static brainstorm.html + brainstorm.snapshot.json, no backend
 *   preview <repo> --url <room> --token <t>   Level 2 dry run: what an import would add, what has gone stale
 *   push    <repo> --url <room> --token <t>   Level 2: import into a shared room (Node or Cloudflare)
 *
 * The CLI reads files locally and sends only the ones the manifest names; a
 * room never fetches a repository itself.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createIdSource, type Clock } from '../server/domain/events.js'
import { project } from '../server/domain/projections.js'
import {
  MANIFEST_FILE, MANIFEST_VERSION, manifestFiles, parseManifest, repositoryFromRemote, type AdoptionManifest,
} from '../server/adoption/manifest.js'
import { planImport, type ImportPlan } from '../server/adoption/plan.js'
import { renderStaticView } from '../server/adoption/static-view.js'
import { extractUnits } from '../server/adoption/markdown.js'

const STATIC_IMPORTER = 'importer:static'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function fail(message: string): never {
  console.error(`brainstorm: ${message}`)
  process.exit(1)
}

function gitRevision(dir: string): string | undefined {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

function gitRepository(dir: string): string | undefined {
  try {
    const url = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return repositoryFromRemote(url)
  } catch {
    return undefined
  }
}

function loadManifest(dir: string): AdoptionManifest {
  const path = join(dir, MANIFEST_FILE)
  if (!existsSync(path)) fail(`no ${MANIFEST_FILE} in ${dir}. Run \`npm run brainstorm -- init ${dir}\` first.`)
  try {
    return parseManifest(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    fail(`${MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readFiles(dir: string, manifest: AdoptionManifest): Record<string, string> {
  const files: Record<string, string> = {}
  for (const path of manifestFiles(manifest)) {
    const full = join(dir, path)
    if (existsSync(full)) files[path] = readFileSync(full, 'utf8')
  }
  return files
}

function summarise(report: ImportPlan['report']): void {
  for (const space of report.spaces) {
    const skipped = Object.entries(space.skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')
    console.log(
      `  ${space.problemId.padEnd(24)} ${space.created ? 'new  ' : 'known'}  +${space.added.length} added  ` +
        `${space.unchanged} unchanged  ${space.stale.length} stale${skipped ? `  (skipped: ${skipped})` : ''}`,
    )
    for (const missing of space.missingFiles) console.log(`    missing: ${missing}`)
    for (const stale of space.stale) console.log(`    stale:   ${stale.label}`)
  }
}

/** Walks the repo for brainstorm-shaped documents. Shallow and dumb on purpose: it proposes, the human edits. */
function discover(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string, depth: number) => {
    if (depth > 4) return
    for (const entry of readdirSync(current)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full, depth + 1)
      else if (/^(BRAINSTORM|.*\.brainstorm)\.md$/i.test(entry)) found.push(relative(dir, full).replace(/\\/g, '/'))
    }
  }
  walk(dir, 0)
  return found.sort()
}

function init(dir: string): void {
  const sources = discover(dir)
  if (sources.length === 0) {
    fail('found no BRAINSTORM.md or *.brainstorm.md files. Write the manifest by hand — see docs/ADOPTION.md.')
  }
  const spaces = sources.map((path) => {
    const folder = path.split('/').slice(0, -1)
    const id = (folder[folder.length - 1] ?? path.replace(/\.brainstorm\.md$|\.md$/i, ''))
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '')
    const brief = [...folder, 'BRIEF.md'].join('/')
    const hasBrief = existsSync(join(dir, brief))
    // A brief's own title is the challenge's wording; only without one does
    // the brainstorm document's heading stand in.
    const title = hasBrief
      ? undefined
      : extractUnits(readFileSync(join(dir, path), 'utf8')).title?.replace(/^Brainstorm\s*[—–:-]\s*/i, '')
    return {
      id,
      ...(title ? { title } : {}),
      ...(hasBrief ? { brief } : {}),
      sources: [path],
    }
  })
  const repository = gitRepository(dir)
  const manifest = { version: MANIFEST_VERSION, ...(repository ? { repository } : {}), problemSpaces: spaces }
  // Validate what we propose with the same parser a room will use.
  parseManifest(manifest)
  const out = `${JSON.stringify(manifest, null, 2)}\n`
  if (existsSync(join(dir, MANIFEST_FILE))) {
    console.error(`${MANIFEST_FILE} already exists; proposal printed below, nothing written.\n`)
  } else if (process.argv.includes('--write')) {
    writeFileSync(join(dir, MANIFEST_FILE), out)
    console.error(`wrote ${join(dir, MANIFEST_FILE)}`)
    return
  } else {
    console.error(`Proposed ${MANIFEST_FILE} (re-run with --write to save it):\n`)
  }
  process.stdout.write(out)
}

function build(dir: string): void {
  const manifest = loadManifest(dir)
  const files = readFiles(dir, manifest)
  const revision = gitRevision(dir)
  const generatedAt = new Date().toISOString()
  // A fixed clock: the static log is reproducible for a given revision.
  const clock: Clock = { now: () => generatedAt }
  const plan = planImport({
    bundle: { manifest, files, ...(revision ? { revision } : {}) },
    existing: [],
    deps: { clock, ids: createIdSource() },
    importedBy: STATIC_IMPORTER,
  })

  const states = manifest.problemSpaces.flatMap((space) => {
    const state = project(plan.events.filter((e) => e.problemId === space.id))
    return state ? [state] : []
  })

  const out = resolve(arg('--out') ?? join(dir, '.brainstorm'))
  mkdirSync(out, { recursive: true })
  writeFileSync(
    join(out, 'brainstorm.html'),
    renderStaticView({ title: manifest.title ?? manifest.repository ?? 'Problem spaces', states, report: plan.report, generatedAt }),
  )
  writeFileSync(
    join(out, 'brainstorm.snapshot.json'),
    `${JSON.stringify({ $type: 'ai.bridgework.brainstorm.snapshot', schemaVersion: '0.4', generatedAt, report: plan.report, events: plan.events }, null, 2)}\n`,
  )
  console.log(`Level 1 view for ${manifest.repository ?? dir}${revision ? ` @ ${revision.slice(0, 12)}` : ''}:`)
  summarise(plan.report)
  console.log(`\n  ${join(out, 'brainstorm.html')}\n  ${join(out, 'brainstorm.snapshot.json')}`)
}

async function send(dir: string, dryRun: boolean): Promise<void> {
  const url = arg('--url') ?? process.env.BRAINSTORM_URL
  const token = arg('--token') ?? process.env.BRAINSTORM_TOKEN
  if (!url || !token) fail('push/preview need --url <room> and --token <bearer token> (or BRAINSTORM_URL / BRAINSTORM_TOKEN).')
  const manifest = loadManifest(dir)
  const revision = gitRevision(dir)
  const response = await fetch(`${url.replace(/\/$/, '')}/api/imports${dryRun ? '/preview' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ manifest, files: readFiles(dir, manifest), ...(revision ? { revision } : {}) }),
  })
  const body = (await response.json()) as ImportPlan['report'] & { message?: string }
  if (!response.ok) fail(`${response.status} ${body.message ?? ''}`)
  console.log(`${dryRun ? 'Would import' : 'Imported'} into ${url}:`)
  summarise(body)
}

const [command, target] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
if (!command || !target) {
  console.error('usage: npm run brainstorm -- <init|build|preview|push> <repo-dir> [--write] [--out dir] [--url room --token t]')
  process.exit(1)
}
const dir = resolve(target)
if (!existsSync(dir)) fail(`${dir} does not exist.`)

switch (command) {
  case 'init':
    init(dir)
    break
  case 'build':
    build(dir)
    break
  case 'preview':
    await send(dir, true)
    break
  case 'push':
    await send(dir, false)
    break
  default:
    fail(`unknown command "${command}".`)
}
