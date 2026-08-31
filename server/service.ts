import type { ContributionKind } from './domain.js'
import { makeId, now } from './domain.js'
import { appendContribution, getMemory, getProblem, reviewProposal } from './store.js'
import { curateContribution, inferKind } from './curator.js'
import { ensureSeedData } from './seed.js'

export async function listProblems() {
  await ensureSeedData()
  const data = await getMemory()
  return data.problems
}

export async function readProblemState(problemId: string) {
  await ensureSeedData()
  const state = await getProblem(problemId)
  if (!state.problem) throw new Error('problem_not_found')
  return state
}

export async function addContribution(input: {
  problemId: string
  actorId: string
  content: string
  kind?: ContributionKind
  source?: string
}) {
  await ensureSeedData()
  const state = await getProblem(input.problemId)
  if (!state.problem) throw new Error('problem_not_found')
  const record = {
    id: makeId('contrib'),
    problemId: input.problemId,
    authorId: input.actorId,
    kind: input.kind ?? inferKind(input.content),
    content: input.content.trim(),
    status: 'active' as const,
    visibility: 'problem' as const,
    createdAt: now(),
    source: input.source,
  }
  if (!record.content) throw new Error('content_required')
  await appendContribution(record, input.actorId)
  const curation = await curateContribution(input.problemId, record)
  return { contribution: record, curation }
}

export async function getActorUpdates(problemId: string, actorId: string, since?: string) {
  const state = await readProblemState(problemId)
  const threshold = since ? Date.parse(since) : 0
  const events = state.events.filter((e) => Date.parse(e.timestamp) > threshold)
  const mine = state.contributions.filter((c) => c.authorId === actorId)
  const mineIds = new Set(mine.map((c) => c.id))
  const related = state.relations.filter((r) => mineIds.has(r.sourceId) || mineIds.has(r.targetId))
  const conflicts = state.conflicts.filter((c) => mineIds.has(c.leftId) || mineIds.has(c.rightId))
  const proposals = state.proposals.filter((p) => mineIds.has(p.sourceId) || (p.targetId ? mineIds.has(p.targetId) : false))
  return { since: since ?? null, events, myContributions: mine, related, conflicts, pendingProposals: proposals.filter((p) => p.status === 'pending') }
}

export async function reviewCuration(input: { proposalId: string; accept: boolean; actorId: string }) {
  return reviewProposal(input.proposalId, input.accept, input.actorId)
}
