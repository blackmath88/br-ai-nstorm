import { handleApi } from './api.js'
import { createWorkerMcpHandler, type WorkerMcpHandler } from './mcp.js'
import { buildWorkerServices, type WorkerEnv, type WorkerServices } from './services.js'

export { EventLog } from './durable-event-log.js'

let runtimePromise: Promise<{ services: WorkerServices; mcp: WorkerMcpHandler }> | undefined

// One service set and one stateless MCP handler per isolate. Both are safe to
// share across requests: every write goes through the Durable Object.
const getRuntime = (env: WorkerEnv) =>
  (runtimePromise ??= buildWorkerServices(env).then((services) => ({
    services,
    mcp: createWorkerMcpHandler(services),
  })))

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = new URL(request.url).pathname

    if (path === '/health' || path.startsWith('/api/') || path === '/api' || path.startsWith('/mcp')) {
      const { services, mcp } = await getRuntime(env)
      return handleApi(request, services, mcp)
    }

    return env.ASSETS.fetch(request)
  },
}
