/**
 * MCP over stateless Streamable HTTP, on the Cloudflare Worker.
 *
 * Same factory, same tool registration and same bearer gate as the Node
 * runtime (`server/mcp/http.ts`) — only the transport face differs: the SDK's
 * `createMcpHandler` is fetch-shaped, so the Worker hands it the `Request`
 * directly instead of going through a Node adapter.
 *
 * No Durable Object of its own and no `McpAgent`: the handler is stateless per
 * request, and the room's state already lives in the event-log Durable Object.
 * Cloudflare's current guidance recommends exactly this shape for new remote
 * MCP servers. In workerd, the SDK's export conditions swap in a JSON-schema
 * validator that does not need `eval`, so no extra wiring is required.
 */
import { createMcpHandler } from '@modelcontextprotocol/server'
import { bearerToken } from '../server/auth/actor-context.js'
import { isDomainError } from '../server/domain/errors.js'
import { authInfoFor, createActorServerFactory } from '../server/mcp/create-server.js'
import type { WorkerServices } from './services.js'

const UNAUTHORIZED = {
  jsonrpc: '2.0' as const,
  error: { code: -32001, message: 'Unauthorized: send Authorization: Bearer <demo token>.' },
  id: null,
}

export type WorkerMcpHandler = (request: Request) => Promise<Response>

export function createWorkerMcpHandler(services: WorkerServices): WorkerMcpHandler {
  const handler = createMcpHandler(createActorServerFactory(services), {
    onerror: (error) => console.error('[br-ai-nstorm] MCP Worker error:', error),
  })

  return async (request) => {
    let token: string
    let actor
    try {
      token = bearerToken(request.headers.get('authorization') ?? undefined)
      actor = await services.auth.verify(token)
    } catch (error) {
      if (!isDomainError(error)) throw error
      return Response.json(UNAUTHORIZED, {
        status: 401,
        headers: { 'www-authenticate': 'Bearer realm="br-ai-nstorm", error="invalid_token"' },
      })
    }
    return handler.fetch(request, { authInfo: authInfoFor(token, actor) })
  }
}
