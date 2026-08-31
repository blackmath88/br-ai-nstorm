import { problems } from '../src/data/problems.js'
import type { ContributionKind } from './domain.js'
import { appendContribution, ensureProblem, getProblem } from './store.js'

const toContributionKind = (kind: string): ContributionKind => {
  if (kind === 'question' || kind === 'evidence' || kind === 'assumption' || kind === 'approach' || kind === 'contradiction') return kind
  return 'claim'
}

export async function ensureSeedData() {
  for (const problem of problems) {
    await ensureProblem({
      id: problem.id,
      title: problem.title,
      description: problem.description,
      createdAt: `${problem.nodes.find((n) => n.kind === 'problem')?.createdAt ?? '2026-08-18'}T08:00:00.000Z`,
      createdBy: 'person:achim',
    })

    const current = await getProblem(problem.id)
    if (current.contributions.length > 0) continue

    for (const node of problem.nodes.filter((n) => n.kind !== 'problem')) {
      const authorId = node.author === 'Achim' ? 'person:achim' : `seed:${node.author.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      await appendContribution({
        id: node.id,
        problemId: problem.id,
        authorId,
        kind: toContributionKind(node.kind),
        content: node.detail,
        status: 'active',
        visibility: 'problem',
        createdAt: `${node.createdAt}T12:00:00.000Z`,
        source: `seed:${node.label}`,
      }, authorId)
    }
  }
}
