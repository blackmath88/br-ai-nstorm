import { handleApi } from './api.js'
import { buildWorkerServices, type WorkerEnv, type WorkerServices } from './services.js'

export { EventLog } from './durable-event-log.js'

let servicesPromise: Promise<WorkerServices> | undefined

const getServices = (env: WorkerEnv) => (servicesPromise ??= buildWorkerServices(env))

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = new URL(request.url).pathname

    if (path === '/health' || path.startsWith('/api/') || path === '/api' || path.startsWith('/mcp')) {
      return handleApi(request, await getServices(env))
    }

    return env.ASSETS.fetch(request)
  },
}
