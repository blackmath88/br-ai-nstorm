import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { ProblemSpace } from '../types/domain'

const color = {
  problem:'#2f3d43',
  question:'#bfd2e5',
  approach:'#a8d8d2',
  evidence:'#b9d7b3',
  assumption:'#e7c78b',
  contradiction:'#d9a6aa',
  synthesis:'#cabde4',
}

type SimNode = d3.SimulationNodeDatum & {
  id:string
  kind:keyof typeof color
  label:string
  status:string
  weight:number
}

export function MapView({ problem, onSelectNode }: { problem: ProblemSpace; onSelectNode:(id:string)=>void }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svgEl = ref.current
    if (!svgEl) return
    const width = Math.max(760, svgEl.clientWidth || 760)
    const height = 620

    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const nodes: SimNode[] = problem.nodes.map((n) => ({
      id:n.id, kind:n.kind, label:n.label, status:n.status, weight:n.weight ?? 16,
    }))
    const links = problem.relations.map((r) => ({...r}))

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, any>(links).id((d:any)=>d.id).distance(110).strength(.55))
      .force('charge', d3.forceManyBody().strength(-460))
      .force('center', d3.forceCenter(width/2,height/2))
      .force('collision', d3.forceCollide<SimNode>().radius((d)=>Math.max(18,10+d.weight*.55)+36))

    const lines = svg.append('g').selectAll('line').data(links).enter().append('line')
      .attr('class',(d:any)=>`map-link ${d.kind}`)

    const groups = svg.append('g').selectAll<SVGGElement,SimNode>('g').data(nodes).enter().append('g')
      .attr('class','map-node')
      .style('cursor','pointer')
      .on('click',(_,d)=>onSelectNode(d.id))
      .call(d3.drag<SVGGElement,SimNode>()
        .on('start',(event,d)=>{ if(!event.active) simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y })
        .on('drag',(event,d)=>{ d.fx=event.x; d.fy=event.y })
        .on('end',(event,d)=>{ if(!event.active) simulation.alphaTarget(0); d.fx=null; d.fy=null })
      )

    const radius = (d:SimNode)=>Math.max(18,10+d.weight*.55)

    groups.append('circle')
      .attr('r',radius)
      .attr('fill',(d)=>color[d.kind])
      .attr('class','map-circle')

    groups.append('text').attr('text-anchor','middle').attr('class','map-label')
      .attr('dy',(d)=>radius(d)+18).text((d)=>d.label)

    groups.append('text').attr('text-anchor','middle').attr('class','map-sublabel')
      .attr('dy',(d)=>radius(d)+31).text((d)=>d.status)

    simulation.on('tick',()=>{
      lines
        .attr('x1',(d:any)=>d.source.x).attr('y1',(d:any)=>d.source.y)
        .attr('x2',(d:any)=>d.target.x).attr('y2',(d:any)=>d.target.y)
      groups.attr('transform',(d)=>`translate(${Math.max(50,Math.min(width-50,d.x ?? 0))},${Math.max(50,Math.min(height-60,d.y ?? 0))})`)
    })

    return () => simulation.stop()
  },[problem,onSelectNode])

  return (
    <div className="map-shell">
      <svg ref={ref} className="map-svg" aria-label="Relationship map" />
      <div className="map-explainer">Exploratory view. Position shows relationship forces, not canonical hierarchy.</div>
    </div>
  )
}
