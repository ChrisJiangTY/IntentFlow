/** Collapsible Workspace requirement graph presentation. */

import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementsKey, NS } from './locales.ts'
import type {
  WorkspaceRequirementGraph,
  WorkspaceRequirementNode,
  WorkspaceRequirementRelation,
  WorkspaceRequirementSession,
} from './knowledge-graph.ts'
import css from './RequirementsView.module.css'

interface NodePosition {
  readonly x: number
  readonly y: number
}

interface GraphLayout {
  readonly width: number
  readonly height: number
  readonly rounds: readonly { readonly id: string; readonly round: number; readonly summary: string; readonly x: number }[]
  readonly positions: ReadonlyMap<string, NodePosition>
}

const NODE_WIDTH = 176
const NODE_HEIGHT = 62
const ROUND_GAP = 206
const NODE_GAP = 82

function graphLayout(lane: WorkspaceRequirementSession): GraphLayout {
  const byRound = new Map<string, WorkspaceRequirementNode[]>()
  for (const node of lane.nodes) {
    const list = byRound.get(String(node.roundId)) ?? []
    list.push(node)
    byRound.set(String(node.roundId), list)
  }
  const rounds = [...byRound.entries()].map(([id, nodes], index) => ({
    id,
    round: nodes[0]?.round ?? index + 1,
    summary: nodes[0]?.roundSummary ?? '',
    x: 18 + index * ROUND_GAP,
    nodes,
  }))
  const positions = new Map<string, NodePosition>()
  let maximum = 0
  for (const round of rounds) {
    maximum = Math.max(maximum, round.nodes.length)
    round.nodes.forEach((node, index) => {
      positions.set(node.key, { x: round.x, y: 46 + index * NODE_GAP })
    })
  }
  return {
    width: Math.max(320, rounds.length * ROUND_GAP + 6),
    height: Math.max(150, 54 + maximum * NODE_GAP),
    rounds: rounds.map(({ id, round, summary, x }) => ({ id, round, summary, x })),
    positions,
  }
}

function relationPath(source: NodePosition, target: NodePosition): string {
  const sourceX = source.x + NODE_WIDTH / 2
  const sourceY = source.y + NODE_HEIGHT / 2
  const targetX = target.x + NODE_WIDTH / 2
  const targetY = target.y + NODE_HEIGHT / 2
  if (sourceX === targetX) {
    const bend = sourceX + NODE_WIDTH / 2 + 18
    return ['M', sourceX, sourceY, 'C', bend, sourceY, bend, targetY, targetX, targetY].join(' ')
  }
  const middle = (sourceX + targetX) / 2
  return ['M', sourceX, sourceY, 'C', middle, sourceY, middle, targetY, targetX, targetY].join(' ')
}

function relationKey(kind: WorkspaceRequirementRelation['kind']): RequirementsKey {
  switch (kind) {
    case 'depends-on': return 'graph.relation.dependsOn'
    case 'refines': return 'graph.relation.refines'
    case 'supersedes': return 'graph.relation.supersedes'
  }
}

interface RequirementGraphPanelProps {
  readonly graph: WorkspaceRequirementGraph
  readonly currentSessionId: WorkspaceRequirementNode['sessionId']
  readonly onClose: () => void
  readonly onSelect: (node: WorkspaceRequirementNode) => void
  readonly t: TranslateNS<typeof NS>
}

/**
 * Render the current Workspace's graph with one horizontal round lane per Session.
 * @param props - Graph data, active Session, navigation action, close action, and localized copy.
 * @returns the collapsible graph sidebar.
 */
export function RequirementGraphPanel({ graph, currentSessionId, onClose, onSelect, t }: RequirementGraphPanelProps) {
  const nodesByKey = new Map(graph.nodes.map(node => [node.key, node]))
  return (
    <aside className={css.graphPanel} aria-label={t('graph.aria')}>
      <header className={css.graphHeader}>
        <div>
          <strong>{t('graph.title')}</strong>
          <span>{graph.workspaceTitle ?? t('graph.currentProject')}</span>
        </div>
        <button type="button" aria-label={t('graph.close')} onClick={onClose}><IconCloseOutline16 size={14} /></button>
      </header>
      <div className={css.graphLegend} aria-label={t('graph.legend')}>
        {(['pending', 'in-progress', 'verified', 'blocked'] as const).map(status => (
          <span key={status}><i data-status={status} />{t(`graph.status.${status}`)}</span>
        ))}
      </div>
      <div className={css.graphBody}>
        {graph.sessions.length === 0 ? (
          <div className={css.graphEmpty}>
            <span aria-hidden>⌘</span>
            <strong>{t('graph.emptyTitle')}</strong>
            <p>{t('graph.emptyDetail')}</p>
          </div>
        ) : graph.sessions.map((lane, laneIndex) => {
          const layout = graphLayout(lane)
          const laneRelations = graph.relations.filter(relation => layout.positions.has(relation.sourceKey)
            && layout.positions.has(relation.targetKey))
          const markerId = `requirement-graph-arrow-${laneIndex}`
          return (
            <section className={css.graphSession} key={lane.sessionId}>
              <h3>{lane.title}{lane.sessionId === currentSessionId && <small>{t('graph.currentSession')}</small>}</h3>
              <div className={css.graphViewport}>
                <div className={css.graphCanvas} style={{ width: layout.width, height: layout.height }}>
                  <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} aria-hidden>
                    <defs>
                      <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" />
                      </marker>
                    </defs>
                    {laneRelations.map((relation) => {
                      const source = layout.positions.get(relation.sourceKey)
                      const target = layout.positions.get(relation.targetKey)
                      if (source === undefined || target === undefined) return null
                      return <path key={relation.key} d={relationPath(source, target)} data-kind={relation.kind} markerEnd={`url(#${markerId})`} />
                    })}
                  </svg>
                  {layout.rounds.map(round => (
                    <div className={css.graphRoundLabel} key={round.id} style={{ left: round.x }}>
                      <strong>{t('round.label', { round: round.round })}</strong>
                      <span>{round.summary}</span>
                    </div>
                  ))}
                  {lane.nodes.map((node) => {
                    const position = layout.positions.get(node.key)
                    if (position === undefined) return null
                    const select = (): void => { onSelect(node) }
                    return (
                      <button
                        className={css.graphNode}
                        type="button"
                        key={node.key}
                        data-status={node.status}
                        data-current-session={node.sessionId === currentSessionId || undefined}
                        style={{ left: position.x, top: position.y }}
                        aria-label={t('graph.nodeAria', {
                          round: node.round,
                          requirement: node.requirementId,
                          title: node.title,
                          status: t(`graph.status.${node.status}`),
                        })}
                        onClick={select}
                      >
                        <span><i />{t('graph.requirementCode', { requirement: node.requirementId })}</span>
                        <strong title={node.title}>{node.title}</strong>
                        <small>{t('graph.criteriaCount', { count: node.acceptanceRefs.length })}</small>
                      </button>
                    )
                  })}
                </div>
              </div>
              {laneRelations.length > 0 && (
                <ul className={css.graphRelations} aria-label={t('graph.relations')}>
                  {laneRelations.map((relation) => {
                    const source = nodesByKey.get(relation.sourceKey)
                    const target = nodesByKey.get(relation.targetKey)
                    return source === undefined || target === undefined ? null : (
                      <li key={relation.key} title={relation.reason}>
                        <b>{t('graph.requirementCode', { requirement: source.requirementId })}</b>
                        <span>{t(relationKey(relation.kind))}</span>
                        <b>{t('graph.requirementCode', { requirement: target.requirementId })}</b>
                        <small>{relation.reason}</small>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
