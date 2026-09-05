/**
 * HTTP adapter tests.
 *
 * These exercise the real `node:http` handler over a real socket, so status
 * codes, headers and JSON shapes are asserted as a client would see them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './harness.js'
import type { ConflictRecord, ContributionRecord, CurationProposal, ProblemRecord, ProblemState } from '../domain/types.js'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})
afterEach(async () => {
  await harness.close()
})

describe('identity', () => {
  it('refuses every canonical route without a token', async () => {
    for (const [method, path] of [
      ['GET', '/api/problems'],
      ['GET', '/api/problems/campus-ai'],
      ['GET', '/api/problems/campus-ai/updates'],
      ['GET', '/api/problems/campus-ai/conflicts'],
      ['GET', '/api/problems/campus-ai/curation'],
      ['POST', '/api/problems/campus-ai/contributions'],
    ] as const) {
      const response = await harness.http(method, path, { body: method === 'POST' ? { content: 'x' } : undefined })
      expect(response.status, `${method} ${path}`).toBe(401)
    }
  })

  it('answers an unknown token with 401 and a bearer challenge, like a resource server', async () => {
    const response = await fetch(`${harness.baseUrl}/api/problems`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer /)
    expect(((await response.json()) as { error: string }).error).toBe('unauthorized')
  })

  it('ignores any identity claimed in the request body', async () => {
    const kai = harness.token('Kai')
    const created = await harness.http<{ contribution: ContributionRecord }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      {
        token: kai,
        // A client trying to attribute its contribution to someone else.
        body: { content: 'Attribution should follow the token.', authorId: 'person:achim', actorId: 'person:achim', user: 'Achim' },
      },
    )
    expect(created.status).toBe(201)
    expect(created.body.contribution.provenance.authoredBy).toBe('person:kai')
    expect(created.body.contribution.provenance.submittedBy).toBe('person:kai')
  })
})

describe('reads', () => {
  it('lists problems and returns canonical state with the viewer attached', async () => {
    const token = harness.token('Achim')
    const list = await harness.http<{ problems: ProblemRecord[] }>('GET', '/api/problems', { token })
    expect(list.status).toBe(200)
    expect(list.body.problems.map((p) => p.id)).toContain('campus-ai')

    const state = await harness.http<ProblemState & { viewer: { actorId: string } }>(
      'GET',
      '/api/problems/campus-ai',
      { token },
    )
    expect(state.status).toBe(200)
    expect(state.body.contributions.length).toBeGreaterThan(0)
    expect(state.body.viewer.actorId).toBe('person:achim')
    // Provenance is exposed, not summarised away.
    expect(state.body.contributions[0].provenance.authoredBy).toBeTruthy()
  })

  it('404s an unknown problem instead of failing generically', async () => {
    const response = await harness.http('GET', '/api/problems/nope', { token: harness.token('Achim') })
    expect(response.status).toBe(404)
    expect((response.body as { error: string }).error).toBe('not_found')
  })
})

describe('writes', () => {
  it('adds a contribution, then returns it from the state endpoint', async () => {
    const token = harness.token('Kai')
    const created = await harness.http<{ contribution: ContributionRecord; proposals: CurationProposal[] }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      { token, body: { content: 'Recurring operating cost is the question nobody has priced.' } },
    )
    expect(created.status).toBe(201)

    const state = await harness.http<ProblemState>('GET', '/api/problems/campus-ai', { token })
    expect(state.body.contributions.map((c) => c.id)).toContain(created.body.contribution.id)
  })

  it('rejects invalid input with 422 and a usable message', async () => {
    const token = harness.token('Kai')
    const empty = await harness.http('POST', '/api/problems/campus-ai/contributions', { token, body: { content: '   ' } })
    expect(empty.status).toBe(422)

    const missing = await harness.http('POST', '/api/problems/campus-ai/contributions', { token, body: {} })
    expect(missing.status).toBe(422)
    expect((missing.body as { message: string }).message).toMatch(/content/)

    const badKind = await harness.http('POST', '/api/problems/campus-ai/contributions', {
      token,
      body: { content: 'fine', kind: 'nonsense' },
    })
    expect(badKind.status).toBe(422)
  })
})

describe('curation review over HTTP', () => {
  it('moves a proposal to accepted and surfaces the conflict', async () => {
    const kai = harness.token('Kai')
    const achim = harness.token('Achim')

    const created = await harness.http<{ proposals: CurationProposal[] }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      {
        token: kai,
        body: { content: 'Open sourcing the core does not create service ownership, however the plan assumes it will.' },
      },
    )
    const proposal = created.body.proposals.find((p) => p.kind === 'conflict')
    expect(proposal).toBeDefined()

    const queue = await harness.http<{ proposals: CurationProposal[] }>(
      'GET',
      '/api/problems/campus-ai/curation?status=pending',
      { token: achim },
    )
    expect(queue.body.proposals.some((p) => p.id === proposal!.id)).toBe(true)

    const accepted = await harness.http<{ proposal: CurationProposal; conflict: ConflictRecord }>(
      'POST',
      `/api/curation/${proposal!.id}/accept`,
      { token: achim, body: { problemId: 'campus-ai' } },
    )
    expect(accepted.status).toBe(200)
    expect(accepted.body.proposal.status).toBe('accepted')
    expect(accepted.body.proposal.reviewedBy).toBe('person:achim')

    const conflicts = await harness.http<{ open: ConflictRecord[] }>('GET', '/api/problems/campus-ai/conflicts', {
      token: kai,
    })
    expect(conflicts.body.open).toHaveLength(1)
  })

  it('reports a second review of the same proposal as 422, not a silent no-op', async () => {
    const kai = harness.token('Kai')
    const achim = harness.token('Achim')
    const created = await harness.http<{ proposals: CurationProposal[] }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      {
        token: kai,
        body: { content: 'Open sourcing the core does not create service ownership, however the plan assumes it will.' },
      },
    )
    const proposal = created.body.proposals[0]
    expect(proposal, 'expected at least one curation proposal').toBeDefined()
    await harness.http('POST', `/api/curation/${proposal.id}/accept`, { token: achim, body: { problemId: 'campus-ai' } })
    const again = await harness.http('POST', `/api/curation/${proposal.id}/reject`, {
      token: achim,
      body: { problemId: 'campus-ai' },
    })
    expect(again.status).toBe(422)
  })
})

describe('participant-facing derivations', () => {
  it('reports what changed and what happened to my contributions', async () => {
    const kai = harness.token('Kai')
    const lea = harness.token('Lea')

    const mine = await harness.http<{ contribution: ContributionRecord }>(
      'POST',
      '/api/problems/campus-ai/contributions',
      { token: kai, body: { content: 'The operating model matters more than the tooling choice.' } },
    )
    await harness.http('POST', '/api/problems/campus-ai/contributions', {
      token: lea,
      body: { content: 'Infrastructure cost estimates exist for two of the institutions.' },
    })

    const updates = await harness.http<{
      updates: Array<{ actorId: string }>
      traces: Array<{ contribution: { id: string } }>
    }>('GET', '/api/problems/campus-ai/updates', { token: kai })

    // "Since you were here" is about other people.
    expect(updates.body.updates.every((u) => u.actorId !== 'person:kai')).toBe(true)
    expect(updates.body.traces.some((t) => t.contribution.id === mine.body.contribution.id)).toBe(true)
  })
})

describe('health', () => {
  it('reports curator status without a token', async () => {
    const response = await harness.http<{ ok: boolean; aiCurator: boolean }>('GET', '/health')
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.aiCurator).toBe(false)
  })
})
