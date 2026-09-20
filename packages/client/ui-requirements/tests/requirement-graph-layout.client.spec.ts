import { describe, expect, it } from 'vitest'
import type { TraceEdge } from '../src/client/knowledge-graph.ts'
import {
  layoutRequirementGraph, REQUIREMENT_GRAPH_LAYOUT_MODES, type RequirementGraphLayout,
} from '../src/client/requirement-graph-layout.ts'
import type { TraceNode } from '../src/client/trace-exploration.ts'

const layerKinds = ['document', 'requirement', 'task', 'code'] as const

function node(kind: TraceNode['kind'], index: number): TraceNode {
  const shared = { key: `${kind}:${index}`, kind }
  switch (kind) {
    case 'document': return {
      ...shared, roundId: `round-${index}` as never, round: index, title: `Document ${index}`, revision: 1, markdown: '',
    } as TraceNode
    case 'requirement': return {
      ...shared, roundId: 'round-1' as never, round: 1, requirementId: String(index), title: `Requirement ${index}`,
      acceptanceRefs: [`${index}.1`], taskIds: [], status: 'pending',
    } as TraceNode
    case 'task': return {
      ...shared, roundId: 'round-1' as never, task: {
        id: `task-${index}`, title: `Task ${index}`, summary: '', statement: '', kind: 'implementation', order: index,
        status: 'pending', requirementRefs: [`${index}.1`],
      },
    } as unknown as TraceNode
    case 'code': return { ...shared, path: `src/file-${index}.ts`, changes: [] } as TraceNode
  }
}

function fixture(): { nodes: TraceNode[]; edges: TraceEdge[] } {
  const counts = { document: 3, requirement: 10, task: 14, code: 16 }
  const nodes = layerKinds.flatMap(kind => Array.from({ length: counts[kind] }, (_, index) => node(kind, index + 1)))
  const byKind = new Map(layerKinds.map(kind => [kind, nodes.filter(item => item.kind === kind)]))
  const edges: TraceEdge[] = []
  for (let level = 0; level < layerKinds.length - 1; level += 1) {
    const sources = byKind.get(layerKinds[level]!) ?? []
    const targets = byKind.get(layerKinds[level + 1]!) ?? []
    targets.forEach((target, index) => {
      edges.push({ source: sources[index % sources.length]!.key, target: target.key })
      if (index % 4 === 0) edges.push({ source: sources[(index + 1) % sources.length]!.key, target: target.key })
    })
  }
  return { nodes, edges }
}

function radius(layout: RequirementGraphLayout, key: string): number {
  const position = layout.positions.get(key)!
  return Math.hypot(position.x - layout.width / 2, position.y - layout.height / 2)
}

