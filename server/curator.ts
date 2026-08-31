import type { ContributionKind, ContributionRecord, CurationProposal, ProblemRecord } from './domain.js'
import { makeId, now } from './domain.js'
import { appendProposal, getProblem } from './store.js'

const tokenize = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9äöüß\s-]/gi, ' ').split(/\s+/).filter((x) => x.length > 2))
const similarity = (a: string, b: string) => {
  const A = tokenize(a), B = tokenize(b)
  const both = [...A].filter((x) => B.has(x)).length
  const union = new Set([...A, ...B]).size || 1
  return both / union
}

export function inferKind(content: string): ContributionKind {
  if (content.trim().endsWith('?')) return 'question'
  if (/\b(data|evidence|study|observed|measured|source|report)\b/i.test(content)) return 'evidence'
  if (/\b(assume|assumption|probably|likely|we think)\b/i.test(content)) return 'assumption'
  if (/\b(but|however|contradict|conflict|does not|doesn't|isn't|not true)\b/i.test(content)) return 'contradiction'
  if (/\b(should|could|proposal|option|approach|try|build)\b/i.test(content)) return 'approach'
  return 'claim'
}

function deterministicProposals(problemId: string, item: ContributionRecord, existing: ContributionRecord[]): CurationProposal[] {
  const proposals: CurationProposal[] = []
  for (const other of existing) {
    if (other.id === item.id || other.status !== 'active') continue
    const score = similarity(item.content, other.content)
    if (score >= 0.72) {
      proposals.push({ id:makeId('proposal'), problemId, kind:'duplicate', sourceId:item.id, targetId:other.id, reason:`High lexical overlap (${score.toFixed(2)}). Review whether these express the same contribution.`, confidence:Math.min(.98,score), proposedBy:'curator:deterministic', status:'pending', createdAt:now() })
    } else if (score >= 0.38) {
      proposals.push({ id:makeId('proposal'), problemId, kind:'relation', sourceId:item.id, targetId:other.id, relationKind:'relates', reason:`Shared vocabulary suggests a possible relationship (${score.toFixed(2)}).`, confidence:score, proposedBy:'curator:deterministic', status:'pending', createdAt:now() })
    }
    const conflictCue = /\b(but|however|contradict|conflict|instead|not|doesn't|isn't)\b/i.test(item.content + ' ' + other.content)
    if (conflictCue && score >= 0.2) {
      proposals.push({ id:makeId('proposal'), problemId, kind:'conflict', sourceId:item.id, targetId:other.id, conflictKind:'knowledge_conflict', reason:'The contributions share subject matter while containing a conflict cue. Human review required.', confidence:Math.min(.8,.45+score), proposedBy:'curator:deterministic', status:'pending', createdAt:now() })
    }
  }
  const inferred = inferKind(item.content)
  if (inferred !== item.kind) proposals.push({ id:makeId('proposal'), problemId, kind:'classification', sourceId:item.id, suggestedKind:inferred, reason:`Deterministic classifier suggests “${inferred}” rather than “${item.kind}”.`, confidence:.62, proposedBy:'curator:deterministic', status:'pending', createdAt:now() })
  return proposals.slice(0,8)
}

async function aiProposals(problem: ProblemRecord, item: ContributionRecord, candidates: ContributionRecord[]): Promise<CurationProposal[]> {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL
  if (!apiKey || !model || candidates.length === 0) return []

  const schema = {
    type:'object', additionalProperties:false, required:['proposals'], properties:{ proposals:{ type:'array', maxItems:6, items:{
      type:'object', additionalProperties:false, required:['kind','targetId','reason','confidence'], properties:{
        kind:{type:'string',enum:['relation','conflict','duplicate']},
        targetId:{type:'string'},
        relationKind:{type:['string','null'],enum:['supports','opens','contradicts','relates','supersedes',null]},
        conflictKind:{type:['string','null'],enum:['source_conflict','knowledge_conflict','decision_conflict','assumption_conflict','commitment_conflict',null]},
        reason:{type:'string'}, confidence:{type:'number',minimum:0,maximum:1}
      }
    }}}
  }
  const input = {
    problem:{id:problem.id,title:problem.title,description:problem.description},
    newContribution:item,
    candidates:candidates.slice(0,12).map(({id,kind,content,authorId,status})=>({id,kind,content,authorId,status}))
  }
  const response = await fetch('https://api.openai.com/v1/responses',{
    method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},
    body:JSON.stringify({
      model,
      instructions:'You are a conservative collective-memory curator. Return only review proposals. Never declare truth or consensus. Prefer no proposal over a weak one. Distinguish contradiction from simple difference.',
      input:`Return JSON curation proposals for this shared problem state:\n${JSON.stringify(input)}`,
      text:{format:{type:'json_schema',name:'brainstorm_curation',strict:true,schema}}
    })
  })
  if (!response.ok) throw new Error(`curator_api_${response.status}`)
  const body:any = await response.json()
  const text = body.output_text ?? body.output?.flatMap((o:any)=>o.content ?? []).find((c:any)=>c.type==='output_text')?.text
  if (!text) return []
  const parsed = JSON.parse(text) as {proposals:Array<any>}
  return parsed.proposals.map((p)=>({
    id:makeId('proposal'), problemId:problem.id, kind:p.kind, sourceId:item.id, targetId:p.targetId,
    relationKind:p.relationKind ?? undefined, conflictKind:p.conflictKind ?? undefined,
    reason:p.reason, confidence:p.confidence, proposedBy:`curator:openai:${model}`, status:'pending' as const, createdAt:now()
  }))
}

export async function curateContribution(problemId: string, item: ContributionRecord) {
  const state = await getProblem(problemId)
  if (!state.problem) throw new Error('problem_not_found')
  const candidates = state.contributions.filter((c)=>c.id!==item.id)
  const deterministic = deterministicProposals(problemId,item,candidates)
  for (const proposal of deterministic) await appendProposal(proposal)
  let ai: CurationProposal[] = []
  try { ai = await aiProposals(state.problem,item,candidates) } catch (error) { console.error('AI curator skipped:',error) }
  for (const proposal of ai) await appendProposal(proposal)
  return { deterministic, ai, aiEnabled:Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) }
}
