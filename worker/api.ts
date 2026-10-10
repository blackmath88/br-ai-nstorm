import type { ActorContext } from '../server/auth/actor-context.js'
import { resolveActor } from '../server/auth/actor-context.js'
import { CONFLICT_KIND_MEANING } from '../server/domain/conflicts.js'
import { DomainError, invalid, isDomainError } from '../server/domain/errors.js'
import type { ContributionKind, ContributionSource } from '../server/domain/types.js'
import type { WorkerServices } from './services.js'

const STATUS: Record<DomainError['code'], number> = {
  not_found: 404,
  invalid: 422,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '600',
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: { ...CORS, ...headers },
  })

/** Same ceiling as the Node adapter (see MAX_BODY_BYTES in server/http/api.ts). */
const MAX_BODY_BYTES = 16 * 1024 * 1024

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw invalid('Request body is too large.')
  const raw = await request.text()
  // content-length can be absent (chunked); check what actually arrived too.
  if (raw.length > MAX_BODY_BYTES) throw invalid('Request body is too large.')
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalid('Request body must be a JSON object.')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (isDomainError(error)) throw error
    throw invalid('Request body is not valid JSON.')
  }
}

const str = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`"${field}" must be a non-empty string.`)
  }
  return value
}

const optionalStr = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : str(value, field)

export async function handleApi(
  request: Request,
  services: WorkerServices,
  mcp?: (request: Request) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  const withActor = async (): Promise<ActorContext> =>
    resolveActor(services.auth, request.headers.get('authorization') ?? undefined)

  try {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    if (method === 'GET' && path === '/health') {
      return json(200, {
        ok: true,
        runtime: 'cloudflare-worker',
        persistence: 'durable-object',
        aiCurator: services.curator.enabled,
        curator: services.curator.name,
        mcp: '/mcp',
        prototypeAuth: true,
        orchestration: services.orchestration.options(),
      })
    }

    // Public demo-only participant switcher. These are not real credentials.
    if (method === 'GET' && path === '/api/participants') {
      return json(200, { participants: services.auth.participants() })
    }

    if (method === 'POST' && path === '/api/auth/session') {
      const body = await readJson(request)
      const { token, actor } = services.auth.issue(str(body.participantId, 'participantId'))
      return json(201, { token, actor })
    }

    if (method === 'GET' && path === '/api/problems') {
      await withActor()
      return json(200, { problems: await services.problems.list() })
    }

    if (method === 'GET' && path === '/api/conflict-types') {
      await withActor()
      return json(200, { conflictTypes: CONFLICT_KIND_MEANING })
    }

    if (method === 'POST' && (path === '/api/imports' || path === '/api/imports/preview')) {
      const actor = await withActor()
      const body = await readJson(request)
      return path.endsWith('/preview')
        ? json(200, await services.imports.preview(actor, body))
        : json(201, await services.imports.apply(actor, body))
    }

    const problemMatch = /^\/api\/problems\/([^/]+)(?:\/([^/]+))?$/.exec(path)
    if (problemMatch) {
      const problemId = decodeURIComponent(problemMatch[1])
      const section = problemMatch[2]
      const actor = await withActor()

      if (method === 'GET' && !section) {
        if (url.searchParams.get('detail') === 'compact') {
          return json(200, { ...(await services.problems.getCompactState(problemId)), viewer: actor })
        }
        return json(200, { ...(await services.problems.getState(problemId)), viewer: actor })
      }
      if (method === 'GET' && section === 'updates') {
        const since = url.searchParams.get('since') ?? undefined
        return json(200, await services.problems.getUpdates(problemId, actor, since))
      }
      if (method === 'GET' && section === 'conflicts') {
        return json(200, await services.problems.getConflicts(problemId))
      }
      if (method === 'GET' && section === 'curation') {
        const status = url.searchParams.get('status') as 'pending' | 'accepted' | 'rejected' | null
        return json(200, {
          proposals: await services.curation.list(problemId, status ? { status } : undefined),
        })
      }
      if (method === 'GET' && section === 'events') {
        return json(200, { events: await services.problems.getEvents(problemId) })
      }
      if (method === 'GET' && section === 'mine') {
        return json(200, {
          contributions: await services.problems.getMyContributions(problemId, actor),
        })
      }
      if (method === 'GET' && section === 'orchestration') {
        return json(200, await services.orchestration.get(problemId))
      }
      if (method === 'POST' && section === 'orchestration') {
        const body = await readJson(request)
        const reason = optionalStr(body.reason, 'reason')
        const orchestration = await services.orchestration.setMode(actor, {
          problemId,
          mode: body.mode,
          ...(reason ? { reason } : {}),
        })
        return json(200, { orchestration, options: services.orchestration.options() })
      }
      if (method === 'GET' && section === 'context') {
        return json(200, await services.orchestration.context(problemId, url.searchParams.get('draft') ?? ''))
      }
      if (method === 'POST' && section === 'contributions') {
        const body = await readJson(request)
        const kind = optionalStr(body.kind, 'kind')
        const source = optionalStr(body.source, 'source')
        const sourceDetail = optionalStr(body.sourceDetail, 'sourceDetail')
        const preparedBy = optionalStr(body.preparedBy, 'preparedBy')
        const result = await services.contributions.add(actor, {
          problemId,
          content: str(body.content, 'content'),
          ...(kind ? { kind: kind as ContributionKind } : {}),
          ...(source ? { source: source as ContributionSource } : {}),
          ...(sourceDetail ? { sourceDetail } : {}),
          ...(preparedBy ? { preparedBy } : {}),
          ...(body.proposals !== undefined ? { proposals: body.proposals } : {}),
        })
        return json(201, result)
      }
    }

    const curationMatch = /^\/api\/curation\/([^/]+)\/(accept|reject)$/.exec(path)
    if (curationMatch && method === 'POST') {
      const actor = await withActor()
      const proposalId = decodeURIComponent(curationMatch[1])
      const body = await readJson(request)
      const problemId = str(body.problemId, 'problemId')
      const reason = optionalStr(body.reason, 'reason')
      const result =
        curationMatch[2] === 'accept'
          ? await services.curation.accept(actor, { problemId, proposalId })
          : await services.curation.reject(actor, {
              problemId,
              proposalId,
              ...(reason ? { reason } : {}),
            })
      return json(200, result)
    }

    if (path === '/mcp' && mcp) {
      return await mcp(request)
    }

    return json(404, { error: 'not_found', message: `No route for ${method} ${path}.` })
  } catch (error) {
    if (isDomainError(error)) {
      const headers =
        error.code === 'unauthorized'
          ? { 'www-authenticate': 'Bearer realm="br-ai-nstorm", error="invalid_token"' }
          : {}
      return json(STATUS[error.code], { error: error.code, message: error.message, detail: error.detail }, headers)
    }
    console.error('[br-ai-nstorm] unhandled Worker API error:', error)
    return json(500, { error: 'internal_error', message: 'Unexpected server error.' })
  }
}