describe('requirement graph layouts', () => {
  it.each(REQUIREMENT_GRAPH_LAYOUT_MODES)('%s is deterministic and keeps scaled nodes finite', (mode) => {
    const { nodes, edges } = fixture()
    const first = layoutRequirementGraph(nodes, edges, mode)
    const second = layoutRequirementGraph(nodes, edges, mode)
    expect(first).toEqual(second)
    expect(first.positions.size).toBe(nodes.length)
    expect(first.regions.map(region => [region.kind, region.count])).toEqual([
      ['document', 3], ['requirement', 10], ['task', 14], ['code', 16],
    ])
    for (const position of first.positions.values()) {
      expect([position.x, position.y, position.scale].every(Number.isFinite)).toBe(true)
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.x).toBeLessThanOrEqual(first.width)
      expect(position.y).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeLessThanOrEqual(first.height)
      expect(position.scale).toBeGreaterThan(0)
      expect(position.scale).toBeLessThanOrEqual(1)
    }
  })

  it('preserves the fixed layered canvas and row-major perspective geometry', () => {
    const { nodes, edges } = fixture()
    const layout = layoutRequirementGraph(nodes, edges, 'layered')
    expect([layout.width, layout.height]).toEqual([588, 472])
    expect(layout.regions.map(region => [region.variant, region.path])).toEqual([
      ['plane', 'M 112 6 H 580 L 476 110 H 8 Z'],
      ['plane', 'M 112 122 H 580 L 476 226 H 8 Z'],
      ['plane', 'M 112 238 H 580 L 476 342 H 8 Z'],
      ['plane', 'M 112 354 H 580 L 476 458 H 8 Z'],
    ])
    expect(layout.positions.get('document:1')).toEqual({ x: 184, y: 68, scale: 1 })
    expect(layout.positions.get('document:2')).toEqual({ x: 284, y: 68, scale: 1 })
    expect(layout.positions.get('document:3')).toEqual({ x: 384, y: 68, scale: 1 })
    expect(layout.positions.get('requirement:1')?.scale).toBeGreaterThan(.7)
    expect(layout.positions.get('requirement:7')?.y).toBe(layout.positions.get('requirement:1')?.y)
  })

  it('packs 20 requirements, 27 tasks, and 41 files into readable shallow rows', () => {
    const counts = { document: 3, requirement: 20, task: 27, code: 41 }
    const nodes = layerKinds.flatMap(kind => Array.from({ length: counts[kind] }, (_, index) => node(kind, index + 1)))
    const layout = layoutRequirementGraph(nodes, [], 'layered')
    const expectedRows = { document: [3], requirement: [10, 10], task: [14, 13], code: [14, 14, 13] }
    for (const kind of layerKinds) {
      const rows = new Map<number, number[]>()
      for (const item of nodes.filter(node => node.kind === kind)) {
        const position = layout.positions.get(item.key)!
        expect(position.scale).toBeGreaterThanOrEqual(kind === 'code' ? .48 : .5)
        rows.set(position.y, [...(rows.get(position.y) ?? []), position.x])
      }
      expect([...rows.values()].map(row => row.length)).toEqual(expectedRows[kind])
      for (const row of rows.values()) expect(row).toEqual([...row].sort((a, b) => a - b))
    }
    expect(layout.positions.size).toBe(91)
    expect(layout.positions.get('task:1')?.scale).toBe(layout.positions.get('requirement:1')?.scale)
  })

  it('scales layered spline handles with distance while keeping vertical endpoint tangents', () => {
    const { nodes, edges } = fixture()
    const layout = layoutRequirementGraph(nodes, edges, 'layered')
    const handles = new Set<number>()
    for (const edge of layout.edges) {
      const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = (edge.path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number)
      expect(c1x).toBe(sx)
      expect(c2x).toBe(tx)
      expect(c1y).toBeGreaterThan(sy!)
      expect(c2y).toBeLessThan(ty!)
      expect(c1y).toBeLessThanOrEqual(c2y!)
      handles.add(Number((c1y! - sy!).toFixed(3)))
    }
    expect(handles.size).toBeGreaterThan(1)
  })

  it('places radial layers on successively larger rings', () => {
    const { nodes, edges } = fixture()
    const layout = layoutRequirementGraph(nodes, edges, 'radial')
    const ranges = layerKinds.map(kind => nodes.filter(node => node.kind === kind).map(node => radius(layout, node.key)))
    for (let index = 1; index < ranges.length; index += 1) {
      expect(Math.min(...ranges[index]!)).toBeGreaterThan(Math.max(...ranges[index - 1]!))
    }
    expect(layout.regions.every(region => region.variant === 'ring')).toBe(true)
  })

  it.each(REQUIREMENT_GRAPH_LAYOUT_MODES)('%s routes only drawable edges with finite SVG coordinates', (mode) => {
    const { nodes, edges } = fixture()
    const layout = layoutRequirementGraph(nodes, [...edges, { source: 'missing', target: nodes[0]!.key }], mode)
    expect(layout.edges).toHaveLength(edges.length)
    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M /u)
      expect(edge.path).not.toMatch(/NaN|Infinity/u)
      const numbers = edge.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu) ?? []
      expect(numbers.length).toBeGreaterThan(3)
      expect(numbers.map(Number).every(Number.isFinite)).toBe(true)
    }
  })

  it.each(REQUIREMENT_GRAPH_LAYOUT_MODES)('%s handles an empty visible graph', (mode) => {
    const layout = layoutRequirementGraph([], [], mode)
    expect(layout.positions.size).toBe(0)
    expect(layout.edges).toEqual([])
    expect(layout.regions).toHaveLength(4)
  })
})
