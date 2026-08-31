import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { addContribution, getActorUpdates, listProblems, readProblemState, reviewCuration } from './service.js'

const actorId = process.env.BRAINSTORM_ACTOR_ID ?? 'person:achim'

const server = new McpServer({ name:'br-ai-nstorm', version:'0.2.0' })

server.registerTool('list_problems', {
  description:'List shared problems visible to the current participant.',
  inputSchema:z.object({})
}, async()=>{
  const result = await listProblems()
  return { content:[{type:'text',text:JSON.stringify(result,null,2)}], structuredContent:{problems:result} }
})

server.registerTool('get_problem_state', {
  description:'Return canonical shared state, provenance, accepted relations, open conflicts, curation proposals, and event history for a problem.',
  inputSchema:z.object({ problemId:z.string() })
}, async({problemId})=>{
  const result = await readProblemState(problemId)
  return { content:[{type:'text',text:JSON.stringify(result,null,2)}], structuredContent:result as any }
})

server.registerTool('get_my_updates', {
  description:'Return what changed for the current participant, including their contributions, related accepted relations, conflicts, and pending curation proposals.',
  inputSchema:z.object({ problemId:z.string(), since:z.string().optional() })
}, async({problemId,since})=>{
  const result = await getActorUpdates(problemId,actorId,since)
  return { content:[{type:'text',text:JSON.stringify(result,null,2)}], structuredContent:result as any }
})

server.registerTool('propose_contribution', {
  description:'Add a bounded attributed contribution to shared memory. The server logs it deterministically, then runs conservative curation that can only create review proposals.',
  inputSchema:z.object({
    problemId:z.string(),
    content:z.string().min(1).max(8000),
    kind:z.enum(['question','claim','evidence','assumption','approach','contradiction']).optional(),
    source:z.string().max(1000).optional()
  })
}, async({problemId,content,kind,source})=>{
  const result = await addContribution({problemId,actorId,content,kind,source})
  return { content:[{type:'text',text:JSON.stringify(result,null,2)}], structuredContent:result as any }
})

server.registerTool('review_curation_proposal', {
  description:'Accept or reject an AI/deterministic curation proposal. Only accepted proposals may become canonical relations or conflicts.',
  inputSchema:z.object({ proposalId:z.string(), accept:z.boolean() })
}, async({proposalId,accept})=>{
  const result = await reviewCuration({proposalId,accept,actorId})
  return { content:[{type:'text',text:JSON.stringify(result,null,2)}], structuredContent:{proposal:result} as any }
})

async function main(){
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error)=>{ console.error(error); process.exit(1) })
