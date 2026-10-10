/**
 * MCP over stateless Streamable HTTP.
 *
 * `createMcpHandler` runs the factory fresh per request (2026-07-28 revision:
 * no session id, no initialize handshake) and answers 2025-era clients through
 * its own stateless fallback, so no dual-transport wiring is needed.
 *
 * Auth here is the same bearer gate the REST API uses, and the verified actor
 * reaches the factory as `ctx.authInfo` — the SDK's documented hook for
 * "multi-tenant servers keyed off authInfo".
 *
 * Exported as a handler rather than a listener: `server/http/server.ts` mounts
 * it alongside the REST API on one port.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { Services } from '../container.js'
import { bearerToken } from '../auth/actor-context.js'
import { isDomainError } from '../domain/errors.js'
import { authInfoFor, createActorServerFactory } from './create-server.js'

const UNAUTHORIZED = {
  jsonrpc: '2.0' as const,
  error: { code: -32001, message: 'Unauthorized: send Authorization: Bearer <session token>.' },
  id: null,
}

export function createMcpNodeHandler(services: Services) {
  const handler = createMcpHandler(createActorServerFactory(services), {
    onerror: (error) => console.error('[br-ai-nstorm] MCP HTTP error:', error),
  })
  const node = toNodeHandler(handler)

  return async function handle(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    let authInfo: AuthInfo
    try {
      const token = bearerToken(req.headers.authorization)
      authInfo = authInfoFor(token, await services.auth.verify(token))
    } catch (error) {
      if (!isDomainError(error)) throw error
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="br-ai-nstorm", error="invalid_token"',
      })
      res.end(JSON.stringify(UNAUTHORIZED))
      return
    }

    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo
    // `toNodeHandler` types `method`/`url` as required; `IncomingMessage` types
    // them as optional. Same runtime object, narrower declaration.
    await node(req as Parameters<typeof node>[0], res, body)
  }
}
