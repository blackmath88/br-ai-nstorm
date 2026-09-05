/**
 * Minimal AI curator — proposal-only, bounded input, best-effort.
 *
 * Three constraints, all deliberate:
 *
 *  1. It returns `ProposalDraft[]`. Like the deterministic curator it does not
 *     import `makeEvent`, so it has no way to write canonical memory even if it
 *     wanted to.
 *  2. It receives at most `AI_CANDIDATE_LIMIT` sibling contributions, never the
 *     store. A curator that could read everything would be a different, larger
 *     trust decision.
 *  3. Failure is not an error. The contribution is already durable before this
 *     runs; a missing key, a network fault or malformed output is logged to
 *     stderr and skipped. Deterministic curation is unaffected.
 *
 * stderr, not stdout: under `serveStdio` stdout *is* the JSON-RPC channel, and a
 * stray `console.log` corrupts the protocol stream.
 */
import type { ConflictKind, ContributionRecord, ProblemRecord, RelationKind } from '../domain/types.js'
import { AI_CANDIDATE_LIMIT } from '../domain/policies.js'
import { CONFLICT_KINDS, RELATION_KINDS } from '../domain/types.js'
import type { ProposalDraft } from './deterministic.js'

export interface Curator {
  propose(input: {
    problem: ProblemRecord
    contribution: ContributionRecord
    candidates: ContributionRecord[]
  }): Promise<ProposalDraft[]>
  readonly name: string
  readonly enabled: boolean
}

export interface AiCuratorConfig {
  apiKey?: string
  model?: string
  endpoint?: string
  fetchImpl?: typeof fetch
  log?: (message: string, error: unknown) => void
}

const INSTRUCTIONS = [
  'You are a conservative curator for a shared problem memory.',
  'You may only return review proposals. You never declare truth or consensus.',
  'Prefer returning nothing over returning a weak proposal.',
  'Distinguish a real contradiction from a mere difference of emphasis.',
  'Never assert who said something; attribution is not yours to decide.',
].join(' ')

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'targetId', 'reason', 'confidence'],
        properties: {
          kind: { type: 'string', enum: ['relation', 'conflict', 'duplicate'] },
          targetId: { type: 'string' },
          relationKind: { type: ['string', 'null'], enum: [...RELATION_KINDS, null] },
          conflictKind: { type: ['string', 'null'], enum: [...CONFLICT_KINDS, null] },
          reason: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
}

interface RawProposal {
  kind: 'relation' | 'conflict' | 'duplicate'
  targetId: string
  relationKind?: string | null
  conflictKind?: string | null
  reason: string
  confidence: number
}

/** A curator that proposes nothing. The default, and what every test uses. */
export const nullCurator: Curator = {
  name: 'curator:none',
  enabled: false,
  async propose() {
    return []
  },
}

export function createAiCurator(config: AiCuratorConfig): Curator {
  const { apiKey, model } = config
  const enabled = Boolean(apiKey && model)
  const name = enabled ? `curator:openai:${model}` : 'curator:none'
  const doFetch = config.fetchImpl ?? fetch
  const endpoint = config.endpoint ?? 'https://api.openai.com/v1/responses'
  const log = config.log ?? ((message: string, error: unknown) => console.error(message, error))

  return {
    name,
    enabled,
    async propose({ problem, contribution, candidates }) {
      if (!enabled) return []
      const bounded = candidates.filter((c) => c.status === 'active' && c.id !== contribution.id).slice(0, AI_CANDIDATE_LIMIT)
      if (bounded.length === 0) return []

      try {
        const payload = {
          problem: { id: problem.id, title: problem.title, description: problem.description },
          newContribution: {
            id: contribution.id,
            kind: contribution.kind,
            content: contribution.content,
          },
          candidates: bounded.map(({ id, kind, content }) => ({ id, kind, content })),
        }

        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            instructions: INSTRUCTIONS,
            input: `Return curation proposals for this shared problem state:\n${JSON.stringify(payload)}`,
            text: { format: { type: 'json_schema', name: 'brainstorm_curation', strict: true, schema: responseSchema } },
          }),
        })

        if (!response.ok) throw new Error(`curator_api_${response.status}`)
        const body = (await response.json()) as {
          output_text?: string
          output?: Array<{ content?: Array<{ type: string; text?: string }> }>
        }
        const text =
          body.output_text ??
          body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text
        if (!text) return []

        const parsed = JSON.parse(text) as { proposals?: RawProposal[] }
        const known = new Set(bounded.map((c) => c.id))

        return (parsed.proposals ?? [])
          // The model does not get to invent object ids: anything it names must
          // be a candidate we actually handed it.
          .filter((raw) => known.has(raw.targetId))
          .map<ProposalDraft>((raw) => ({
            problemId: problem.id,
            kind: raw.kind,
            sourceId: contribution.id,
            targetId: raw.targetId,
            ...(raw.relationKind ? { relationKind: raw.relationKind as RelationKind } : {}),
            ...(raw.conflictKind ? { conflictKind: raw.conflictKind as ConflictKind } : {}),
            reason: raw.reason,
            confidence: Math.max(0, Math.min(1, raw.confidence)),
            proposedBy: name,
          }))
      } catch (error) {
        log('[br-ai-nstorm] AI curator skipped:', error)
        return []
      }
    },
  }
}
