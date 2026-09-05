/**
 * PROTOTYPE ISSUER — replace before any deployment.
 *
 * This file is the *only* fake part of the identity model, and that is the
 * point: what is fake is how a principal is established, not how a principal is
 * carried, verified or used. Tokens are opaque random strings held in memory.
 * There is no password, no signature and no authorization server.
 *
 * What is deliberately NOT fake, and stays when this file is deleted:
 *   - identity travels as a bearer token, never as a self-declared header;
 *   - the server resolves it, never the client;
 *   - `ActorContext` is threaded explicitly through every service call;
 *   - failures answer 401 with a `WWW-Authenticate` challenge.
 *
 * v0.2's `x-brainstorm-actor` header had no removable seam at all, because the
 * caller *was* the identity provider. This has exactly one removable file.
 */
import { randomBytes } from 'node:crypto'
import type { Participant } from '../domain/types.js'
import { unauthorized } from '../domain/errors.js'
import { DEFAULT_SCOPES, type ActorContext, type TokenVerifier } from './actor-context.js'

/** The prototype roster. Four participants so multi-party behaviour is testable. */
export const PARTICIPANTS: Participant[] = [
  { id: 'person:achim', name: 'Achim' },
  { id: 'person:kai', name: 'Kai' },
  { id: 'person:lea', name: 'Lea' },
  { id: 'person:mara', name: 'Mara' },
]

export interface PrototypeAuth extends TokenVerifier {
  /** Mints a session token for a known participant. Dev-only. */
  issue(participantId: string): { token: string; actor: ActorContext }
  /** Stable token per participant, for tests and for `BRAINSTORM_TOKEN`. */
  issueStable(participantId: string): string
  participants(): Participant[]
  revoke(token: string): void
}

export function createPrototypeAuth(options: { deterministicTokens?: boolean } = {}): PrototypeAuth {
  const tokens = new Map<string, ActorContext>()
  const stable = new Map<string, string>()

  const toActor = (participant: Participant): ActorContext => ({
    actorId: participant.id,
    displayName: participant.name,
    scopes: [...DEFAULT_SCOPES],
  })

  const find = (participantId: string): Participant => {
    const participant = PARTICIPANTS.find((p) => p.id === participantId || p.name.toLowerCase() === participantId.toLowerCase())
    if (!participant) throw unauthorized(`Unknown participant "${participantId}".`)
    return participant
  }

  const mint = (participant: Participant): string =>
    options.deterministicTokens
      ? `dev-${participant.id.replace('person:', '')}`
      : randomBytes(24).toString('base64url')

  return {
    issue(participantId) {
      const participant = find(participantId)
      const actor = toActor(participant)
      const token = mint(participant)
      tokens.set(token, actor)
      return { token, actor }
    },

    issueStable(participantId) {
      const participant = find(participantId)
      const existing = stable.get(participant.id)
      if (existing) return existing
      const token = mint(participant)
      tokens.set(token, toActor(participant))
      stable.set(participant.id, token)
      return token
    },

    async verify(token) {
      const actor = tokens.get(token)
      if (!actor) throw unauthorized('Unknown or expired session token.')
      return actor
    },

    participants: () => [...PARTICIPANTS],
    revoke: (token) => void tokens.delete(token),
  }
}
