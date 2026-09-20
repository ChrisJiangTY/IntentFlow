/** Deterministic presentation layouts for the four-layer requirement trace graph. */

import type { TraceEdge } from './knowledge-graph.ts'
import type { TraceNode } from './trace-exploration.ts'

const LAYERS = ['document', 'requirement', 'task', 'code'] as const
const ORB_SIZE = 52
const TAU = Math.PI * 2

type TraceKind = TraceNode['kind']

/** Layouts offered by the requirement graph view. */
export const REQUIREMENT_GRAPH_LAYOUT_MODES = ['layered', 'radial'] as const

/** One selectable requirement graph arrangement. */
export type RequirementGraphLayoutMode = typeof REQUIREMENT_GRAPH_LAYOUT_MODES[number]

/** Center-based placement of one rendered graph node. */
export interface RequirementGraphLayoutPosition {
  readonly x: number
  readonly y: number
  readonly scale: number
}

/** Background region and label anchor for one semantic graph layer. */
export interface RequirementGraphLayoutRegion {
  readonly kind: TraceKind
  readonly level: number
  readonly count: number
  readonly variant: 'plane' | 'ring'
  readonly path: string
  readonly labelX: number
  readonly labelY: number
}

/** One visible directed edge with its layout-specific SVG path. */
export interface RequirementGraphLayoutEdge extends TraceEdge {
  readonly path: string
}

/** Complete geometry for one requirement graph rendering mode. */
export interface RequirementGraphLayout {
  readonly mode: RequirementGraphLayoutMode
  readonly width: number
  readonly height: number
  readonly positions: ReadonlyMap<string, RequirementGraphLayoutPosition>
  readonly regions: readonly RequirementGraphLayoutRegion[]
  readonly edges: readonly RequirementGraphLayoutEdge[]
}

interface LayoutGeometry {
  readonly width: number
  readonly height: number
  readonly positions: Map<string, RequirementGraphLayoutPosition>
  readonly regions: RequirementGraphLayoutRegion[]
}

function assertNever(value: never): never {
  throw new Error(`Unknown requirement graph layout: ${String(value)}`)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function polarPoint(centerX: number, centerY: number, radius: number, angle: number): { x: number; y: number } {
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }
}

function fullRingPath(centerX: number, centerY: number, innerRadius: number, outerRadius: number): string {
  const outer = `M ${centerX + outerRadius} ${centerY} A ${outerRadius} ${outerRadius} 0 1 1 ${centerX - outerRadius} ${centerY} A ${outerRadius} ${outerRadius} 0 1 1 ${centerX + outerRadius} ${centerY} Z`
  if (innerRadius <= 0) return outer
  const inner = `M ${centerX + innerRadius} ${centerY} A ${innerRadius} ${innerRadius} 0 1 0 ${centerX - innerRadius} ${centerY} A ${innerRadius} ${innerRadius} 0 1 0 ${centerX + innerRadius} ${centerY} Z`
  return `${outer} ${inner}`
}

function orderedByAdjacency(nodes: readonly TraceNode[], edges: readonly TraceEdge[]): ReadonlyMap<TraceKind, readonly TraceNode[]> {
  const baseRank = new Map(nodes.map((node, index) => [node.key, index]))
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? []
    sources.push(edge.source)
    incoming.set(edge.target, sources)
  }
  const result = new Map<TraceKind, readonly TraceNode[]>()
  for (const [level, kind] of LAYERS.entries()) {
    const members = nodes.filter(node => node.kind === kind)
    if (level === 0) {
      result.set(kind, members)
      continue
    }
    const parentKind = LAYERS.at(level - 1) ?? 'document'
    const parents = result.get(parentKind) ?? []
    const parentRank = new Map(parents.map((node, index) => [node.key, index]))
    const score = (node: TraceNode): number | undefined => {
      const ranks = (incoming.get(node.key) ?? []).flatMap((key) => {
        const rank = parentRank.get(key)
        return rank === undefined ? [] : [rank]
      })
      return ranks.length === 0 ? undefined : ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length
    }
    const sorted = [...members].sort((left, right) => {
      const leftScore = score(left)
      const rightScore = score(right)
      if (leftScore === undefined && rightScore !== undefined) return 1
      if (leftScore !== undefined && rightScore === undefined) return -1
      if (leftScore !== undefined && rightScore !== undefined && leftScore !== rightScore) return leftScore - rightScore
      return (baseRank.get(left.key) ?? 0) - (baseRank.get(right.key) ?? 0)
    })
    result.set(kind, sorted)
  }
  return result
}

