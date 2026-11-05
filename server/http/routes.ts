/**
 * The REST surface, independent of runtime.
 *
 * Node (`server/http/api.ts`) and the Cloudflare Worker (`worker/api.ts`) used
 * to carry two copies of this routing table, which had already begun to drift.
 * Each adapter now only turns its request into a `RouteRequest`, calls
 * `route`, and writes the `RouteResponse` back. A route exists on both
 * runtimes or on neither.
 *
 * Its whole job is the adapter's old job: resolve an actor from the bearer
 * token, call exactly one application method, map domain errors to status
 * codes. No domain logic.
 */
import type { ActorContext } from '../auth/actor-context.js'
import { resolveActor, type TokenVerifier } from '../auth/actor-context.js'
import { CONFLICT_KIND_MEANING } from '../domain/conflicts.js'
import { DomainError, invalid, isDomainError } from '../domain/errors.js'
import type { ContributionKind, ContributionSource, Participant } from '../domain/types.js'
import type { ToolServices } from '../mcp/register-tools.js'
import type { ImportService } from '../application/import-service.js'
import type { ReportService } from '../application/report-service.js'
import type { Curator } from '../curation/ai-curator.js'

export interface RouteServices extends ToolServices {
  imports: ImportService
  reports: ReportService
  curator: Pick<Curator, 'enabled' | 'name'>
  auth: TokenVerifier & {
    participants(): Participant[]
    issue(participantId: string): { token: string; actor: ActorContext }
  }
}

export interface RouteRequest {
  method: string
  path: string
  query: URLSearchParams
  authorization: string | undefined
  /** Lazily parsed; only routes that take a body call it. */
  body: () => Promise<Record<string, unknown>>
}

export interface RouteResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface RouteOptions {
  /** Enables the prototype roster and login stub. Off in anything resembling a deployment. */
  prototypeAuth: boolean
  /** Runtime-specific fields for `/health`. */
  health?: Record<string, unknown>
}

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '600',
}

/**
 * Above the largest legitimate body: an import bundle is capped at 2 Mi
 * characters of source (`MAX_IMPORT_TOTAL_CHARS`), which is at most ~12 MiB
 * once UTF-8 encoded and JSON-escaped, even for non-Latin text.
 */
export const MAX_BODY_BYTES = 16 * 1024 * 1024

const STATUS: Record<DomainError['code'], number> = {
  not_found: 404,
  invalid: 422,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
}

