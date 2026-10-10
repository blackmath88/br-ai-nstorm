/**
 * `npm run smoke -- --url <room>`
 *
 * A pre-session check for a field test: three participants connect over MCP
 * — the same path their AI clients will use — and run the whole loop once:
 * read cheaply, ask for context, contribute with a participant proposal,
 * have someone else accept it, judge it, read the report.
 *
 * It writes only to a throwaway problem it creates for itself (via the import
 * route), so the room's real problems are untouched. Works against the Node
 * server and the Cloudflare Worker alike.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const PEOPLE = ['Achim', 'Kai', 'Lea'] as const

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const base = (arg('--url') ?? process.env.BRAINSTORM_URL ?? 'http://localhost:8787').replace(/\/$/, '')
let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, init)
  const body = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${body.message ?? ''}`)
  return body
}

async function token(name: string): Promise<string> {
  const { token } = await json<{ token: string }>('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ participantId: name }),
  })
  return token
}

async function connect(bearer: string): Promise<Client> {
  const client = new Client({ name: 'brainstorm-smoke', version: '0.5.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bearer}` } } }),
  )
  return client
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { structuredContent?: T; isError?: boolean; content?: Array<{ text?: string }> }
  if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text ?? 'error'}`)
  return result.structuredContent as T
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${base}\n`)
  const health = await json<{ ok: boolean; orchestration: Array<{ mode: string; available: boolean }> }>('/health')
  check('health', health.ok, `modes available: ${health.orchestration.filter((o) => o.available).map((o) => o.mode).join(', ')}`)

  const tokens = Object.fromEntries(await Promise.all(PEOPLE.map(async (p) => [p, await token(p)] as const)))
  const problemId = `smoke-${Date.now().toString(36)}`
  await json('/api/imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.Achim}` },
    body: JSON.stringify({
      manifest: { version: 1, problemSpaces: [{ id: problemId, title: 'Smoke test (safe to ignore)', sources: ['SMOKE.md'] }] },
      files: {
        'SMOKE.md':
          '# Smoke\n\n## Ideas\n\n- Phone people who live alone when a heat warning is issued.\n- Publish cool-room opening hours as open data.\n\n## Open questions\n\n- Who calls on weekends?\n',
      },
    }),
  })
  check('throwaway problem created', true, problemId)

  const [achim, kai, lea] = await Promise.all(PEOPLE.map((p) => connect(tokens[p])))
  const tools = (await kai.listTools()).tools.map((t) => t.name)
  check('MCP tools listed', tools.includes('get_contribution_context') && tools.includes('evaluate_contribution'), `${tools.length} tools`)

  const overview = await call<{ contributions: Array<{ id: string }> }>(kai, 'get_problem_overview', { problemId })
  check('compact overview', overview.contributions.length === 3, `${overview.contributions.length} contributions, no bodies`)

  const context = await call<{ orchestration: { mode: string }; candidates: Array<{ id: string }> }>(kai, 'get_contribution_context', {
    problemId,
    draft: 'Weekend calls need volunteers.',
  })
  check('contribution context', context.candidates.length > 0, `mode ${context.orchestration.mode}, ${context.candidates.length} candidates`)

  const added = await call<{ proposals: Array<{ id: string; onBehalfOf?: string }>; dropped: unknown[] }>(kai, 'propose_contribution', {
    problemId,
    content: 'Weekend calls need a volunteer rota, not the office-hours hotline.',
    preparedBy: 'ai:smoke-test',
    proposals: [{ kind: 'relation', targetId: context.candidates[0].id, relationKind: 'relates', reason: 'Same outreach channel.' }],
  })
  const mine = added.proposals.find((p) => p.onBehalfOf)
  check('participant proposal recorded', Boolean(mine) && added.dropped.length === 0)

  const self = (await kai.callTool({ name: 'review_curation_proposal', arguments: { problemId, proposalId: mine!.id, accept: true } })) as { isError?: boolean }
  check('self-review refused', self.isError === true)

  await call(lea, 'review_curation_proposal', { problemId, proposalId: mine!.id, accept: true })
  check('another participant accepts', true)

  await call(achim, 'evaluate_contribution', { problemId, targetId: context.candidates[0].id, stance: 'needs_evidence' })
  check('judgement recorded', true)

  const report = await call<{ proposals: { byOrigin: { participant_ai: { accepted: number } } } }>(achim, 'get_field_report', { problemId })
  check('field report', report.proposals.byOrigin.participant_ai.accepted === 1, 'participant AI: 1 accepted')

  await Promise.all([achim, kai, lea].map((c) => c.close()))
  console.log(failures === 0 ? '\nAll checks passed. The room is ready.' : `\n${failures} check(s) failed.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
