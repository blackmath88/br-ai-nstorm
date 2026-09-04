/**
 * MCP over stdio.
 *
 * `serveStdio` takes the same factory the HTTP entry takes, so the two can
 * never drift apart in what they expose.
 *
 * stdout is the JSON-RPC channel: every diagnostic here goes to stderr, and no
 * server code below this file writes to stdout.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { buildServices } from '../container.js'
import { createServerForToken } from './create-server.js'

async function main(): Promise<void> {
  const services = await buildServices()

  // Prototype convenience: BRAINSTORM_PARTICIPANT mints a stable dev token so a
  // local MCP client can be pointed at a participant without a login round-trip.
  // BRAINSTORM_TOKEN is the real path — an opaque token the server issued.
  const participant = process.env.BRAINSTORM_PARTICIPANT
  const token = process.env.BRAINSTORM_TOKEN ?? (participant ? services.auth.issueStable(participant) : undefined)

  if (!token) {
    console.error(
      'br-ai-nstorm MCP: set BRAINSTORM_TOKEN=<session token> or BRAINSTORM_PARTICIPANT=<Achim|Kai|Lea|Mara>.',
    )
    process.exit(1)
  }

  const actor = await services.auth.verify(token)
  console.error(`br-ai-nstorm MCP ready · participant=${actor.displayName} (${actor.actorId})`)

  serveStdio(() => createServerForToken(services, services.auth, token), {
    onerror: (error) => console.error('[br-ai-nstorm] MCP stdio error:', error),
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
