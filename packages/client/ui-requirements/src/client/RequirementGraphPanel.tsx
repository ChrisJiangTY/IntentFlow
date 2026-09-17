/** Progressively disclosed document → requirement → Task → code graph. */

import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsKey, NS } from './locales.ts'
import { focusedTraceKeys, type SessionRequirementGraph, type TraceNavigation } from './knowledge-graph.ts'
import { filterTraceRound, searchTrace, traceAncestors, traceNodes, visibleTraceKeys, type TraceNode } from './trace-exploration.ts'
import css from './RequirementGraphPanel.module.css'

interface RequirementGraphPanelProps {
  readonly graph: SessionRequirementGraph
  readonly onSelect: (node: TraceNavigation) => void
  readonly onOpenFile: (path: string) => boolean
  readonly t: TranslateNS<typeof NS>
}

const LAYERS = ['document', 'requirement', 'task', 'code'] as const
const LAYER_LABELS: Record<TraceNode['kind'], RequirementsKey> = {
  document: 'graph.documents', requirement: 'graph.requirements', task: 'graph.tasks', code: 'graph.code',
}
const NODE_WIDTH = 92
const NODE_HEIGHT = 72
const ORB_SIZE = 44
const NODE_GAP_X = 8
const NODE_GAP_Y = 4
const PLANE_GAP = 6
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function titleOf(node: TraceNode): string {
  return node.kind === 'task' ? node.task.title : node.kind === 'code' ? node.path.split(/[\\/]/u).at(-1) ?? node.path : node.title
}

function summaryOf(node: TraceNode): string {
  const title = titleOf(node).trim()
  const limit = node.kind === 'code' ? 14 : 10
  const characters = Array.from(GRAPHEME_SEGMENTER.segment(title), part => part.segment)
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : title
}

function statusOf(node: TraceNode, graph: SessionRequirementGraph): RequirementsKey | undefined {
  if (node.kind === 'task') return node.task.status === 'completed' ? 'graph.status.completed'
    : node.task.status === 'failed' ? 'graph.status.blocked'
      : node.task.status === 'in_progress' || node.task.status === 'reviewing' ? 'graph.status.in-progress' : 'graph.status.pending'
  if (node.kind !== 'requirement') return undefined
  const tasks = graph.tasks.filter(task => graph.edges.some(edge => edge.source === node.key && edge.target === task.key))
  return node.status === 'in-progress' && tasks.length > 0 && tasks.every(task => task.task.status === 'completed')
    ? 'graph.status.awaitingReview' : `graph.status.${node.status}`
}

function layoutTrace(nodes: readonly TraceNode[], availableWidth: number) {
  const width = Math.max(480, availableWidth)
  const columns = Math.max(2, Math.min(5, Math.floor((width - 60) / (NODE_WIDTH + NODE_GAP_X))))
  const positions = new Map<string, { x: number; y: number }>()
  let top = 12
  const planes = LAYERS.flatMap((kind, level) => {
    const members = nodes.filter(node => node.kind === kind)
    if (members.length === 0) return []
    const rows = Math.ceil(members.length / columns)
    const height = 38 + rows * NODE_HEIGHT + Math.max(0, rows - 1) * NODE_GAP_Y
    const plane = { kind, level, top, height, count: members.length }
    members.forEach((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const rowCount = Math.min(columns, members.length - row * columns)
      const rowWidth = rowCount * NODE_WIDTH + Math.max(0, rowCount - 1) * NODE_GAP_X
      positions.set(node.key, {
        x: (width - rowWidth) / 2 + column * (NODE_WIDTH + NODE_GAP_X),
        y: top + 28 + row * (NODE_HEIGHT + NODE_GAP_Y),
      })
    })
    top += height + PLANE_GAP
    return [plane]
  })
  return { width, height: Math.max(150, top + 2), positions, planes }
}

/**
 * Render ringed spherical nodes on perspective planes, initially showing only document roots.
 * @param props - Live graph, explicit Notebook/file actions, and localized copy.
 * @returns Searchable, independently expandable directed graph and evidence inspector.
 */
