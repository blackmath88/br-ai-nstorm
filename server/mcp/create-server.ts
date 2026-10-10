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
import { McpServer, type AuthInfo, type McpServerFactory } from '@modelcontextprotocol/server'
import type { ActorContext, TokenVerifier } from '../auth/actor-context.js'
import { registerTools, type ToolServices } from './register-tools.js'

export const SERVER_INFO = { name: 'br-ai-nstorm', version: '0.4.0' } as const

/**
 * Builds a configured server for one already-resolved participant. Cheap and
 * side-effect free, so it is safe to call once per HTTP request.
 */
export function createBrainstormServer(services: ToolServices, actor: ActorContext): McpServer {
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
  services: ToolServices,
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

/** The `AuthInfo` an HTTP gate hands the SDK once it has verified a bearer token. */
export function authInfoFor(token: string, actor: ActorContext, now = Date.now()): AuthInfo {
  return {
    token,
    clientId: actor.actorId,
    scopes: actor.scopes,
    expiresAt: Math.floor(now / 1000) + 3600,
    extra: { actorId: actor.actorId, displayName: actor.displayName },
  }
}

/**
 * The factory both HTTP runtimes (Node and the Cloudflare Worker) hand to
 * `createMcpHandler`. The actor comes from verified `authInfo` and from
 * nowhere else.
 */
export function createActorServerFactory(services: ToolServices): McpServerFactory {
  return (ctx) => {
    const actorId = ctx.authInfo?.extra?.actorId
    const displayName = ctx.authInfo?.extra?.displayName
    if (typeof actorId !== 'string') {
      // Unreachable behind a bearer gate; a guard rather than a fallback,
      // because an anonymous default here would silently forge attribution.
      throw new Error('MCP request reached the factory without a resolved actor.')
    }
    return createBrainstormServer(services, {
      actorId,
      displayName: typeof displayName === 'string' ? displayName : actorId,
      scopes: ctx.authInfo?.scopes ?? [],
    })
  }
}
