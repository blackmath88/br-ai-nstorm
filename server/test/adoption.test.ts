/**
 * Repository adoption (issue #4): manifest, deterministic extraction, the
 * import plan and its synchronisation rules, the static Level-1 view, and the
 * Level-2 import route.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createIdSource, type Clock } from '../domain/events.js'
import { project } from '../domain/projections.js'
import { parseManifest, repositoryFromRemote, sourceUrl, type AdoptionManifest } from '../adoption/manifest.js'
import { extractUnits, kindFor } from '../adoption/markdown.js'
import { planImport, stableHash, unitId } from '../adoption/plan.js'
import { renderStaticView } from '../adoption/static-view.js'
import { createHarness, fixedClock, type Harness } from './harness.js'

const BRIEF = `# Too hot to handle — Basel at 38

> Heat is the quietest emergency in the city.

**Domain:** social-impact

## The situation

Heat affects more people than any other hazard.
`

const BRAINSTORM = `# Brainstorm — Basel at 38

## Problem beneath the brief

Basel already has information. The deeper problem may be:

> How do we align the forces around the cause?

## Cause-centred mapping

Possible flow:

\`\`\`
CAUSE → ACTORS → ACTION
\`\`\`

Potential actors:

- Basel-Stadt
- MeteoSwiss
- Pro Senectute;

## Ideas

- Turn a level 3 warning into a phone call for people who live alone.
  This needs the hotline to run outside office hours.
- Publish the cool-room list as open data with opening hours.
  - including accessibility notes

| a | b |
|---|---|
| 1 | 2 |

## Risks / assumptions

- Care teams will share aggregated visit data.

## Open questions

- Who is the primary user?
- Is a map enough
`

const manifest: AdoptionManifest = parseManifest({
  version: 1,
  repository: 'blackmath88/hack-am-rhein',
  problemSpaces: [
    {
      id: 'basel-38',
      brief: 'challenges/basel-38/BRIEF.md',
      sources: ['challenges/basel-38/BRAINSTORM.md'],
    },
  ],
})

const files = {
  'challenges/basel-38/BRIEF.md': BRIEF,
  'challenges/basel-38/BRAINSTORM.md': BRAINSTORM,
}

const deps = (clock: Clock = fixedClock()) => ({ clock, ids: createIdSource() })

describe('manifest', () => {
  it('accepts the minimal declaration', () => {
    const parsed = parseManifest({ version: 1, problemSpaces: [{ id: 'x', sources: ['NOTES.md'] }] })
    expect(parsed.problemSpaces[0]).toEqual({ id: 'x', sources: ['NOTES.md'] })
  })

  it.each([
    [{ version: 2, problemSpaces: [{ id: 'x', sources: ['a.md'] }] }, /version/],
    [{ version: 1, problemSpaces: [] }, /non-empty/],
    [{ version: 1, problemSpaces: [{ id: 'X Y', sources: ['a.md'] }] }, /lowercase/],
    [{ version: 1, problemSpaces: [{ id: 'x', sources: ['../secrets.md'] }] }, /inside the repository/],
    [{ version: 1, problemSpaces: [{ id: 'x', sources: ['/etc/passwd.md'] }] }, /inside the repository/],
    [{ version: 1, problemSpaces: [{ id: 'x', sources: ['data.csv'] }] }, /Markdown/],
    [{ version: 1, problemSpaces: [{ id: 'x', sources: ['a.md'] }, { id: 'x', sources: ['b.md'] }] }, /Duplicate/],
    [{ version: 1, repository: 'not a repo', problemSpaces: [{ id: 'x', sources: ['a.md'] }] }, /owner\/name/],
  ])('rejects %j', (value, message) => {
    expect(() => parseManifest(value)).toThrow(message)
  })

  it('builds line-anchored source links', () => {
    expect(sourceUrl(manifest, 'abc123', 'a/B.md', { start: 3, end: 5 })).toBe(
      'https://github.com/blackmath88/hack-am-rhein/blob/abc123/a/B.md#L3-L5',
    )
    expect(sourceUrl({}, undefined, 'a.md')).toBeUndefined()
  })
})

describe('markdown extraction', () => {
  const result = extractUnits(BRAINSTORM)
  const texts = result.units.map((u) => u.text)

  it('reads the title and skips code and tables, counting what it skipped', () => {
    expect(result.title).toBe('Brainstorm — Basel at 38')
    expect(result.skipped.code).toBe(1)
    expect(result.skipped.table).toBe(1)
    expect(texts.join(' ')).not.toMatch(/CAUSE →|\| a \|/)
    // "Possible flow:" introduced the code block; alone it means nothing.
    expect(result.skipped.leadIn).toBe(1)
    expect(texts).not.toContain('Possible flow:')
  })

  it('carries a lead-in into the quote it introduces', () => {
    const unit = result.units.find((u) => u.text.includes('align the forces'))!
    expect(unit.text).toBe('Basel already has information. The deeper problem may be: How do we align the forces around the cause?')
    expect(unit.startLine).toBe(5)
    expect(unit.endLine).toBe(7)
    expect(kindFor(unit)).toBe('question')
  })

  it('keeps a short enumeration together with its lead-in, without doubled punctuation', () => {
    expect(texts).toContain('Potential actors: Basel-Stadt; MeteoSwiss; Pro Senectute')
  })

  it('treats long list items as separate units and folds continuations and nested items in', () => {
    const call = result.units.find((u) => u.text.startsWith('Turn a level 3 warning'))!
    expect(call.text).toBe(
      'Turn a level 3 warning into a phone call for people who live alone. This needs the hotline to run outside office hours.',
    )
    expect([call.startLine, call.endLine]).toEqual([25, 26])
    expect(texts).toContain('Publish the cool-room list as open data with opening hours.; including accessibility notes')
  })

  it('takes kinds from the author’s headings', () => {
    const kinds = Object.fromEntries(result.units.map((u) => [u.text.slice(0, 20), kindFor(u)]))
    expect(kinds['Turn a level 3 warni']).toBe('approach')
    expect(kinds['Care teams will shar']).toBe('assumption')
    expect(kinds['Is a map enough']).toBe('question')
  })

  it('is deterministic', () => {
    expect(extractUnits(BRAINSTORM)).toEqual(result)
  })
})

describe('import plan', () => {
  it('opens the problem from the brief without importing the brief', () => {
    const plan = planImport({ bundle: { manifest, files, revision: 'a4124eda19a1ff' }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const state = project(plan.events)!
    expect(state.problem.title).toBe('Too hot to handle — Basel at 38')
    expect(state.problem.description).toBe('Heat is the quietest emergency in the city.')
    expect(state.problem.createdBy).toBe('person:achim')
    expect(state.problem.thinkNext).toContain('Who is the primary user?')
    // The challenge's own wording stays in the repository.
    expect(state.contributions.some((c) => c.content.includes('any other hazard'))).toBe(false)
  })

  it('attributes content to the repository, unendorsed, with a line-anchored source', () => {
    const plan = planImport({ bundle: { manifest, files, revision: 'a4124eda19a1ff' }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const state = project(plan.events)!
    for (const c of state.contributions) {
      expect(c.provenance).toMatchObject({
        authoredBy: 'repo:blackmath88/hack-am-rhein',
        submittedBy: 'person:achim',
        source: 'repo_import',
        endorsement: 'participant_review_required',
      })
      expect(c.provenance.preparedBy).toBeUndefined()
    }
    const call = state.contributions.find((c) => c.content.startsWith('Turn a level 3'))!
    expect(call.provenance.sourceDetail).toBe(
      'blackmath88/hack-am-rhein@a4124eda19a1:challenges/basel-38/BRAINSTORM.md#L25-L26 · § Ideas · ' +
        'https://github.com/blackmath88/hack-am-rhein/blob/a4124eda19a1ff/challenges/basel-38/BRAINSTORM.md#L25-L26',
    )
  })

  it('uses content-addressed ids, so re-importing is a no-op at any revision', () => {
    const first = planImport({ bundle: { manifest, files, revision: 'r1' }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const again = planImport({ bundle: { manifest, files, revision: 'r2' }, existing: first.events, deps: deps(), importedBy: 'person:kai' })
    expect(again.events).toEqual([])
    expect(again.report.spaces[0]).toMatchObject({ created: false, unchanged: first.report.spaces[0].added.length, stale: [] })
    // The id is a function of (problem, path, text) and nothing else.
    for (const c of project(first.events)!.contributions) {
      expect(c.id).toBe(unitId('basel-38', 'challenges/basel-38/BRAINSTORM.md', c.content))
    }
  })

  it('adds a changed line as new and reports the old one as stale — it never edits or supersedes', () => {
    const first = planImport({ bundle: { manifest, files }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const edited = {
      ...files,
      'challenges/basel-38/BRAINSTORM.md': BRAINSTORM.replace('Who is the primary user?', 'Who is the primary user on a hot morning?'),
    }
    const second = planImport({ bundle: { manifest, files: edited }, existing: first.events, deps: deps(), importedBy: 'person:achim' })
    expect(second.events.map((e) => e.eventType)).toEqual(['ContributionAdded'])
    expect(second.report.spaces[0].stale.map((s) => s.label)).toEqual(['Who is the primary user?'])

    const state = project([...first.events, ...second.events])!
    // Both are still there and active; a human decides about supersession.
    expect(state.contributions.filter((c) => c.content.startsWith('Who is the primary user')).map((c) => c.status)).toEqual([
      'active',
      'active',
    ])
  })

  it('reports missing files instead of failing', () => {
    const plan = planImport({
      bundle: { manifest, files: { 'challenges/basel-38/BRAINSTORM.md': BRAINSTORM } },
      existing: [],
      deps: deps(),
      importedBy: 'person:achim',
    })
    expect(plan.report.spaces[0].missingFiles).toEqual(['challenges/basel-38/BRIEF.md'])
    // Without a brief the brainstorm's own heading stands in.
    expect(project(plan.events)!.problem.title).toBe('basel-38')
  })

  it('hashes stably', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'))
    expect(stableHash('abc')).not.toBe(stableHash('abd'))
    expect(stableHash('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('static view', () => {
  it('renders quoted content with source links and escapes everything', () => {
    const hostile = { ...files, 'challenges/basel-38/BRAINSTORM.md': `${BRAINSTORM}\n## Ideas\n\n- <script>alert(1)</script> is not markup here\n` }
    const plan = planImport({ bundle: { manifest, files: hostile, revision: 'abc' }, existing: [], deps: deps(), importedBy: 'importer:static' })
    const html = renderStaticView({ title: 'Test', states: [project(plan.events)!], report: plan.report, generatedAt: '2026-10-10T00:00:00.000Z' })
    expect(html).toContain('Too hot to handle — Basel at 38')
    expect(html).toContain('href="https://github.com/blackmath88/hack-am-rhein/blob/abc/challenges/basel-38/BRAINSTORM.md#L25-L26"')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('import into a shared room', () => {
  let harness: Harness | undefined
  afterEach(async () => {
    await harness?.close()
    harness = undefined
  })

  const body = { manifest, files: { ...files, 'secrets.md': 'not named by the manifest' }, revision: 'abc123' }

  it('previews without writing, then imports, idempotently', async () => {
    harness = await createHarness()
    const token = harness.token('Achim')
    const before = (await harness.services.repository.read()).length

    const preview = await harness.http<{ spaces: Array<{ added: unknown[]; created: boolean }> }>('POST', '/api/imports/preview', { token, body })
    expect(preview.status).toBe(200)
    expect(preview.body.spaces[0].created).toBe(true)
    expect((await harness.services.repository.read()).length).toBe(before)

    const applied = await harness.http<{ spaces: Array<{ added: unknown[] }> }>('POST', '/api/imports', { token, body })
    expect(applied.status).toBe(201)
    expect(applied.body.spaces[0].added.length).toBe(preview.body.spaces[0].added.length)

    const again = await harness.http<{ spaces: Array<{ added: unknown[]; unchanged: number }> }>('POST', '/api/imports', { token, body })
    expect(again.body.spaces[0].added).toHaveLength(0)

    const listed = await harness.http<{ problems: Array<{ id: string; orchestration: { mode: string } }> }>('GET', '/api/problems', { token })
    expect(listed.body.problems.find((p) => p.id === 'basel-38')?.orchestration.mode).toBe('participant')
  })

  it('never reads a file the manifest does not name', async () => {
    harness = await createHarness()
    const achim = await harness.actor('Achim')
    await harness.services.imports.apply(achim, body)
    const state = await harness.services.problems.getState('basel-38')
    expect(state.contributions.some((c) => c.content.includes('not named'))).toBe(false)
  })

  it('makes imported text uneditable in the room — corrections go to the repository', async () => {
    harness = await createHarness()
    const achim = await harness.actor('Achim')
    await harness.services.imports.apply(achim, body)
    const imported = (await harness.services.problems.getState('basel-38')).contributions[0]
    await expect(
      harness.services.contributions.edit(achim, { problemId: 'basel-38', contributionId: imported.id, content: 'rewritten' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lets imported items be curated like any other contribution', async () => {
    harness = await createHarness()
    const achim = await harness.actor('Achim')
    const kai = await harness.actor('Kai')
    await harness.services.imports.apply(achim, body)
    const target = (await harness.services.problems.getState('basel-38')).contributions.find((c) => c.kind === 'approach')!
    const result = await harness.services.contributions.add(kai, {
      problemId: 'basel-38',
      content: 'Many people at risk have no smartphone; a phone call reaches them, an app does not.',
      proposals: [{ kind: 'relation', targetId: target.id, relationKind: 'supports', reason: 'Argues for the phone-call channel.' }],
    })
    expect(result.curator.participant).toBe(1)
  })

  it('requires a session and validates the bundle', async () => {
    harness = await createHarness()
    expect((await harness.http('POST', '/api/imports', { body })).status).toBe(401)
    const bad = await harness.http('POST', '/api/imports', {
      token: harness.token('Achim'),
      body: { ...body, manifest: { version: 1, problemSpaces: [{ id: 'x', sources: ['../../etc/passwd.md'] }] } },
    })
    expect(bad.status).toBe(422)
  })
})

describe('review fixes', () => {
  it('does not report items from a missing file as stale', () => {
    const first = planImport({ bundle: { manifest, files }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const without = planImport({
      bundle: { manifest, files: { 'challenges/basel-38/BRIEF.md': BRIEF } },
      existing: first.events,
      deps: deps(),
      importedBy: 'person:achim',
    })
    expect(without.report.spaces[0].missingFiles).toEqual(['challenges/basel-38/BRAINSTORM.md'])
    expect(without.report.spaces[0].stale).toEqual([])
  })

  it('replays a duplicated import idempotently — the first ProblemCreated and ContributionAdded win', () => {
    const first = planImport({ bundle: { manifest, files }, existing: [], deps: deps(), importedBy: 'person:achim' })
    // Two overlapping pushes that both saw an empty log append the same ids twice.
    const racing = planImport({ bundle: { manifest, files }, existing: [], deps: deps(fixedClock('2026-09-02T00:00:00.000Z')), importedBy: 'person:kai' })
    const target = first.events.find((e) => e.eventType === 'ContributionAdded')!.objectId
    const between = [
      { ...first.events[0], id: 'evt_x1', eventType: 'OrchestrationModeChanged' as const, actorId: 'person:lea', payload: { from: 'participant', to: 'deterministic' } },
      { ...first.events[0], id: 'evt_x2', eventType: 'ContributionSuperseded' as const, objectId: target, actorId: 'person:lea', payload: { supersededBy: target } },
    ]
    const state = project([...first.events, ...between, ...racing.events])!
    expect(state.problem.createdBy).toBe('person:achim')
    expect(state.problem.orchestration.mode).toBe('deterministic')
    expect(state.contributions.find((c) => c.id === target)?.status).toBe('superseded')
    expect(state.contributions).toHaveLength(project(first.events)!.contributions.length)
  })

  it('counts a short lead-in before separate long items instead of losing it', () => {
    const doc = `## Risks\n\nThe key risks we must address are:\n\n- Care teams may not have capacity to change routes on short notice.\n- Cool rooms may close earlier than their published opening hours.\n`
    const result = extractUnits(doc)
    expect(result.units).toHaveLength(2)
    expect(result.skipped.leadIn).toBe(1)
  })

  it('never imports a long lead-in twice', () => {
    const lead = `${'This paragraph is long enough to stand on its own as a statement about the problem. '.repeat(3)}Actors:`
    const doc = `## Actors\n\n${lead}\n\n- Basel-Stadt\n- MeteoSwiss\n`
    const texts = extractUnits(doc).units.map((u) => u.text)
    expect(texts.filter((t) => t.includes('long enough'))).toHaveLength(1)
  })

  it('folds a lead-in of any length into the enumeration it introduces, exactly once', () => {
    const lead = `${'A long framing sentence that sets up who can move the cause in this city. '.repeat(3)}Potential actors:`
    const doc = `## Actors\n\n${lead}\n\n- Basel-Stadt\n- MeteoSwiss\n`
    const texts = extractUnits(doc).units.map((u) => u.text)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/Potential actors: Basel-Stadt; MeteoSwiss$/)
  })

  it('records a structured source reference', () => {
    const plan = planImport({ bundle: { manifest, files, revision: 'abc' }, existing: [], deps: deps(), importedBy: 'person:achim' })
    const call = project(plan.events)!.contributions.find((c) => c.content.startsWith('Turn a level 3'))!
    expect(call.provenance.sourceRef).toEqual({
      repository: 'blackmath88/hack-am-rhein',
      revision: 'abc',
      path: 'challenges/basel-38/BRAINSTORM.md',
      startLine: 25,
      endLine: 26,
      section: 'Ideas',
      url: 'https://github.com/blackmath88/hack-am-rhein/blob/abc/challenges/basel-38/BRAINSTORM.md#L25-L26',
    })
  })

  it('reads owner/name from remotes, including names with dots', () => {
    expect(repositoryFromRemote('https://github.com/acme/hack.am.rhein.git')).toBe('acme/hack.am.rhein')
    expect(repositoryFromRemote('git@github.com:acme/hack.am.rhein.git')).toBe('acme/hack.am.rhein')
    expect(repositoryFromRemote('https://github.com/acme/tool')).toBe('acme/tool')
    expect(repositoryFromRemote('https://gitlab.com/acme/tool.git')).toBeUndefined()
  })

  it('caps total characters per import', async () => {
    const harness = await createHarness()
    try {
      const big = 'x'.repeat(250 * 1024)
      const many = parseManifest({
        version: 1,
        problemSpaces: [{ id: 'big', sources: Array.from({ length: 10 }, (_, i) => `f${i}.md`) }],
      })
      const res = await harness.http('POST', '/api/imports/preview', {
        token: harness.token('Achim'),
        body: { manifest: many, files: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.md`, big])) },
      })
      expect(res.status).toBe(422)
    } finally {
      await harness.close()
    }
  })
})
