import { invalid } from '../server/domain/errors.js'
import { CORS, MAX_BODY_BYTES, parseJsonObject, route } from '../server/http/routes.js'
import type { WorkerServices } from './services.js'

/**
 * HTTP adapter for the Cloudflare Worker: the Fetch-API twin of
 * `server/http/api.ts`. Both call the same router, so a route exists on both
 * runtimes or on neither. The demo always enables the participant switcher;
 * its tokens are labels, not credentials (see demo-auth.ts).
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw invalid('Request body is too large.')
  // content-length can be absent (chunked); parseJsonObject checks what arrived.
  return parseJsonObject(await request.text())
}

export async function handleApi(
  request: Request,
  services: WorkerServices,
  mcp?: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(request.url)
  if (url.pathname === '/mcp' && mcp) return mcp(request)

  const answer = await route(
    services,
    {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      authorization: request.headers.get('authorization') ?? undefined,
      body: () => readBody(request),
    },
    {
      prototypeAuth: true,
      health: { runtime: 'cloudflare-worker', persistence: 'durable-object', mcp: '/mcp' },
    },
  )
  return Response.json(answer.body, { status: answer.status, headers: { ...CORS, ...answer.headers } })
}
