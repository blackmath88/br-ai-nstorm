/**
 * HTTP adapter for Node.
 *
 * Turns a Node request into a `RouteRequest`, calls the shared router
 * (`routes.ts`) and writes the answer back. The routing table, the actor
 * resolution and the error mapping live there, shared with the Cloudflare
 * Worker; this file only knows Node's request and response objects.
 *
 * v0.2's `x-brainstorm-actor` header is removed rather than deprecated. Leaving
 * it would leave a path where the caller asserts its own identity.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Services } from '../container.js'
import { invalid } from '../domain/errors.js'
import { CORS, MAX_BODY_BYTES, parseJsonObject, route } from './routes.js'

export interface ApiOptions {
  /**
   * Enables `POST /api/auth/session` and `GET /api/participants`. This is the
   * prototype login stub; it must be off in anything resembling a deployment.
   */
  enablePrototypeAuth: boolean
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    // Stop reading early rather than buffering an oversized body.
    if (size > MAX_BODY_BYTES) throw invalid('Request body is too large.')
    chunks.push(chunk as Buffer)
  }
  return parseJsonObject(Buffer.concat(chunks).toString('utf8'))
}

export function createApi(services: Services, options: ApiOptions): ApiHandler {
  return async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const answer = await route(
      services,
      {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        authorization: req.headers.authorization,
        body: () => readBody(req),
      },
      { prototypeAuth: options.enablePrototypeAuth },
    )
    res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...answer.headers })
    res.end(JSON.stringify(answer.body, null, 2))
  }
}
