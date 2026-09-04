/**
 * Seeds the event log from the pre-backend React problem data, once.
 *
 * The interesting decision here is what to do about attribution. The prototype
 * data has authors like `"AI synthesis"`, `"Group"` and `"Shared space"` —
 * which are not people. Mapping those onto a participant would manufacture
 * attribution, which is exactly what the architecture forbids. So:
 *
 *   - the four known participants map to `person:*`;
 *   - every other name becomes a `seed:*` agent, honestly marked as imported;
 *   - `"AI synthesis"` additionally gets `preparedBy` set and endorsement left
 *     at `participant_review_required`, because the prototype never recorded a
 *     human who stood behind it.
 *
 * Structural facts (the problem itself, the pre-existing relation map) are
 * attributed to `seed:import`, not to a person, for the same reason.
 */
import { problems as seedProblems } from '../../src/data/problems.js'
import { deriveLabel, makeEvent, type Clock, type IdSource, type MemoryEvent } from '../domain/events.js'
import type { ContributionKind, Provenance, RelationKind } from '../domain/types.js'
import { CONTRIBUTION_KINDS, RELATION_KINDS } from '../domain/types.js'
import { PARTICIPANTS } from '../auth/prototype-auth.js'
import type { EventRepository } from './repository.js'

export const SEED_ACTOR = 'seed:import'

const PARTICIPANT_BY_NAME = new Map(PARTICIPANTS.map((p) => [p.name.toLowerCase(), p.id]))

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Maps a prototype author string to an agent id without inventing a person. */
function agentFor(author: string): { authoredBy: string; preparedBy?: string } {
  const known = PARTICIPANT_BY_NAME.get(author.trim().toLowerCase())
  if (known) return { authoredBy: known }
  if (/ai/i.test(author)) {
    return { authoredBy: `seed:${slug(author)}`, preparedBy: `ai:prototype-${slug(author)}` }
  }
  return { authoredBy: `seed:${slug(author)}` }
}

const asContributionKind = (kind: string): ContributionKind =>
  (CONTRIBUTION_KINDS as string[]).includes(kind) ? (kind as ContributionKind) : 'claim'

const asRelationKind = (kind: string): RelationKind =>
  (RELATION_KINDS as string[]).includes(kind) ? (kind as RelationKind) : 'relates'

const at = (date: string, hour: string) => `${date}T${hour}:00.000Z`

export interface SeedDeps {
  repository: EventRepository
  clock: Clock
  ids: IdSource
}

/**
 * Idempotent: a problem already present in the log is skipped entirely, so
 * restarting the server never duplicates history.
 */
export async function ensureSeedData(deps: SeedDeps): Promise<void> {
  const existing = await deps.repository.read()
  const known = new Set(existing.filter((e) => e.eventType === 'ProblemCreated').map((e) => e.problemId))

  const events: MemoryEvent[] = []

  for (const problem of seedProblems) {
    if (known.has(problem.id)) continue

    const root = problem.nodes.find((node) => node.kind === 'problem')
    const openedAt = at(root?.createdAt ?? '2026-08-18', '08:00')

    events.push({
      ...makeEvent(deps, {
        problemId: problem.id,
        actorId: SEED_ACTOR,
        objectId: problem.id,
        eventType: 'ProblemCreated',
        payload: {
          title: problem.title,
          shortTitle: problem.shortTitle,
          description: problem.description,
          stateSummary: problem.stateSummary,
          thinkNext: [...problem.thinkNext],
        },
      }),
      timestamp: openedAt,
    })

    // Prototype node ids are short (`q1`, `a2`) and only unique within a
    // problem, so they are namespaced on import.
    const idFor = (nodeId: string) => `${problem.id}:${nodeId}`

    for (const node of problem.nodes) {
      if (node.kind === 'problem') continue
      const agent = agentFor(node.author)
      const timestamp = at(node.createdAt, '12:00')
      const provenance: Provenance = {
        authoredBy: agent.authoredBy,
        ...(agent.preparedBy ? { preparedBy: agent.preparedBy } : {}),
        submittedBy: agent.authoredBy,
        source: 'seed',
        sourceDetail: `prototype:${node.id} · ${node.status}`,
        // Nothing in the prototype data records a human standing behind an
        // AI-produced statement, so it is not marked as endorsed.
        endorsement: agent.preparedBy ? 'participant_review_required' : 'human_endorsed',
        timestamp,
      }

      events.push({
        ...makeEvent(deps, {
          problemId: problem.id,
          actorId: agent.authoredBy,
          objectId: idFor(node.id),
          eventType: 'ContributionAdded',
          payload: {
            kind: asContributionKind(node.kind),
            label: node.label || deriveLabel(node.detail),
            content: node.detail,
            visibility: 'problem',
            provenance,
          },
        }),
        timestamp,
      })
    }

    for (const relation of problem.relations) {
      // The prototype's root node became the problem, so edges from it are
      // dropped rather than pointed at a non-existent contribution.
      if (relation.source === 'p' || relation.target === 'p') continue
      events.push({
        ...makeEvent(deps, {
          problemId: problem.id,
          actorId: SEED_ACTOR,
          objectId: deps.ids.next('rel'),
          eventType: 'RelationAccepted',
          payload: {
            sourceId: idFor(relation.source),
            targetId: idFor(relation.target),
            relationKind: asRelationKind(relation.kind),
          },
        }),
        timestamp: openedAt,
      })
    }
  }

  if (events.length > 0) await deps.repository.append(events)
}
