/**
 * Typed domain errors. The domain raises these; each adapter maps them to its
 * own vocabulary (HTTP status codes, MCP `isError` results). Nothing in the
 * domain knows what an HTTP status code is.
 */
export type DomainErrorCode = 'not_found' | 'invalid' | 'unauthorized' | 'forbidden' | 'conflict'

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const notFound = (what: string, id: string) =>
  new DomainError('not_found', `${what} not found`, { id })

export const invalid = (message: string, detail?: Record<string, unknown>) =>
  new DomainError('invalid', message, detail)

export const unauthorized = (message = 'Authentication required.') =>
  new DomainError('unauthorized', message)

export const forbidden = (message: string, detail?: Record<string, unknown>) =>
  new DomainError('forbidden', message, detail)

export const conflictError = (message: string, detail?: Record<string, unknown>) =>
  new DomainError('conflict', message, detail)

export const isDomainError = (value: unknown): value is DomainError =>
  value instanceof DomainError
