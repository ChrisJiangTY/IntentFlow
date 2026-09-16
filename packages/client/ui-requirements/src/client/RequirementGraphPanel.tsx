/** Session-local requirement → Task → recorded code-change graph. */

import { useRef, useState } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsKey, NS } from './locales.ts'
import { focusedTraceKeys, type SessionRequirementGraph, type SessionRequirementNode } from './knowledge-graph.ts'
import css from './RequirementsView.module.css'

interface RequirementGraphPanelProps {
  readonly graph: SessionRequirementGraph
  readonly onClose: () => void
  readonly onSelect: (node: SessionRequirementNode) => void
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render fixed layers with path focusing and an inline historical code inspector.
 * @param props - Session graph, local Notebook navigation, and translated labels.
 * @returns The replacement requirement graph panel.
 */
export function RequirementGraphPanel({ graph, onClose, onSelect, t }: RequirementGraphPanelProps) {
  const [selected, setSelected] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState<number>()
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number; width: number }>()
  const resize = (next: number): void => {
    const available = panel.current?.parentElement?.getBoundingClientRect().width ?? 660
    setWidth(Math.max(Math.min(280, available), Math.min(next, available * .9)))
  }
  const all = [...graph.requirements, ...graph.tasks, ...graph.files]
  const selectedKey = all.some(node => node.key === selected) ? selected : undefined
  const focused = focusedTraceKeys(graph, selectedKey)
  const positions = new Map<string, { x: number; y: number }>()
  const columns = [graph.requirements, graph.tasks, graph.files]
  columns.forEach((nodes, column) => {
    nodes.forEach((node, row) => { positions.set(node.key, { x: 16 + column * 210, y: 46 + row * 94 }) })
  })
  const height = Math.max(240, 60 + Math.max(...columns.map(nodes => nodes.length)) * 94)
  const file = graph.files.find(node => node.key === selectedKey)
  const task = graph.tasks.find(node => node.key === selectedKey)
  const requirement = graph.requirements.find(node => node.key === selectedKey)
  const focus = (key: string): void => { setSelected(current => current === key ? undefined : key) }
  const taskState = (status: string): RequirementsKey => status === 'completed' ? 'graph.status.completed'
    : status === 'failed' ? 'graph.status.blocked'
      : status === 'in_progress' || status === 'reviewing' ? 'graph.status.in-progress' : 'graph.status.pending'
  return (
    <aside ref={panel} className={css.graphPanel} aria-label={t('graph.aria')} style={width === undefined ? undefined : { width, flexBasis: width }}>
      <div className={css.graphResize} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('graph.resize')}
        aria-valuenow={Math.round(width ?? 660)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? 660 }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={(event) => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX) }}
        onPointerUp={(event) => { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId) }}
        onLostPointerCapture={() => { drag.current = undefined }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          resize((panel.current?.getBoundingClientRect().width ?? 660) + (event.key === 'ArrowLeft' ? 32 : -32))
        }} />
      <header className={css.graphHeader}>
        <div><strong>{t('graph.title')}</strong><span>{graph.title || t('graph.currentSession')}</span></div>
        <button type="button" aria-label={t('graph.close')} onClick={onClose}><IconCloseOutline16 size={14} /></button>
      </header>
      <div className={css.traceControls}>
        <span>{t('graph.currentSession')}</span>
        <button type="button" onClick={() => { setSelected(undefined); setZoom(1) }}>{t('graph.reset')}</button>
        <button type="button" aria-label={t('graph.zoomOut')} disabled={zoom <= .6} onClick={() => { setZoom(value => Math.max(.6, value - .1)) }}>−</button>
        <button type="button" aria-label={t('graph.zoomIn')} disabled={zoom >= 1.4} onClick={() => { setZoom(value => Math.min(1.4, value + .1)) }}>＋</button>
      </div>
      <div className={css.graphBody}>
        {graph.requirements.length === 0 ? (
          <div className={css.graphEmpty}><strong>{t('graph.emptyTitle')}</strong><p>{t('graph.emptyDetail')}</p></div>
        ) : (
          <div className={css.traceViewport}>
            <div style={{ width: 646 * zoom, height: height * zoom }}>
              <div className={css.traceCanvas} style={{ width: 646, height, transform: `scale(${zoom})` }}>
                {(['graph.requirements', 'graph.tasks', 'graph.code'] as const).map((label, index) => (
                  <strong className={css.traceColumn} key={label} style={{ left: 16 + index * 210 }}>{t(label)}</strong>
                ))}
                <svg width="646" height={height} aria-hidden>
                  {graph.edges.map((edge) => {
                    const source = positions.get(edge.source)
                    const target = positions.get(edge.target)
                    if (source === undefined || target === undefined) return null
                    const x = source.x + 172
                    return <path key={`${edge.source}:${edge.target}`} data-dimmed={!focused.has(edge.source) || !focused.has(edge.target)}
                      d={`M ${x} ${source.y + 36} C ${x + 22} ${source.y + 36}, ${target.x - 22} ${target.y + 36}, ${target.x} ${target.y + 36}`} />
                  })}
                </svg>
                {all.map((node) => {
                  const position = positions.get(node.key)
                  if (position === undefined) return null
                  const req = 'requirementId' in node ? node : undefined
                  const work = 'task' in node ? node.task : undefined
                  const code = 'path' in node ? node : undefined
                  const title = req?.title ?? work?.title ?? code?.path.split(/[\\/]/u).at(-1) ?? ''
                  const label = req ? t('graph.nodeAria', { round: req.round, requirement: req.requirementId, title, status: t(`graph.status.${req.status}`) })
                    : work ? t('graph.taskAria', { title }) : t('graph.fileAria', { path: code?.path ?? '' })
                  return <button type="button" key={node.key} className={css.traceNode} aria-label={label} aria-pressed={selectedKey === node.key}
                    data-layer={req ? 'requirement' : work ? 'task' : 'code'} data-status={req?.status} data-dimmed={!focused.has(node.key)}
                    style={{ left: position.x, top: position.y }} title={code?.path ?? title}
                    onClick={() => { focus(node.key); if (req) onSelect(req) }}>
                    <small>{req ? `${t('round.label', { round: req.round })} · ${t('graph.requirementCode', { requirement: req.requirementId })}`
                      : work ? work.id : t('graph.recorded')}</small>
                    <strong>{title}</strong>
                    <span>{req ? t(`graph.status.${req.status}`) : work ? t(taskState(work.status)) : t('graph.changeCount', { count: code?.changes.length ?? 0 })}</span>
                  </button>
                })}
              </div>
            </div>
          </div>
        )}
        <p className={css.traceHint}>{t('graph.scopeHint')}</p>
        {requirement && <section className={css.traceDetail}>
          <strong>{requirement.title}</strong><p>{t('graph.criteriaCount', { count: requirement.acceptanceRefs.length })} · {requirement.acceptanceRefs.join(', ')}</p>
          {!graph.edges.some(edge => edge.source === requirement.key) && <p>{t('graph.noTasks')}</p>}
        </section>}
        {task && <section className={css.traceDetail}>
          <strong>{task.task.title}</strong><p>{task.task.summary}</p>
          {!graph.edges.some(edge => edge.source === task.key) && <p>{t('graph.noChanges')}</p>}
          <button type="button" onClick={() => {
            const owner = graph.requirements.find(node => graph.edges.some(edge => edge.source === node.key && edge.target === task.key))
            if (owner) onSelect({ ...owner, taskIds: [task.task.id] })
          }} disabled={!graph.edges.some(edge => edge.target === task.key)}>{t('graph.locateTask')}</button>
        </section>}
        {file && <section className={css.traceDetail}>
          <strong>{file.path}</strong>
          {file.changes.map((change, index) => <details key={`${change.seq}:${index}`} open={file.changes.length === 1}>
            <summary>{graph.tasks.find(node => node.key === change.taskKey)?.task.title} · {t('graph.turn', { turn: change.turn })}</summary>
            <span>{t('graph.before')}</span><pre>{change.oldText ?? t('graph.newFile')}</pre>
            <span>{t('graph.after')}</span><pre>{change.newText}</pre>
          </details>)}
        </section>}
      </div>
    </aside>
  )
}
