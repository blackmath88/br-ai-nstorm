import { createServer } from 'node:http'
import { addContribution, getActorUpdates, listProblems, readProblemState, reviewCuration } from './service.js'

const port = Number(process.env.PORT ?? 8787)
const json = (res:any,status:number,value:unknown)=>{ res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-brainstorm-actor'}); res.end(JSON.stringify(value,null,2)) }
const actorFrom = (req:any)=>String(req.headers['x-brainstorm-actor'] ?? 'person:achim')
const readBody = async(req:any)=>{ let raw=''; for await(const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {} }

createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){ res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-brainstorm-actor'}); return res.end() }
    const url = new URL(req.url ?? '/',`http://${req.headers.host ?? 'localhost'}`)
    if(req.method==='GET' && url.pathname==='/api/problems') return json(res,200,{problems:await listProblems()})
    const stateMatch = url.pathname.match(/^\/api\/problems\/([^/]+)$/)
    if(req.method==='GET' && stateMatch) return json(res,200,await readProblemState(stateMatch[1]))
    const updatesMatch = url.pathname.match(/^\/api\/problems\/([^/]+)\/updates$/)
    if(req.method==='GET' && updatesMatch) return json(res,200,await getActorUpdates(updatesMatch[1],actorFrom(req),url.searchParams.get('since') ?? undefined))
    const contributionMatch = url.pathname.match(/^\/api\/problems\/([^/]+)\/contributions$/)
    if(req.method==='POST' && contributionMatch){ const body=await readBody(req); return json(res,201,await addContribution({problemId:contributionMatch[1],actorId:actorFrom(req),content:body.content,kind:body.kind,source:body.source})) }
    const reviewMatch = url.pathname.match(/^\/api\/curation\/([^/]+)\/review$/)
    if(req.method==='POST' && reviewMatch){ const body=await readBody(req); return json(res,200,await reviewCuration({proposalId:reviewMatch[1],accept:Boolean(body.accept),actorId:actorFrom(req)})) }
    if(req.method==='GET' && url.pathname==='/health') return json(res,200,{ok:true,curatorAI:Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL)})
    return json(res,404,{error:'not_found'})
  } catch(error){ return json(res,400,{error:error instanceof Error?error.message:'unknown_error'}) }
}).listen(port,()=>console.log(`br-ai-nstorm API listening on http://localhost:${port}`))
