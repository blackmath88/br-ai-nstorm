import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { SharedMemoryData, MemoryEvent, ContributionRecord, RelationRecord, ConflictRecord, CurationProposal, ProblemRecord } from './domain.js'
import { makeId, now } from './domain.js'

const DATA_FILE = resolve(process.env.BRAINSTORM_DATA_FILE ?? 'server/data/memory.json')

const emptyData = (): SharedMemoryData => ({
  actors: [
    { id: 'person:achim', name: 'Achim' },
    { id: 'person:kai', name: 'Kai' },
    { id: 'person:lea', name: 'Lea' },
  ],
  problems: [], contributions: [], relations: [], conflicts: [], proposals: [], events: [],
})

async function load(): Promise<SharedMemoryData> {
  try { return JSON.parse(await readFile(DATA_FILE, 'utf8')) as SharedMemoryData }
  catch { return emptyData() }
}

async function save(data: SharedMemoryData) {
  await mkdir(dirname(DATA_FILE), { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

export async function ensureProblem(problem: ProblemRecord) {
  const data = await load()
  if (!data.problems.some((item) => item.id === problem.id)) {
    data.problems.push(problem)
    data.events.push({ id: makeId('evt'), type:'ProblemCreated', problemId:problem.id, actorId:problem.createdBy, objectId:problem.id, timestamp:now(), payload:{ title:problem.title } })
    await save(data)
  }
}

export async function getMemory() { return load() }
export async function getProblem(problemId: string) {
  const data = await load()
  return {
    problem: data.problems.find((p) => p.id === problemId),
    contributions: data.contributions.filter((c) => c.problemId === problemId),
    relations: data.relations.filter((r) => r.problemId === problemId),
    conflicts: data.conflicts.filter((c) => c.problemId === problemId),
    proposals: data.proposals.filter((p) => p.problemId === problemId),
    events: data.events.filter((e) => e.problemId === problemId),
  }
}

export async function appendContribution(record: ContributionRecord, actorId: string) {
  const data = await load(); data.contributions.push(record)
  data.events.push({ id:makeId('evt'), type:'ContributionAdded', problemId:record.problemId, actorId, objectId:record.id, timestamp:now(), payload:{ kind:record.kind, content:record.content, source:record.source ?? null } })
  await save(data); return record
}

export async function appendProposal(proposal: CurationProposal) {
  const data = await load()
  if (data.proposals.some((p) => p.status === 'pending' && p.kind === proposal.kind && p.sourceId === proposal.sourceId && p.targetId === proposal.targetId)) return proposal
  data.proposals.push(proposal)
  const type: MemoryEvent['type'] = proposal.kind === 'conflict' ? 'ConflictProposed' : 'RelationProposed'
  data.events.push({ id:makeId('evt'), type, problemId:proposal.problemId, actorId:proposal.proposedBy, objectId:proposal.id, timestamp:now(), payload:{...proposal} })
  await save(data); return proposal
}

export async function reviewProposal(proposalId: string, accept: boolean, actorId: string) {
  const data = await load(); const proposal = data.proposals.find((p) => p.id === proposalId)
  if (!proposal) throw new Error('proposal_not_found')
  if (proposal.status !== 'pending') return proposal
  proposal.status = accept ? 'accepted' : 'rejected'
  if (accept && proposal.kind === 'conflict' && proposal.targetId && proposal.conflictKind) {
    const conflict: ConflictRecord = { id:makeId('conflict'), problemId:proposal.problemId, leftId:proposal.sourceId, rightId:proposal.targetId, kind:proposal.conflictKind, status:'open', reason:proposal.reason, detectedBy:proposal.proposedBy, confidence:proposal.confidence, createdAt:now() }
    data.conflicts.push(conflict)
    data.events.push({ id:makeId('evt'), type:'ConflictAccepted', problemId:proposal.problemId, actorId, objectId:conflict.id, timestamp:now(), payload:{ proposalId } })
  } else if (accept && proposal.kind === 'relation' && proposal.targetId && proposal.relationKind) {
    const relation: RelationRecord = { id:makeId('rel'), problemId:proposal.problemId, sourceId:proposal.sourceId, targetId:proposal.targetId, kind:proposal.relationKind, status:'accepted', createdBy:actorId, createdAt:now() }
    data.relations.push(relation)
    data.events.push({ id:makeId('evt'), type:'RelationAccepted', problemId:proposal.problemId, actorId, objectId:relation.id, timestamp:now(), payload:{ proposalId } })
  } else {
    data.events.push({ id:makeId('evt'), type:proposal.kind === 'conflict' ? 'ConflictRejected' : 'RelationRejected', problemId:proposal.problemId, actorId, objectId:proposal.id, timestamp:now(), payload:{} })
  }
  await save(data); return proposal
}
