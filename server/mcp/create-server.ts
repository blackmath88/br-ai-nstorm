/**
 * Transport-independent MCP server factory.
 *
 * This is the shape the v2 SDK is built around (`McpServerFactory`), and the
 * reason v0.3 refactors MCP before adding features: the v0.2 code registered
 * tools on a module-scope server and read its participant from
 * `process.env.BRAINSTORM_ACTOR_ID` at import time, so one process could serve
 * exactly one person. A factory makes the principal a parameter of the serving
 * unit, which is what lets four participants share one room.
 *
 * The factory binds no transport and performs no I/O — `serveStdio` and
 * `createMcpHandler` each call it and own their own transport concerns.
 */
import { McpServer } from '@modelcontextprotocol/server'
import type { Services } from '../container.js'
import type { ActorContext, TokenVerifier } from '../auth/actor-context.js'
import { registerTools } from './register-tools.js'

export const SERVER_INFO = { name: 'br-ai-nstorm', version: '0.3.0' } as const

/**
 * Builds a configured server for one already-resolved participant. Cheap and
 * side-effect free, so it is safe to call once per HTTP request.
 */
export function createBrainstormServer(services: Services, actor: ActorContext): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } })
  registerTools(server, services, actor)
  return server
}

/**
 * Resolves a bearer token to an actor, then builds a server for them.
 *
 * Identity is resolved here, before any tool exists — so no tool argument can
 * influence who the caller is.
 */
export async function createServerForToken(
  services: Services,
  verifier: TokenVerifier,
  token: string | undefined,
): Promise<McpServer> {
  if (!token) {
    throw new Error(
      'No participant token. Set BRAINSTORM_TOKEN (stdio) or send an Authorization: Bearer header (HTTP).',
    )
  }
  return createBrainstormServer(services, await verifier.verify(token))
}
