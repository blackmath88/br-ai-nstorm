/**
 * HTTP adapter.
 *
 * Its whole job: parse a request, resolve an actor from the bearer token, call
 * exactly one application method, map domain errors to status codes, serialise
 * JSON. It contains no domain logic, and the services it calls cannot tell that
 * an HTTP request happened.
 *
 * v0.2's `x-brainstorm-actor` header is removed rather than deprecated. Leaving
 * it would leave a path where the caller asserts its own identity.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Services } from '../container.js'
import { DomainError, isDomainError, invalid } from '../domain/errors.js'
import { resolveActor, type ActorContext } from '../auth/actor-context.js'
import { CONFLICT_KIND_MEANING } from '../domain/conflicts.js'
import type { ContributionKind, ContributionSource } from '../domain/types.js'

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

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers })
  res.end(JSON.stringify(body, null, 2))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
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
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`"${field}" must be a non-empty string.`)
  return value
}

const optionalStr = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : str(value, field)

export interface ApiOptions {
  /**
   * Enables `POST /api/auth/session` and `GET /api/participants`. This is the
   * prototype login stub; it must be off in anything resembling a deployment.
   */
  enablePrototypeAuth: boolean
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function createApi(services: Services, options: ApiOptions): ApiHandler {
  const withActor = async (req: IncomingMessage): Promise<ActorContext> =>
    resolveActor(services.auth, req.headers.authorization)

  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (method === 'OPTIONS') {
        res.writeHead(204, CORS)
        res.end()
        return
      }

      if (method === 'GET' && path === '/health') {
        return send(res, 200, {
          ok: true,
          aiCurator: services.curator.enabled,
          curator: services.curator.name,
          prototypeAuth: options.enablePrototypeAuth,
        })
      }

      // --- prototype auth (dev only) -------------------------------------
      if (options.enablePrototypeAuth && method === 'GET' && path === '/api/participants') {
        return send(res, 200, { participants: services.auth.participants() })
      }

      if (options.enablePrototypeAuth && method === 'POST' && path === '/api/auth/session') {
        const body = await readJson(req)
        const { token, actor } = services.auth.issue(str(body.participantId, 'participantId'))
        return send(res, 201, { token, actor })
      }

      // --- everything below requires a resolved actor ---------------------
      if (method === 'GET' && path === '/api/problems') {
        await withActor(req)
        return send(res, 200, { problems: await services.problems.list() })
      }

      if (method === 'GET' && path === '/api/conflict-types') {
        await withActor(req)
        return send(res, 200, { conflictTypes: CONFLICT_KIND_MEANING })
      }

      const problemMatch = /^\/api\/problems\/([^/]+)(?:\/([^/]+))?$/.exec(path)
      if (problemMatch) {
        const problemId = decodeURIComponent(problemMatch[1])
        const section = problemMatch[2]
        const actor = await withActor(req)

        if (method === 'GET' && !section) {
          return send(res, 200, {
            ...(await services.problems.getState(problemId)),
            viewer: actor,
          })
        }
        if (method === 'GET' && section === 'updates') {
          const since = url.searchParams.get('since') ?? undefined
          return send(res, 200, await services.problems.getUpdates(problemId, actor, since))
        }
        if (method === 'GET' && section === 'conflicts') {
          return send(res, 200, await services.problems.getConflicts(problemId))
        }
        if (method === 'GET' && section === 'curation') {
          const status = url.searchParams.get('status') as 'pending' | 'accepted' | 'rejected' | null
          return send(res, 200, {
            proposals: await services.curation.list(problemId, status ? { status } : undefined),
          })
        }
        if (method === 'GET' && section === 'events') {
          return send(res, 200, { events: await services.problems.getEvents(problemId) })
        }
        if (method === 'GET' && section === 'mine') {
          return send(res, 200, {
            contributions: await services.problems.getMyContributions(problemId, actor),
          })
        }
        if (method === 'POST' && section === 'contributions') {
          const body = await readJson(req)
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
          })
          return send(res, 201, result)
        }
      }

      const curationMatch = /^\/api\/curation\/([^/]+)\/(accept|reject)$/.exec(path)
      if (curationMatch && method === 'POST') {
        const actor = await withActor(req)
        const proposalId = decodeURIComponent(curationMatch[1])
        const body = await readJson(req)
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
        return send(res, 200, result)
      }

      return send(res, 404, { error: 'not_found', message: `No route for ${method} ${path}.` })
    } catch (error) {
      if (isDomainError(error)) {
        const headers =
          error.code === 'unauthorized'
            ? { 'www-authenticate': 'Bearer realm="br-ai-nstorm", error="invalid_token"' }
            : {}
        return send(res, STATUS[error.code], { error: error.code, message: error.message, detail: error.detail }, headers)
      }
      // Never leak an unexpected error's message to the client.
      console.error('[br-ai-nstorm] unhandled API error:', error)
      return send(res, 500, { error: 'internal_error', message: 'Unexpected server error.' })
    }
  }
}
