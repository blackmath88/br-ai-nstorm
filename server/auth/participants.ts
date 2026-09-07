import type { Participant } from '../domain/types.js'

/** Prototype roster shared by local auth, seed import and the Cloudflare demo. */
export const PARTICIPANTS: Participant[] = [
  { id: 'person:achim', name: 'Achim' },
  { id: 'person:kai', name: 'Kai' },
  { id: 'person:lea', name: 'Lea' },
  { id: 'person:mara', name: 'Mara' },
]
