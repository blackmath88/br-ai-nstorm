import type { Participant } from '../server/domain/types.js'
import { unauthorized } from '../server/domain/errors.js'
import { DEFAULT_SCOPES, type ActorContext, type TokenVerifier } from '../server/auth/actor-context.js'

const PARTICIPANTS: Participant[] = [
  { id: 'person:achim', name: 'Achim' },
  { id: 'person:kai', name: 'Kai' },
  { id: 'person:lea', name: 'Lea' },
  { id: 'person:mara', name: 'Mara' },
]

export interface DemoAuth extends TokenVerifier {
  issue(participantId: string): { token: string; actor: ActorContext }
  participants(): Participant[]
}

/**
 * Stateless prototype auth for the public Cloudflare demo.
 *
 * Tokens are intentionally predictable and are NOT authentication. They exist
 * only so the deployed prototype can exercise the permanent ActorContext /
 * bearer-token boundary without sessions disappearing when a Worker isolate is
 * recycled. Replace this adapter with OIDC before using real identities/data.
 */
export function createDemoAuth(): DemoAuth {
  const find = (participantId: string): Participant => {
    const participant = PARTICIPANTS.find(
      (item) => item.id === participantId || item.name.toLowerCase() === participantId.toLowerCase(),
    )
    if (!participant) throw unauthorized(`Unknown participant "${participantId}".`)
    return participant
  }

  const actorFor = (participant: Participant): ActorContext => ({
    actorId: participant.id,
    displayName: participant.name,
    scopes: [...DEFAULT_SCOPES],
  })

  const tokenFor = (participant: Participant) => `demo-${participant.id.replace('person:', '')}`

  return {
    issue(participantId) {
      const participant = find(participantId)
      return { token: tokenFor(participant), actor: actorFor(participant) }
    },

    async verify(token) {
      const participant = PARTICIPANTS.find((item) => token === tokenFor(item))
      if (!participant) throw unauthorized('Unknown or expired demo token.')
      return actorFor(participant)
    },

    participants: () => [...PARTICIPANTS],
  }
}
