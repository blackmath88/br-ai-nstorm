/**
 * Prototype participant switcher.
 *
 * This calls the server's dev session endpoint and stores the token it returns.
 * It does not, and cannot, tell the server who the user is — it asks for a
 * session and the server decides what that token means. That distinction is the
 * whole reason `x-brainstorm-actor` was removed.
 */
import type { ActorContext, Participant } from '../lib/api'

export function ParticipantSwitcher({
  participants,
  actor,
  onSelect,
  busy,
}: {
  participants: Participant[]
  actor: ActorContext | null
  onSelect: (participantId: string) => void
  busy: boolean
}) {
  return (
    <div className="participant-switcher">
      <span className="section-kicker">Acting as</span>
      <div className="participant-list">
        {participants.map((participant) => (
          <button
            key={participant.id}
            className={`participant-chip${actor?.actorId === participant.id ? ' active' : ''}`}
            onClick={() => onSelect(participant.id)}
            disabled={busy}
          >
            {participant.name}
          </button>
        ))}
      </div>
      <span className="participant-note">
        Prototype sign-in. The server issues a session token; the client never asserts an identity.
      </span>
    </div>
  )
}
