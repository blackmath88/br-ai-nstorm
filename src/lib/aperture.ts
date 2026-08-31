import type { ContributionPackage, ProblemSpace } from '../types/domain'

export const participant = { id: 'person:achim', name: 'Achim' }

export function createContextPackage(problem: ProblemSpace, privateDraft = '') {
  return {
    $type: 'ai.bridgework.brainstorm.contextPackage',
    schemaVersion: '0.1',
    problem: {
      id: problem.id,
      title: problem.title,
      description: problem.description,
      solutionState: problem.stateSummary,
    },
    participant,
    sharedState: {
      nodes: problem.nodes.map(({ id, kind, label, detail, status, author, createdAt }) => ({
        id, kind, label, detail, status, attributedTo: author, createdAt,
      })),
      relationships: problem.relations,
    },
    personalState: {
      myContributionUpdates: problem.mine,
      whatChanged: problem.updated,
      orchestrationPrompts: problem.thinkNext,
      privateDraft: privateDraft || null,
    },
    aperture: {
      mode: 'reviewed_contribution',
      privateProcessDisclosed: false,
      rules: [
        'Use this context to help the participant think privately.',
        'Do not treat attributed statements as universal truth.',
        'Preserve disagreement and provenance.',
        'Do not infer endorsement from mere inclusion in shared state.',
        'Only the final contributionPackage JSON will be returned to the shared problem.',
      ],
    },
    systemPrompt:
      'You are the participant’s private thinking partner for a shared problem. Explore freely. When asked to return a contribution, output ONLY valid JSON matching expectedOutputSchema. Produce bounded contributions rather than a transcript.',
    expectedOutputSchema: {
      $type: 'ai.bridgework.brainstorm.contributionPackage',
      schemaVersion: '0.1',
      problemId: problem.id,
      participantId: participant.id,
      contributions: [
        {
          kind: 'question | claim | evidence | assumption | approach | contradiction',
          content: 'string',
          confidence: 'low | medium | high',
          relationTo: ['optional node ids'],
          endorsement: 'participant_review_required',
        },
      ],
      privateProcessDisclosed: false,
    },
  }
}

export function validateContributionPackage(value: unknown, problemId: string): ContributionPackage {
  if (!value || typeof value !== 'object') throw new Error('JSON must be an object.')
  const data = value as Partial<ContributionPackage>
  if (data.$type !== 'ai.bridgework.brainstorm.contributionPackage') throw new Error('Wrong $type.')
  if (data.problemId !== problemId) throw new Error('Contribution package belongs to another problem.')
  if (!Array.isArray(data.contributions)) throw new Error('contributions must be an array.')
  if (data.privateProcessDisclosed !== false) throw new Error('privateProcessDisclosed must be false.')
  return data as ContributionPackage
}
