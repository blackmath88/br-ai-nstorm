/**
 * The exploratory derived view.
 *
 * It renders accepted relations and accepted conflicts over the same
 * contributions the State view shows. Position carries no meaning — this is a
 * projection, not the ontology, and it can never write.
 */
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { ConflictRecord, ContributionKind, ContributionRecord, RelationRecord } from '../lib/api'

const COLOR: Record<ContributionKind, string> = {
  question: '#bfd2e5',
  approach: '#a8d8d2',
  evidence: '#b9d7b3',
  assumption: '#e7c78b',
  contradiction: '#d9a6aa',
  claim: '#cdd5d3',
  synthesis: '#cabde4',
}

type SimNode = d3.SimulationNodeDatum & {
  id: string
  kind: ContributionKind
  label: string
  meta: string
  weight: number
}

type SimLink = d3.SimulationLinkDatum<SimNode> & { kind: string }

export function MapView({
  contributions,
  relations,
  conflicts,
  onSelect,
}: {
  contributions: ContributionRecord[]
  relations: RelationRecord[]
  conflicts: ConflictRecord[]
  onSelect: (id: string) => void
}) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const width = Math.max(760, element.clientWidth || 760)
    const height = 620

    const svg = d3.select(element)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const active = contributions.filter((c) => c.status === 'active')
    const present = new Set(active.map((c) => c.id))

    // Degree drives node size, so the map reflects how connected a
    // contribution actually is rather than a hand-tuned weight.
    const degree = new Map<string, number>()
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)

    const edges: SimLink[] = []
    for (const relation of relations) {
      if (!present.has(relation.sourceId) || !present.has(relation.targetId)) continue
      edges.push({ source: relation.sourceId, target: relation.targetId, kind: relation.kind })
      bump(relation.sourceId)
      bump(relation.targetId)
    }
    for (const conflict of conflicts) {
      if (conflict.status !== 'open') continue
      if (!present.has(conflict.leftObjectId) || !present.has(conflict.rightObjectId)) continue
      edges.push({ source: conflict.leftObjectId, target: conflict.rightObjectId, kind: 'conflict' })
      bump(conflict.leftObjectId)
      bump(conflict.rightObjectId)
    }

    const nodes: SimNode[] = active.map((contribution) => ({
      id: contribution.id,
      kind: contribution.kind,
      label: contribution.label,
      meta: contribution.provenance.authoredBy.replace(/^(person|seed):/, ''),
      weight: 14 + (degree.get(contribution.id) ?? 0) * 3,
    }))

    if (nodes.length === 0) return

    const radius = (node: SimNode) => Math.max(16, 9 + node.weight * 0.5)

    const simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(edges).id((d) => d.id).distance(115).strength(0.55))
      .force('charge', d3.forceManyBody().strength(-460))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => radius(d) + 36))

    const lines = svg
      .append('g')
      .selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('class', (d) => `map-link ${d.kind}`)

    const groups = svg
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'map-node')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => onSelect(d.id))
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }),
      )

    groups.append('circle').attr('r', radius).attr('fill', (d) => COLOR[d.kind]).attr('class', 'map-circle')
    groups
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('class', 'map-label')
      .attr('dy', (d) => radius(d) + 18)
      .text((d) => (d.label.length > 34 ? `${d.label.slice(0, 34)}…` : d.label))
    groups
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('class', 'map-sublabel')
      .attr('dy', (d) => radius(d) + 31)
      .text((d) => d.meta)

    simulation.on('tick', () => {
      lines
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      groups.attr(
        'transform',
        (d) =>
          `translate(${Math.max(60, Math.min(width - 60, d.x ?? 0))},${Math.max(50, Math.min(height - 60, d.y ?? 0))})`,
      )
    })

    // The effect cleanup must return void, not the Simulation `stop()` returns.
    return () => {
      simulation.stop()
    }
  }, [contributions, relations, conflicts, onSelect])

  return (
    <div className="map-shell">
      <svg ref={ref} className="map-svg" aria-label="Relationship map" />
      <div className="map-explainer">
        Exploratory projection. Position shows relationship forces, not canonical hierarchy. Dashed red edges are
        accepted, unresolved conflicts.
      </div>
    </div>
  )
}
