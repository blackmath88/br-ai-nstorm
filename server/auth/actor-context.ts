/**
 * The identity boundary.
 *
 * Every mutating application call takes an `ActorContext` as an explicit
 * argument. There is no ambient identity and no `process.env` read below the
 * entrypoints, so a caller cannot assert who they are — a request carries a
 * token, and only the server turns a token into an actor.
 *
 * `TokenVerifier` is deliberately shaped like the MCP SDK's `OAuthTokenVerifier`
 * (`verifyAccessToken(token): Promise<AuthInfo>`). Replacing the prototype
 * issuer with real OIDC means implementing this one interface against a JWKS
 * endpoint; nothing above it changes, because nothing above it sees a token.
 */
import { unauthorized } from '../domain/errors.js'

export interface ActorContext {
  actorId: string
  displayName: string
  scopes: string[]
}

export interface TokenVerifier {
  /** Resolves an opaque bearer token to an actor, or throws `unauthorized`. */
  verify(token: string): Promise<ActorContext>
}

export const SCOPE_READ = 'memory:read'
export const SCOPE_CONTRIBUTE = 'memory:contribute'
export const SCOPE_REVIEW = 'memory:review'

export const DEFAULT_SCOPES = [SCOPE_READ, SCOPE_CONTRIBUTE, SCOPE_REVIEW]

/** Extracts a bearer token from a raw `Authorization` header value. */
export function bearerToken(header: string | null | undefined): string {
  if (!header) throw unauthorized('Missing Authorization header.')
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer' || rest.length === 0) {
    throw unauthorized('Expected an "Authorization: Bearer <token>" header.')
  }
  return rest.join(' ')
}

export async function resolveActor(verifier: TokenVerifier, header: string | null | undefined): Promise<ActorContext> {
  return verifier.verify(bearerToken(header))
}

export const hasScope = (actor: ActorContext, scope: string): boolean => actor.scopes.includes(scope)
