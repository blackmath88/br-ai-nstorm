/**
 * The single tool-registration site.
 *
 * Both entrypoints (`stdio.ts`, `http.ts`) call the same factory, which calls
 * this function once per serving unit — so a tool cannot exist on one transport
 * and not the other.
 *
 * Three rules, taken from the official SDK examples and the reference templates
 * (see docs/architecture/REFERENCE_IMPLEMENTATIONS.md):
 *
 *  1. Every tool declares `inputSchema` AND `outputSchema`. The SDK validates
 *     `structuredContent` against the declared output schema, so our own
 *     responses are schema-checked for free.
 *  2. Every result carries both `content` (text fallback) and
 *     `structuredContent` (the object).
 *  3. Operation failures are in-band `isError: true` results, never thrown. A
 *     thrown error is a protocol fault; a failed operation is a result the
 *     model must be able to read and react to.
 *
 * And the rule that matters most here: **no tool handler touches the
 * repository.** Handlers call application services — the same objects the HTTP
 * adapter calls.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { Services } from '../container.js'
import type { ActorContext } from '../auth/actor-context.js'
import { isDomainError } from '../domain/errors.js'
import { CONTRIBUTION_KINDS } from '../domain/types.js'
import { CONFLICT_KIND_MEANING } from '../domain/conflicts.js'

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** Success: the same payload twice — readable text and a structured object. */
export function ok(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

/** Failure: in-band, so the model sees a result rather than a transport fault. */
export function fail(error: unknown): ToolResult {
  const body = isDomainError(error)
    ? { error: error.code, message: error.message, detail: error.detail ?? null }
    : { error: 'internal_error', message: 'Unexpected server error.', detail: null }
  if (!isDomainError(error)) console.error('[br-ai-nstorm] MCP tool error:', error)
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  }
}

const guard = async (run: () => Promise<Record<string, unknown>>): Promise<ToolResult> => {
  try {
    return ok(await run())
  } catch (error) {
    return fail(error)
  }
}

const problemIdSchema = z.object({ problemId: z.string().min(1).describe('Shared problem identifier.') })

const jsonish = z.record(z.string(), z.unknown())

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const
const mutating = { readOnlyHint: false, idempotentHint: false, openWorldHint: false } as const

/**
 * Registers every tool on `server`, bound to one already-resolved participant.
 *
 * `actor` is closed over rather than read from the arguments, which is the
 * point: an MCP client cannot claim to be someone by putting a name in a tool
 * call. Identity was resolved before this server instance existed.
 */