/** Shared by both adapters once they hold the raw body text. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  if (raw.length > MAX_BODY_BYTES) throw invalid('Request body is too large.')
  if (!raw.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw invalid('Request body is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid('Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

const str = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`"${field}" must be a non-empty string.`)
  return value
}

const optionalStr = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : str(value, field)

const ok = (body: unknown, status = 200): RouteResponse => ({ status, body })

const PROBLEM = /^\/api\/problems\/([^/]+)(?:\/([^/]+))?$/
const PROBLEM_OBJECT = /^\/api\/problems\/([^/]+)\/(conflicts|contributions)\/([^/]+)\/(resolve|supersede)$/
const CURATION = /^\/api\/curation\/([^/]+)\/(accept|reject)$/

export async function route(services: RouteServices, req: RouteRequest, options: RouteOptions): Promise<RouteResponse> {
  const { method, path, query } = req
  const actor = () => resolveActor(services.auth, req.authorization)

  try {
    if (method === 'GET' && path === '/health') {
      return ok({
        ok: true,
        aiCurator: services.curator.enabled,
        curator: services.curator.name,
        prototypeAuth: options.prototypeAuth,
        orchestration: services.orchestration.options(),
        ...options.health,
      })
    }

    // --- prototype auth (dev / demo only) ---------------------------------
    if (options.prototypeAuth && method === 'GET' && path === '/api/participants') {
      return ok({ participants: services.auth.participants() })
    }
    if (options.prototypeAuth && method === 'POST' && path === '/api/auth/session') {
      const body = await req.body()
      return ok(services.auth.issue(str(body.participantId, 'participantId')), 201)
    }

    // --- everything below requires a resolved actor -----------------------
    if (method === 'GET' && path === '/api/problems') {
      await actor()
      return ok({ problems: await services.problems.list() })
    }
    if (method === 'GET' && path === '/api/conflict-types') {
      await actor()
      return ok({ conflictTypes: CONFLICT_KIND_MEANING })
    }
    if (method === 'POST' && (path === '/api/imports' || path === '/api/imports/preview')) {
      const who = await actor()
      const body = await req.body()
      return path.endsWith('/preview')
        ? ok(await services.imports.preview(who, body))
        : ok(await services.imports.apply(who, body), 201)
    }

    const objectMatch = PROBLEM_OBJECT.exec(path)
    if (objectMatch && method === 'POST') {
      const who = await actor()
      const problemId = decodeURIComponent(objectMatch[1])
      const objectId = decodeURIComponent(objectMatch[3])
      const body = await req.body()
      if (objectMatch[2] === 'conflicts' && objectMatch[4] === 'resolve') {
        const conflict = await services.curation.resolveConflict(who, {
          problemId,
          conflictId: objectId,
          action: body.action,
          note: body.note,
        })
        return ok({ conflict })
      }
      if (objectMatch[2] === 'contributions' && objectMatch[4] === 'supersede') {
        const reason = optionalStr(body.reason, 'reason')
        const contribution = await services.contributions.supersede(who, {
          problemId,
          contributionId: objectId,
          supersededBy: str(body.supersededBy, 'supersededBy'),
          ...(reason ? { reason } : {}),
        })
        return ok({ contribution })
      }
    }

    const problemMatch = PROBLEM.exec(path)
    if (problemMatch) {
      const problemId = decodeURIComponent(problemMatch[1])
      const section = problemMatch[2]
      const who = await actor()

      if (method === 'GET') {
        switch (section) {
          case undefined:
            return query.get('detail') === 'compact'
              ? ok({ ...(await services.problems.getCompactState(problemId)), viewer: who })
              : ok({ ...(await services.problems.getState(problemId)), viewer: who })
          case 'version':
            return ok(await services.problems.getVersion(problemId))
          case 'updates':
            return ok(await services.problems.getUpdates(problemId, who, query.get('since') ?? undefined))
          case 'conflicts':
            return ok(await services.problems.getConflicts(problemId))
          case 'curation': {
            const status = query.get('status') as 'pending' | 'accepted' | 'rejected' | null
            return ok({ proposals: await services.curation.list(problemId, status ? { status } : undefined) })
          }
          case 'events':
            return ok({ events: await services.problems.getEvents(problemId) })
          case 'mine':
            return ok({ contributions: await services.problems.getMyContributions(problemId, who) })
          case 'orchestration':
            return ok(await services.orchestration.get(problemId))
          case 'context':
            return ok(await services.orchestration.context(problemId, query.get('draft') ?? ''))
          case 'report':
            return ok(await services.reports.fieldReport(problemId))
        }
      }

      if (method === 'POST') {
        const body = await req.body()
        switch (section) {
          case 'orchestration': {
            const reason = optionalStr(body.reason, 'reason')
            const orchestration = await services.orchestration.setMode(who, {
              problemId,
              mode: body.mode,
              ...(reason ? { reason } : {}),
            })
            return ok({ orchestration, options: services.orchestration.options() })
          }
          case 'contributions': {
            const kind = optionalStr(body.kind, 'kind')
            const source = optionalStr(body.source, 'source')
            const sourceDetail = optionalStr(body.sourceDetail, 'sourceDetail')
            const preparedBy = optionalStr(body.preparedBy, 'preparedBy')
            const result = await services.contributions.add(who, {
              problemId,
              content: str(body.content, 'content'),
              ...(kind ? { kind: kind as ContributionKind } : {}),
              ...(source ? { source: source as ContributionSource } : {}),
              ...(sourceDetail ? { sourceDetail } : {}),
              ...(preparedBy ? { preparedBy } : {}),
              ...(body.proposals !== undefined ? { proposals: body.proposals } : {}),
            })
            return ok(result, 201)
          }
          case 'evaluations': {
            const evaluation = await services.contributions.evaluate(who, {
              problemId,
              targetId: str(body.targetId, 'targetId'),
              stance: body.stance,
              note: body.note,
            })
            return ok({ evaluation }, 201)
          }
        }
      }
    }

    const curationMatch = CURATION.exec(path)
    if (curationMatch && method === 'POST') {
      const who = await actor()
      const proposalId = decodeURIComponent(curationMatch[1])
      const body = await req.body()
      const problemId = str(body.problemId, 'problemId')
      const reason = optionalStr(body.reason, 'reason')
      return ok(
        curationMatch[2] === 'accept'
          ? await services.curation.accept(who, { problemId, proposalId })
          : await services.curation.reject(who, { problemId, proposalId, ...(reason ? { reason } : {}) }),
      )
    }

    return { status: 404, body: { error: 'not_found', message: `No route for ${method} ${path}.` } }
  } catch (error) {
    if (isDomainError(error)) {
      return {
        status: STATUS[error.code],
        body: { error: error.code, message: error.message, detail: error.detail },
        ...(error.code === 'unauthorized'
          ? { headers: { 'www-authenticate': 'Bearer realm="br-ai-nstorm", error="invalid_token"' } }
          : {}),
      }
    }
    // Never leak an unexpected error's message to the client.
    console.error('[br-ai-nstorm] unhandled API error:', error)
    return { status: 500, body: { error: 'internal_error', message: 'Unexpected server error.' } }
  }
}
