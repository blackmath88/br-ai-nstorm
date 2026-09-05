/**
 * The dev server: REST API and MCP-over-HTTP on one port.
 *
 * Both mount the same `Services` instance, so a contribution made through the
 * REST API is visible to an MCP client on the next call without any
 * synchronisation — they are literally the same objects in the same process.
 */
import { createServer } from 'node:http'
import { buildServices } from '../container.js'
import { createApi } from './api.js'
import { createMcpNodeHandler } from '../mcp/http.js'

const port = Number(process.env.PORT ?? 8787)

// The prototype login stub is on by default for local development and must be
// explicitly disabled anywhere else. See docs/architecture/ADR-003 §9.
const enablePrototypeAuth = process.env.BRAINSTORM_PROTOTYPE_AUTH !== 'off'

async function main(): Promise<void> {
  const services = await buildServices()
  const api = createApi(services, { enablePrototypeAuth })
  const mcp = createMcpNodeHandler(services)

  createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const route = path === '/mcp' ? mcp(req, res) : api(req, res)
    route.catch((error) => {
      console.error('[br-ai-nstorm] unhandled request error:', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal_error' }))
      }
    })
  }).listen(port, () => {
    console.log(`br-ai-nstorm API   http://localhost:${port}/api`)
    console.log(`br-ai-nstorm MCP   http://localhost:${port}/mcp`)
    if (enablePrototypeAuth) {
      console.log('prototype auth ON — POST /api/auth/session { participantId } to get a token.')
    }
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