export function registerTools(server: McpServer, services: Services, actor: ActorContext): void {
  server.registerTool(
    'list_problems',
    {
      title: 'List problems',
      description: 'List the shared problems in this room.',
      inputSchema: z.object({}),
      outputSchema: z.object({ problems: z.array(jsonish), viewer: jsonish }),
      annotations: readOnly,
    },
    async () => guard(async () => ({ problems: await services.problems.list(), viewer: { ...actor } })),
  )

  server.registerTool(
    'get_problem_state',
    {
      title: 'Get problem state',
      description:
        'Canonical shared state for one problem: contributions with full provenance, accepted relations, ' +
        'conflicts (accepted disagreements, not errors), pending curation proposals and evaluations. ' +
        'Inclusion in this state means someone said it — never that it is true.',
      inputSchema: problemIdSchema,
      outputSchema: z.object({
        problem: jsonish,
        contributions: z.array(jsonish),
        relations: z.array(jsonish),
        conflicts: z.array(jsonish),
        proposals: z.array(jsonish),
        evaluations: z.array(jsonish),
        conflictTypes: z.record(z.string(), z.string()),
      }),
      annotations: readOnly,
    },
    async ({ problemId }) =>
      guard(async () => ({
        ...(await services.problems.getState(problemId)),
        conflictTypes: CONFLICT_KIND_MEANING,
      })),
  )

  server.registerTool(
    'get_problem_updates',
    {
      title: 'Get problem updates',
      description:
        'What changed in a problem since a timestamp, from this participant’s point of view: other people’s ' +
        'activity, what happened to their own contributions, unresolved conflicts, and the pending review queue.',
      inputSchema: z.object({
        problemId: z.string().min(1),
        since: z.string().optional().describe('ISO-8601 timestamp. Omit for the full history.'),
      }),
      outputSchema: z.object({
        since: z.string().nullable(),
        updates: z.array(jsonish),
        traces: z.array(jsonish),
        unresolvedConflicts: z.array(jsonish),
        pendingProposals: z.array(jsonish),
        thinkNext: z.array(z.string()),
      }),
      annotations: readOnly,
    },
    async ({ problemId, since }) =>
      guard(async () => ({ ...(await services.problems.getUpdates(problemId, actor, since)) })),
  )

  server.registerTool(
    'get_my_contributions',
    {
      title: 'Get my contributions',
      description: 'Every contribution authored by the authenticated participant in one problem.',
      inputSchema: problemIdSchema,
      outputSchema: z.object({ actorId: z.string(), contributions: z.array(jsonish) }),
      annotations: readOnly,
    },
    async ({ problemId }) =>
      guard(async () => ({
        actorId: actor.actorId,
        contributions: await services.problems.getMyContributions(problemId, actor),
      })),
  )

  server.registerTool(
    'get_conflicts',
    {
      title: 'Get conflicts',
      description:
        'Accepted conflicts in a problem. Conflict is part of the knowledge here, not an error state — ' +
        'do not resolve, average or summarise these away.',
      inputSchema: problemIdSchema,
      outputSchema: z.object({
        open: z.array(jsonish),
        all: z.array(jsonish),
        conflictTypes: z.record(z.string(), z.string()),
      }),
      annotations: readOnly,
    },
    async ({ problemId }) =>
      guard(async () => ({
        ...(await services.problems.getConflicts(problemId)),
        conflictTypes: CONFLICT_KIND_MEANING,
      })),
  )

  server.registerTool(
    'propose_contribution',
    {
      title: 'Propose a contribution',
      description:
        'Add one bounded, attributed contribution to shared memory on behalf of the authenticated participant. ' +
        'The server records it deterministically, then runs conservative curation that can only create review ' +
        'proposals. Set preparedBy when a model drafted the text, so "AI prepared" is never recorded as ' +
        '"human authored".',
      inputSchema: z.object({
        problemId: z.string().min(1),
        content: z.string().min(1).max(8000),
        kind: z.enum(CONTRIBUTION_KINDS as [string, ...string[]]).optional(),
        preparedBy: z.string().max(200).optional().describe('Model or agent that drafted this, e.g. "ai:claude".'),
        sourceDetail: z.string().max(1000).optional().describe('Citation or origin note.'),
      }),
      outputSchema: z.object({
        contribution: jsonish,
        proposals: z.array(jsonish),
        curator: jsonish,
      }),
      annotations: mutating,
    },
    async ({ problemId, content, kind, preparedBy, sourceDetail }) =>
      guard(async () => ({
        ...(await services.contributions.add(actor, {
          problemId,
          content,
          kind: kind as never,
          source: 'mcp',
          ...(preparedBy ? { preparedBy } : {}),
          ...(sourceDetail ? { sourceDetail } : {}),
        })),
      })),
  )

  server.registerTool(
    'review_curation_proposal',
    {
      title: 'Review a curation proposal',
      description:
        'Accept or reject a curation proposal as the authenticated participant. Only accepted proposals become ' +
        'canonical relations or conflicts. This is a human review act recorded against this participant — ' +
        'do not call it without the participant having decided.',
      inputSchema: z.object({
        problemId: z.string().min(1),
        proposalId: z.string().min(1),
        accept: z.boolean(),
        reason: z.string().max(1000).optional(),
      }),
      outputSchema: z.object({
        proposal: jsonish,
        relation: jsonish.nullable(),
        conflict: jsonish.nullable(),
      }),
      annotations: mutating,
    },
    async ({ problemId, proposalId, accept, reason }) =>
      guard(async () => {
        const result = accept
          ? await services.curation.accept(actor, { problemId, proposalId })
          : await services.curation.reject(actor, { problemId, proposalId, ...(reason ? { reason } : {}) })
        return {
          proposal: result.proposal as unknown as Record<string, unknown>,
          relation: (result.relation ?? null) as unknown as Record<string, unknown> | null,
          conflict: (result.conflict ?? null) as unknown as Record<string, unknown> | null,
        }
      }),
  )
}

export const TOOL_NAMES = [
  'list_problems',
  'get_problem_state',
  'get_problem_updates',
  'get_my_contributions',
  'get_conflicts',
  'propose_contribution',
  'review_curation_proposal',
] as const
