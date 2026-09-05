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
import { createMcpHandler, type AuthInfo, type McpServerFactory } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import type { Services } from '../container.js'
import { bearerToken } from '../auth/actor-context.js'
import { isDomainError } from '../domain/errors.js'
import { createBrainstormServer } from './create-server.js'

const UNAUTHORIZED = {
  jsonrpc: '2.0' as const,
  error: { code: -32001, message: 'Unauthorized: send Authorization: Bearer <session token>.' },
  id: null,
}

export function createMcpNodeHandler(services: Services) {
  const factory: McpServerFactory = (ctx) => {
    const actorId = ctx.authInfo?.extra?.actorId
    const displayName = ctx.authInfo?.extra?.displayName
    if (typeof actorId !== 'string') {
      // Unreachable via the gate below; a guard rather than a fallback, because
      // an anonymous default here would silently forge attribution.
      throw new Error('MCP request reached the factory without a resolved actor.')
    }
    return createBrainstormServer(services, {
      actorId,
      displayName: typeof displayName === 'string' ? displayName : actorId,
      scopes: ctx.authInfo?.scopes ?? [],
    })
  }

  const handler = createMcpHandler(factory, {
    onerror: (error) => console.error('[br-ai-nstorm] MCP HTTP error:', error),
  })
  const node = toNodeHandler(handler)

  return async function handle(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    let authInfo: AuthInfo
    try {
      const token = bearerToken(req.headers.authorization)
      const actor = await services.auth.verify(token)
      authInfo = {
        token,
        clientId: actor.actorId,
        scopes: actor.scopes,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { actorId: actor.actorId, displayName: actor.displayName },
      }
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