export function RequirementGraphPanel({ graph, onSelect, onOpenFile, t }: RequirementGraphPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string>()
  const [query, setQuery] = useState('')
  const [roundFilter, setRoundFilter] = useState('')
  const [zoom, setZoom] = useState(1)
  const [revealKey, setRevealKey] = useState<string>()
  const [fileError, setFileError] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 620, height: 450 })
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
  const markerId = useId().replace(/:/gu, '')
  const filtered = useMemo(() => filterTraceRound(graph, roundFilter), [graph, roundFilter])
  const all = useMemo(() => traceNodes(graph), [graph])
  const visible = useMemo(() => visibleTraceKeys(filtered, expanded, revealed), [filtered, expanded, revealed])
  const nodes = useMemo(() => traceNodes(filtered).filter(node => visible.has(node.key)), [filtered, visible])
  const layout = useMemo(() => layoutTrace(nodes, viewportSize.width - 20), [nodes, viewportSize.width])
  const fitScale = Math.min(1, viewportSize.width / layout.width, viewportSize.height / layout.height)
  const scale = fitScale * zoom
  const selectedNode = nodes.find(node => node.key === selected)
  const focused = focusedTraceKeys(filtered, selectedNode?.key)
  const results = useMemo(() => searchTrace(all, query), [all, query])
  const file = selectedNode?.kind === 'code' ? selectedNode : undefined
  const outgoing = (key: string) => filtered.edges.filter(edge => edge.source === key)

  useLayoutEffect(() => {
    const element = viewport.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  useLayoutEffect(() => {
    if (revealKey === undefined) return
    const position = layout.positions.get(revealKey)
    if (position === undefined) return
    viewport.current?.scrollTo({
      left: Math.max(0, position.x * scale - viewportSize.width / 3),
      top: Math.max(0, position.y * scale - viewportSize.height / 3), behavior: 'smooth',
    })
    setRevealKey(undefined)
  }, [layout, revealKey, scale, viewportSize])

  const toggle = (key: string): void => {
    const next = new Set(expanded)
    if (next.has(key)) {
      next.delete(key)
      const reachable = visibleTraceKeys(graph, next)
      setRevealed(new Set())
      setExpanded(new Set([...next].filter(value => reachable.has(value))))
    } else {
      next.add(key)
      setExpanded(next)
    }
  }
  const reveal = (node: TraceNode): void => {
    setRoundFilter('')
    const ancestors = traceAncestors(graph, node.key)
    setExpanded(current => new Set([...current, ...ancestors]))
    // Unassigned Tasks remain searchable without inventing requirement edges.
    const detached = [...ancestors, node.key].filter(key =>
      !graph.documents.some(document => document.key === key) && !graph.edges.some(edge => edge.target === key))
    setRevealed(current => new Set([...current, ...detached]))
    setSelected(node.key); setFileError(false); setRevealKey(node.key)
  }
  const collapseAll = (): void => {
    setExpanded(new Set()); setRevealed(new Set()); setSelected(undefined); setQuery(''); setZoom(1)
    viewport.current?.scrollTo({ top: 0, left: 0 })
  }
  const panStart = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.pointerType === 'touch' || (event.target instanceof Element && event.target.closest('button'))) return
    const element = event.currentTarget
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }
    element.setPointerCapture(event.pointerId)
  }
  const roundLabel = (node: TraceNode): string => {
    const ids = node.kind === 'code'
      ? new Set(graph.tasks.filter(task => node.changes.some(change => change.taskKey === task.key)).map(task => task.roundId))
      : new Set([node.roundId])
    return graph.documents.filter(document => ids.has(document.roundId)).map(document => t('round.label', { round: document.round })).join(' · ')
  }
  const ariaLabel = (node: TraceNode): string => node.kind === 'document' ? t('graph.documentAria', { round: node.round, title: node.title })
    : node.kind === 'requirement' ? t('graph.nodeAria', { round: node.round, requirement: node.requirementId, title: node.title, status: t(statusOf(node, graph) ?? 'graph.status.pending') })
      : node.kind === 'task' ? t('graph.taskAria', { title: node.task.title }) : t('graph.fileAria', { path: node.path })
  const nodeLabel = (node: TraceNode): string => node.kind === 'document' ? `D${node.round}`
    : node.kind === 'requirement' ? `R${node.requirementId}`
      : node.kind === 'task' ? `T${node.task.order + 1}` : `C${graph.files.findIndex(file => file.key === node.key) + 1}`

  return <section className={css.panel} role="region" aria-label={t('graph.aria')}>
    <div className={css.toolbar}>
      <span title={graph.title}>{graph.title || t('graph.currentSession')}</span>
      <button type="button" onClick={collapseAll}>{t('graph.collapseAll')}</button>
      <button type="button" onClick={() => {
        setZoom(1)
        viewport.current?.scrollTo({ top: 0, left: 0 })
      }}>{t('graph.fit')}</button>
      <button type="button" aria-label={t('graph.zoomOut')} disabled={zoom <= .05} onClick={() => { setZoom(value => Math.max(.05, value - .15)) }}>−</button>
      <button type="button" aria-label={t('graph.zoomIn')} disabled={zoom >= 2.5} onClick={() => { setZoom(value => Math.min(2.5, value + .15)) }}>＋</button>
    </div>
    <div className={css.searchBar}>
      <input type="search" aria-label={t('graph.search')} placeholder={t('graph.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      {query !== '' && <button type="button" onClick={() => { setQuery(''); setSelected(undefined) }}>{t('graph.clearSearch')}</button>}
      <select aria-label={t('graph.filterRound')} value={roundFilter} onChange={(event) => { setRoundFilter(event.target.value); setSelected(undefined) }}>
        <option value="">{t('graph.allRounds')}</option>
        {graph.documents.map(document => <option key={document.key} value={document.roundId}>{t('round.label', { round: document.round })} {document.title}</option>)}
      </select>
    </div>
    {query.trim() !== '' && <div className={css.searchResults} role="region" aria-label={t('graph.searchResults')}>
      <span role="status">{t('graph.resultCount', { count: results.length })}</span>
      {results.map(node => <button type="button" key={node.key} onClick={() => { reveal(node) }}>
        <small>{t(LAYER_LABELS[node.kind])} · {roundLabel(node)}</small><strong>{node.kind === 'code' ? node.path : titleOf(node)}</strong>
      </button>)}
    </div>}
    <div className={css.body}>
      <p className={css.intro}>{t('graph.expandHint')}</p>
      <div className={css.viewport} ref={viewport} tabIndex={0} aria-label={t('graph.canvas')}
        onPointerDown={panStart} onPointerMove={(event) => {
          if (drag.current === undefined) return
          event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x
          event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y
        }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}
        onLostPointerCapture={() => { drag.current = undefined }}>
        {graph.documents.length === 0 ? <div className={css.empty}><strong>{t('graph.emptyTitle')}</strong><p>{t('graph.emptyDetail')}</p></div>
          : <div style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className={css.canvas} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              <svg width={layout.width} height={layout.height} aria-hidden="true">
                <defs>
                  <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" className={css.arrow} /></marker>
                  <pattern id={`${markerId}-grid`} width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="skewX(-20)"><path d="M 26 0 L 0 0 0 26" className={css.gridLine} /></pattern>
                </defs>
                {layout.planes.map(plane => <g key={plane.kind} className={css.plane} data-layer={plane.kind}>
                  <path className={css.planeFill} d={`M 50 ${plane.top} H ${layout.width - 12} L ${layout.width - 44} ${plane.top + plane.height} H 12 Z`} />
                  <path fill={`url(#${markerId}-grid)`} d={`M 50 ${plane.top} H ${layout.width - 12} L ${layout.width - 44} ${plane.top + plane.height} H 12 Z`} />
                </g>)}
                {filtered.edges.filter(edge => expanded.has(edge.source) && visible.has(edge.source) && visible.has(edge.target))
                  .map((edge) => {
                    const source = layout.positions.get(edge.source)
                    const target = layout.positions.get(edge.target)
                    if (source === undefined || target === undefined) return null
                    const x1 = source.x + NODE_WIDTH / 2
                    const y1 = source.y + ORB_SIZE + 4
                    const x2 = target.x + NODE_WIDTH / 2
                    const y2 = target.y - 4
                    return <path key={`${edge.source}:${edge.target}`} className={css.edge} data-dimmed={!focused.has(edge.source) || !focused.has(edge.target)}
                      markerEnd={`url(#${markerId})`} d={`M ${x1} ${y1} C ${x1} ${y1 + 12}, ${x2} ${y2 - 12}, ${x2} ${y2}`} />
                  })}
              </svg>
              {layout.planes.map(plane => <div key={plane.kind} className={css.layerLabel} style={{ top: plane.top + 8, left: 58 }}>
                <span>{String(plane.level + 1).padStart(2, '0')}</span><strong>{t(LAYER_LABELS[plane.kind])}</strong><small>{plane.count}</small>
              </div>)}
              {nodes.map((node) => {
                const position = layout.positions.get(node.key)
                if (position === undefined) return null
                const children = outgoing(node.key).length
                const status = statusOf(node, graph)
                const title = titleOf(node)
                const summary = summaryOf(node)
                return <article key={node.key} className={css.node} data-layer={node.kind} data-node-key={node.key}
                  data-selected={selectedNode?.key === node.key} data-dimmed={!focused.has(node.key)} data-status={status}
                  style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>
                  <button type="button" className={css.nodeSelect} aria-label={ariaLabel(node)} aria-pressed={selectedNode?.key === node.key}
                    data-status={node.kind === 'requirement' ? node.status : node.kind === 'task' ? node.task.status : undefined}
                    title={node.kind === 'code' ? node.path : title} onClick={() => { setSelected(node.key); setFileError(false) }}>
                    <span className={css.orb} aria-hidden="true">{nodeLabel(node)}</span>
                    <strong>{summary}</strong>
                  </button>
                  {node.kind !== 'code' && <button type="button" className={css.expand} aria-label={t(expanded.has(node.key) ? 'graph.collapse' : 'graph.expand', { title })}
                    aria-expanded={expanded.has(node.key)} disabled={children === 0} onClick={() => { toggle(node.key) }}>
                    <span aria-hidden="true">{expanded.has(node.key) ? '−' : '+'}</span>
                  </button>}
                </article>
              })}
            </div>
          </div>}
      </div>
      {selectedNode !== undefined && <section className={css.detail} aria-label={t('graph.details')}>
        <header><small>{t(LAYER_LABELS[selectedNode.kind])} · {roundLabel(selectedNode)}</small><strong>{selectedNode.kind === 'code' ? selectedNode.path : titleOf(selectedNode)}</strong></header>
        {selectedNode.kind === 'document' && <><p>{t('graph.revision', { revision: selectedNode.revision })}</p><button type="button" onClick={() => { onSelect({ roundId: selectedNode.roundId, taskIds: [] }) }}>{t('graph.locateDocument')}</button></>}
        {selectedNode.kind === 'requirement' && <>
          <p>{t(statusOf(selectedNode, graph) ?? 'graph.status.pending')} · {t('graph.criteriaCount', { count: selectedNode.acceptanceRefs.length })} · {selectedNode.acceptanceRefs.join(', ')}</p>
          {outgoing(selectedNode.key).length === 0 && <p>{t('graph.noTasks')}</p>}
          <button type="button" onClick={() => { onSelect({ roundId: selectedNode.roundId, taskIds: [], requirementTitle: selectedNode.title }) }}>{t('graph.locateRequirement')}</button>
        </>}
        {selectedNode.kind === 'task' && <>
          <p>{t(statusOf(selectedNode, graph) ?? 'graph.status.pending')} · {selectedNode.task.summary}</p>
          {!graph.edges.some(edge => edge.target === selectedNode.key) && <p>{t('graph.unassigned')}</p>}
          {outgoing(selectedNode.key).length === 0 && <p>{t('graph.noChanges')}</p>}
          <button type="button" onClick={() => { onSelect({ roundId: selectedNode.roundId, taskIds: [selectedNode.task.id] }) }}>{t('graph.locateTask')}</button>
        </>}
        {file !== undefined && <>
          <p>{t('graph.changeCount', { count: file.changes.length })}</p>
          <button type="button" onClick={() => { setFileError(!onOpenFile(file.path)) }}>{t('graph.openFile')}</button>
          {fileError && <p role="alert">{t('graph.fileUnavailable')}</p>}
          {file.changes.map((change, index) => <details key={`${change.taskKey}:${change.seq}:${index}`} open={file.changes.length === 1}>
            <summary>{graph.tasks.find(node => node.key === change.taskKey)?.task.title} · {t('graph.turn', { turn: change.turn })}</summary>
            <span>{t('graph.before')}</span><pre>{change.oldText ?? t('graph.newFile')}</pre><span>{t('graph.after')}</span><pre>{change.newText}</pre>
          </details>)}
        </>}
      </section>}
      <p className={css.hint}>{t('graph.scopeHint')}</p>
    </div>
  </section>
}
