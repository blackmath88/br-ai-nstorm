/**
 * Minimal ambient types for the one `cloudflare:workers` import this repo
 * uses, so `npm run typecheck` covers the Worker without adding
 * `@cloudflare/workers-types` as a dependency. Wrangler resolves the real
 * module at bundle time.
 */
declare module 'cloudflare:workers' {
  interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
  }
  interface DurableObjectState {
    storage: DurableObjectStorage
  }
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState
    protected env: Env
    constructor(ctx: DurableObjectState, env: Env)
  }
}
