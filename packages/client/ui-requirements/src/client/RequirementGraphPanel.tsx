/** Progressively disclosed document → requirement → Task → code graph. */

import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsKey, NS } from './locales.ts'
import { focusedTraceKeys, type SessionRequirementGraph, type TraceNavigation } from './knowledge-graph.ts'
import {
  layoutRequirementGraph, type RequirementGraphLayoutMode,
} from './requirement-graph-layout.ts'
import { filterTraceRound, searchTrace, traceAncestors, traceNodes, visibleTraceKeys, type TraceNode } from './trace-exploration.ts'
import { graphNodeAssets } from './graph-node-assets.ts'
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
const LAYOUT_LABELS: Record<RequirementGraphLayoutMode, RequirementsKey> = {
  layered: 'graph.layout.layered', radial: 'graph.layout.radial',
}
const NODE_WIDTH = 92
const NODE_HEIGHT = 72
const ORB_SIZE = 52
const BASE_CANVAS_WIDTH = 588
const BASE_CANVAS_HEIGHT = 472

function titleOf(node: TraceNode): string {
  return node.kind === 'task' ? node.task.title : node.kind === 'code' ? node.path.split(/[\\/]/u).at(-1) ?? node.path : node.title
}

function requirementContent(graph: SessionRequirementGraph, node: TraceNode): string {
  if (node.kind !== 'requirement') return ''
  const source = graph.documents.find(document => document.roundId === node.roundId)?.markdown ?? ''
  const blocks = fromMarkdown(source).children
  const index = blocks.findIndex((block) => {
    if (block.type !== 'heading' || block.depth !== 3) return false
    const title = extractMarkdownPlainText(source.slice(block.position?.start.offset, block.position?.end.offset))
    return /^需求\s+(\d+)：/u.exec(title)?.[1] === node.requirementId
  })
  if (index < 0) return ''
  const next = blocks.slice(index + 1).find(block => block.type === 'heading' && block.depth <= 3)
  return source.slice(blocks[index]?.position?.end.offset, next?.position?.start.offset).trim()
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

/**
 * Explore one Session trace through layered and radial graph layouts.
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
  const [layoutMode, setLayoutMode] = useState<RequirementGraphLayoutMode>('layered')
  const nextLayout = layoutMode === 'layered' ? 'radial' : 'layered'
  const [revealKey, setRevealKey] = useState<string>()
  const [fileError, setFileError] = useState(false)
  const [detailPercent, setDetailPercent] = useState(30)
  const body = useRef<HTMLDivElement>(null)
  const resizing = useRef(false)
  const [viewportSize, setViewportSize] = useState({ width: BASE_CANVAS_WIDTH, height: BASE_CANVAS_HEIGHT })
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
  const markerId = useId().replace(/:/gu, '')
  const filtered = useMemo(() => filterTraceRound(graph, roundFilter), [graph, roundFilter])
  const all = useMemo(() => traceNodes(graph), [graph])
  const numbers = useMemo(() => new Map(LAYERS.flatMap(kind =>
    all.filter(node => node.kind === kind).map((node, index) => [node.key, index + 1] as const))), [all])
  const visible = useMemo(() => visibleTraceKeys(filtered, expanded, revealed), [filtered, expanded, revealed])
  const nodes = useMemo(() => traceNodes(filtered).filter(node => visible.has(node.key)), [filtered, visible])
  const visibleEdges = useMemo(() => filtered.edges.filter(edge => expanded.has(edge.source)
    && visible.has(edge.source) && visible.has(edge.target)), [expanded, filtered.edges, visible])
  const layout = useMemo(() => layoutRequirementGraph(nodes, visibleEdges, layoutMode), [layoutMode, nodes, visibleEdges])
  const nodesByKey = useMemo(() => new Map(nodes.map(node => [node.key, node])), [nodes])
  const fitScale = viewportSize.width / layout.width
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
    const element = viewport.current
    const left = Math.max(0, position.x * scale - viewportSize.width / 3)
    const top = Math.max(0, position.y * scale - viewportSize.height / 3)
    if (typeof element?.scrollTo === 'function') element.scrollTo({ left, top, behavior: 'smooth' })
    else if (element !== null) { element.scrollLeft = left; element.scrollTop = top }
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
  const notebookTarget: TraceNavigation | undefined = selectedNode === undefined ? undefined
    : selectedNode.kind === 'code' ? (() => {
      const owner = graph.tasks.find(task => selectedNode.changes.some(change => change.taskKey === task.key))
      return owner === undefined ? undefined : { roundId: owner.roundId, taskIds: [owner.task.id] }
    })() : { roundId: selectedNode.roundId, taskIds: selectedNode.kind === 'task' ? [selectedNode.task.id] : [],
      ...(selectedNode.kind === 'requirement' ? { requirementTitle: selectedNode.title } : {}) }

  return <section className={css.panel} role="region" aria-label={t('graph.aria')}>
    <div className={css.searchBar}>
      <input type="search" aria-label={t('graph.search')} placeholder={t('graph.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      {query !== '' && <button type="button" onClick={() => { setQuery(''); setSelected(undefined) }}>{t('graph.clearSearch')}</button>}
      <select aria-label={t('graph.filterRound')} value={roundFilter} onChange={(event) => { setRoundFilter(event.target.value); setSelected(undefined) }}>
        <option value="">{t('graph.allRounds')}</option>
        {graph.documents.map(document => <option key={document.key} value={document.roundId}>{t('round.label', { round: document.round })} {document.title}</option>)}
      </select>
      <button type="button" className={css.expandAll} disabled={traceNodes(filtered).length === 0} onClick={() => {
        const keys = traceNodes(filtered).map(node => node.key)
        setExpanded(current => new Set([...current, ...keys]))
        setRevealed(current => new Set([...current, ...keys]))
      }}>{t('toolbar.expandAll')}</button>
    </div>
    {query.trim() !== '' && <div className={css.searchResults} role="region" aria-label={t('graph.searchResults')}>
      <span role="status">{t('graph.resultCount', { count: results.length })}</span>
      {results.map(node => <button type="button" key={node.key} onClick={() => { reveal(node) }}>
        <small>{t(LAYER_LABELS[node.kind])} · {roundLabel(node)}</small><strong>{node.kind === 'code' ? node.path : titleOf(node)}</strong>
      </button>)}
    </div>}
    <div className={css.body} ref={body}>
      <div className={css.graphArea}>
        <div className={css.graphControls}>
          <button type="button" className={css.layoutToggle} aria-label={t('graph.layout')} aria-pressed={layoutMode === 'radial'}
            title={t('graph.layoutHint', { current: t(LAYOUT_LABELS[layoutMode]), next: t(LAYOUT_LABELS[nextLayout]) })}
            onClick={() => {
              setLayoutMode(nextLayout)
              if (selected !== undefined) setRevealKey(selected)
              else if (viewport.current !== null) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 }
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              {layoutMode === 'layered'
                ? <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>
                : <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>}
            </svg>
          </button>
          <div className={css.zoomControls}>
            <button type="button" aria-label={t('graph.zoomOut')} disabled={zoom <= .05} onClick={() => { setZoom(value => Math.max(.05, value - .15)) }}>−</button>
            <button type="button" aria-label={t('graph.zoomIn')} disabled={zoom >= 2.5} onClick={() => { setZoom(value => Math.min(2.5, value + .15)) }}>＋</button>
          </div>
        </div>
        <div className={css.viewport} ref={viewport} tabIndex={0} aria-label={t('graph.canvas')} data-layout-mode={layoutMode}
          onPointerDown={panStart} onPointerMove={(event) => {
            if (drag.current === undefined) return
            event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x
            event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y
          }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}
          onLostPointerCapture={() => { drag.current = undefined }}>
          <div style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className={css.canvas} data-layout-mode={layoutMode} data-has-selection={selectedNode !== undefined}
              style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              <svg width={layout.width} height={layout.height} aria-hidden="true">
                <defs>
                  {LAYERS.map(kind => <marker key={kind} id={`${markerId}-${kind}`} className={css.marker} data-layer={kind} viewBox="0 0 10 10"
                    refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className={css.arrow} />
                  </marker>)}
                  <pattern id={`${markerId}-grid`} width="116" height="38" patternUnits="userSpaceOnUse" patternTransform="skewX(-45)"><path d="M 116 0 L 0 0 0 38" className={css.gridLine} /></pattern>
                </defs>
                {layout.regions.map(region => <g key={region.kind} className={css.region} data-layer={region.kind}
                  data-region-variant={region.variant}>
                  <path className={css.regionFill} fillRule="evenodd" clipRule="evenodd" d={region.path} />
                  {region.variant === 'plane' && <path className={css.regionGrid} fill={`url(#${markerId}-grid)`} d={region.path} />}
                </g>)}
                {layout.edges.map((edge) => {
                  const source = nodesByKey.get(edge.source)
                  if (source === undefined) return null
                  return <path key={`${edge.source}:${edge.target}`} className={css.edge} data-layer={source.kind}
                    data-dimmed={!focused.has(edge.source) || !focused.has(edge.target)}
                    markerEnd={`url(#${markerId}-${source.kind})`} d={edge.path} />
                })}
              </svg>
              {layout.regions.map(region => <div key={region.kind} className={css.layerLabel} data-layer={region.kind}
                data-region-variant={region.variant} style={{ top: region.labelY, left: region.labelX }}>
                <span>{String(region.level + 1).padStart(2, '0')}</span><strong>{t(LAYER_LABELS[region.kind])}</strong><small>{region.count}</small>
              </div>)}
              {nodes.map((node) => {
                const position = layout.positions.get(node.key)
                if (position === undefined) return null
                const children = outgoing(node.key).length
                const status = statusOf(node, graph)
                const title = titleOf(node)
                return <article key={node.key} className={css.node} data-layer={node.kind} data-node-key={node.key}
                  data-selected={selectedNode?.key === node.key} data-dimmed={!focused.has(node.key)} data-status={status}
                  style={{ left: position.x - NODE_WIDTH * position.scale / 2, top: position.y - ORB_SIZE * position.scale / 2,
                    width: NODE_WIDTH, height: NODE_HEIGHT, scale: String(position.scale) }}>
                  <button type="button" className={css.nodeSelect} aria-label={ariaLabel(node)} aria-pressed={selectedNode?.key === node.key}
                    data-status={node.kind === 'requirement' ? node.status : node.kind === 'task' ? node.task.status : undefined}
                    title={node.kind === 'code' ? node.path : title} onClick={() => { setSelected(node.key); setFileError(false) }}>
                    <span className={css.orb} aria-hidden="true">
                      <img className={css.ringImage} src={graphNodeAssets[node.kind].ring} alt="" draggable={false} />
                      <img className={css.orbImage} src={graphNodeAssets[node.kind].orb} alt="" draggable={false} />
                      <span className={css.nodeNumber}>{numbers.get(node.key)}</span>
                    </span>
                  </button>
                  {node.kind !== 'code' && <button type="button" className={css.expand} aria-label={t(expanded.has(node.key) ? 'graph.collapse' : 'graph.expand', { title })}
                    aria-expanded={expanded.has(node.key)} disabled={children === 0} onClick={() => { toggle(node.key) }}>
                    <span aria-hidden="true">{expanded.has(node.key) ? '−' : '+'}</span>
                  </button>}
                </article>
              })}
            </div>
          </div>
        </div>
      </div>
      <div className={css.resizeHandle} role="separator" tabIndex={0} aria-orientation="horizontal"
        aria-label={t('graph.resizeDetails')} aria-valuemin={15} aria-valuemax={60} aria-valuenow={Math.round(detailPercent)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          resizing.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }} onPointerMove={(event) => {
          if (!resizing.current || body.current === null) return
          const bounds = body.current.getBoundingClientRect()
          if (bounds.height > 0) setDetailPercent(Math.min(60, Math.max(15, (bounds.bottom - event.clientY) / bounds.height * 100)))
        }} onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }}
        onLostPointerCapture={() => { resizing.current = false }} onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          setDetailPercent(value => event.key === 'Home' ? 15 : event.key === 'End' ? 60
            : Math.min(60, Math.max(15, value + (event.key === 'ArrowUp' ? 5 : -5))))
        }} />
      <div className={css.detailSlot} style={{ flexBasis: `${detailPercent}%` }}>
        {graph.documents.length === 0 && <div className={css.empty}><strong>{t('graph.emptyTitle')}</strong><p>{t('graph.emptyDetail')}</p></div>}
        {selectedNode !== undefined && <section className={css.detail} aria-label={t('graph.details')}>
          <nav className={css.detailActions}>
            <button type="button" disabled={notebookTarget === undefined} onClick={() => { if (notebookTarget !== undefined) onSelect(notebookTarget) }}>{t('graph.locateNotebook')}</button>
          </nav>
          <div className={css.detailContent}>
            <header><small>{t(LAYER_LABELS[selectedNode.kind])} · {roundLabel(selectedNode)}</small><strong>{selectedNode.kind === 'code' ? <a href="#" aria-label={t('graph.openFile')} onClick={(event) => { event.preventDefault(); setFileError(!onOpenFile(selectedNode.path)) }}>{selectedNode.path}</a> : titleOf(selectedNode)}</strong></header>
            {selectedNode.kind === 'document' && <><p>{t('graph.revision', { revision: selectedNode.revision })}</p><div className={css.documentContent}>{selectedNode.markdown}</div></>}
            {selectedNode.kind === 'requirement' && <>
              <p>{t(statusOf(selectedNode, graph) ?? 'graph.status.pending')} · {t('graph.criteriaCount', { count: selectedNode.acceptanceRefs.length })} · {selectedNode.acceptanceRefs.join(', ')}</p>
              <div className={css.documentContent}>{requirementContent(graph, selectedNode)}</div>
              {outgoing(selectedNode.key).length === 0 && <p>{t('graph.noTasks')}</p>}
            </>}
            {selectedNode.kind === 'task' && <>
              <p>{t(statusOf(selectedNode, graph) ?? 'graph.status.pending')} · {selectedNode.task.summary}</p>
              <div className={css.documentContent}>{selectedNode.task.statement}</div>
              {!graph.edges.some(edge => edge.target === selectedNode.key) && <p>{t('graph.unassigned')}</p>}
              {outgoing(selectedNode.key).length === 0 && <p>{t('graph.noChanges')}</p>}
            </>}
            {file !== undefined && <>
              <p>{t('graph.changeCount', { count: file.changes.length })}</p>
              {fileError && <p role="alert">{t('graph.fileUnavailable')}</p>}
              {file.changes.map((change, index) => <details key={`${change.taskKey}:${change.seq}:${index}`} open={file.changes.length === 1}>
                <summary>{graph.tasks.find(node => node.key === change.taskKey)?.task.title} · {t('graph.turn', { turn: change.turn })}</summary>
                <span>{t('graph.before')}</span><pre>{change.oldText ?? t('graph.newFile')}</pre><span>{t('graph.after')}</span><pre>{change.newText}</pre>
              </details>)}
            </>}
          </div>
        </section>}
      </div>
    </div>
  </section>
}