function layeredLayout(nodes: readonly TraceNode[]): LayoutGeometry {
  const width = 588
  const height = 472
  const planeGap = 12
  const planeHeight = 104
  const maximumColumns = 15
  const depthStart = 22
  const depthSpan = 80
  const horizontalSpan = 400
  const positions = new Map<string, RequirementGraphLayoutPosition>()
  const regions = LAYERS.map((kind, level) => {
    const members = nodes.filter(node => node.kind === kind)
    const top = 6 + level * (planeHeight + planeGap)
    const rows = Math.max(1, Math.ceil(members.length / maximumColumns))
    const columns = Math.max(1, Math.ceil(members.length / rows))
    const scale = Math.min(rows === 1 ? 1 : .65,
      horizontalSpan / (Math.max(1, columns - 1) * 44), 76 / (rows * ORB_SIZE))
    members.forEach((node, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const rowCount = Math.min(columns, members.length - row * columns)
      const spacing = Math.min(100, horizontalSpan / Math.max(1, rowCount - 1))
      const depth = depthStart + (row + 0.5) * depthSpan / rows
      positions.set(node.key, {
        x: width / 2 - 10 + (column - (rowCount - 1) / 2) * spacing - (depth - 62) * .15,
        y: top + depth,
        scale,
      })
    })
    return {
      kind,
      level,
      count: members.length,
      variant: 'plane' as const,
      path: `M 112 ${top} H ${width - 8} L ${width - 112} ${top + planeHeight} H 8 Z`,
      labelX: 60,
      labelY: top + 2,
    }
  })
  return { width, height, positions, regions }
}

function ringScale(radius: number, count: number, minimum: number): number {
  if (count <= 1) return 1
  return clamp(TAU * radius / (count * 68), minimum, 1)
}

function radialLayout(nodes: readonly TraceNode[], edges: readonly TraceEdge[]): LayoutGeometry {
  const width = 800
  const height = 800
  const centerX = width / 2
  const centerY = height / 2
  const radii: Record<TraceKind, number> = { document: 52, requirement: 145, task: 245, code: 345 }
  const boundaries = [0, 96, 195, 295, 390]
  const ordered = orderedByAdjacency(nodes, edges)
  const positions = new Map<string, RequirementGraphLayoutPosition>()
  const regions = LAYERS.map((kind, level) => {
    const members = ordered.get(kind) ?? []
    const radius = kind === 'document' && members.length <= 1 ? 0 : radii[kind]
    const scale = ringScale(Math.max(radius, 52), members.length, 0.34)
    members.forEach((node, index) => {
      const angle = members.length === 1 ? -Math.PI / 2 : -Math.PI / 2 + TAU * index / members.length
      const point = polarPoint(centerX, centerY, radius, angle)
      positions.set(node.key, { ...point, scale })
    })
    return {
      kind,
      level,
      count: members.length,
      variant: 'ring' as const,
      path: fullRingPath(centerX, centerY, boundaries[level] ?? 0, boundaries[level + 1] ?? 390),
      labelX: 22,
      labelY: 30 + level * 28,
    }
  })
  return { width, height, positions, regions }
}

function pointToward(
  from: RequirementGraphLayoutPosition, to: RequirementGraphLayoutPosition | { x: number; y: number }, distance: number,
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.max(0.001, Math.hypot(dx, dy))
  return { x: from.x + dx / length * distance, y: from.y + dy / length * distance }
}

function edgePath(
  mode: RequirementGraphLayoutMode, width: number, height: number,
  source: RequirementGraphLayoutPosition, target: RequirementGraphLayoutPosition,
): string {
  switch (mode) {
    case 'layered': {
      const startY = source.y + ORB_SIZE * source.scale / 2
      const endY = target.y - (ORB_SIZE / 2 - 4) * target.scale
      const handle = Math.max(0, endY - startY) * .48
      return `M ${source.x} ${startY} C ${source.x} ${startY + handle}, ${target.x} ${endY - handle}, ${target.x} ${endY}`
    }
    case 'radial': {
      const start = pointToward(source, target, ORB_SIZE * source.scale / 2)
      const end = pointToward(target, source, ORB_SIZE * target.scale / 2 + 3)
      const centerX = width / 2
      const centerY = height / 2
      const sourceRadius = Math.hypot(source.x - centerX, source.y - centerY)
      const targetRadius = Math.hypot(target.x - centerX, target.y - centerY)
      const sourceAngle = sourceRadius < 1 ? Math.atan2(target.y - centerY, target.x - centerX)
        : Math.atan2(source.y - centerY, source.x - centerX)
      const targetAngle = Math.atan2(target.y - centerY, target.x - centerX)
      const middleRadius = (sourceRadius + targetRadius) / 2
      const first = polarPoint(centerX, centerY, middleRadius, sourceAngle)
      const second = polarPoint(centerX, centerY, middleRadius, targetAngle)
      return `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`
    }
    default: return assertNever(mode)
  }
}

/**
 * Arrange the visible Session trace without changing graph identity or disclosure state.
 * @param nodes - Visible graph nodes in stable trace order.
 * @param edges - Visible directed edges after Session, round, and disclosure filtering.
 * @param mode - Selected presentation layout.
 * @returns Canvas, node, background, and routed-edge geometry for the selected layout.
 */
export function layoutRequirementGraph(
  nodes: readonly TraceNode[], edges: readonly TraceEdge[], mode: RequirementGraphLayoutMode,
): RequirementGraphLayout {
  let geometry: LayoutGeometry
  switch (mode) {
    case 'layered': geometry = layeredLayout(nodes); break
    case 'radial': geometry = radialLayout(nodes, edges); break
    default: return assertNever(mode)
  }
  const routedEdges = edges.flatMap((edge): RequirementGraphLayoutEdge[] => {
    const source = geometry.positions.get(edge.source)
    const target = geometry.positions.get(edge.target)
    return source === undefined || target === undefined ? [] : [{
      ...edge,
      path: edgePath(mode, geometry.width, geometry.height, source, target),
    }]
  })
  return { mode, ...geometry, edges: routedEdges }
}
