/**
 * Minimal ambient types for the one `cloudflare:workers` import this repo
 * uses, so `npm run typecheck` covers the Worker without adding
 * `@cloudflare/workers-types` as a dependency. Wrangler resolves the real
 * module at bundle time; tests alias it to `server/test/support/cloudflare-workers.ts`.
 */
declare module 'cloudflare:workers' {
  interface DurableObjectStorageOps {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    put<T>(entries: Record<string, T>): Promise<void>
    delete(key: string): Promise<boolean>
    list<T>(options?: { prefix?: string }): Promise<Map<string, T>>
  }
  interface DurableObjectStorage extends DurableObjectStorageOps {
    transaction<T>(closure: (txn: DurableObjectStorageOps) => Promise<T>): Promise<T>
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
