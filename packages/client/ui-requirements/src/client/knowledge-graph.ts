/** Workspace aggregation of per-Session requirement graph projections. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  RequirementGraphNodeStatus,
  RequirementGraphRelationKind,
  RequirementRoundId,
  RequirementTaskId,
} from '@deepseek-ai/dsh-session-requirements/client'

/** Stable node presented in the Workspace-wide graph. */
export interface WorkspaceRequirementNode {
  readonly key: string
  readonly sessionId: SessionId
  readonly sessionTitle: string
  readonly roundId: RequirementRoundId
  readonly round: number
  readonly roundSummary: string
  readonly requirementId: string
  readonly title: string
  readonly acceptanceRefs: readonly string[]
  readonly taskIds: readonly RequirementTaskId[]
  readonly status: RequirementGraphNodeStatus
}

/** Directed relation whose endpoints use Workspace-stable node keys. */
export interface WorkspaceRequirementRelation {
  readonly key: string
  readonly sourceKey: string
  readonly targetKey: string
  readonly kind: RequirementGraphRelationKind
  readonly reason: string
}

/** One Session lane inside the Workspace graph. */
export interface WorkspaceRequirementSession {
  readonly sessionId: SessionId
  readonly title: string
  readonly nodes: readonly WorkspaceRequirementNode[]
}

/** Aggregated graph and the Workspace account that selected its Session set. */
export interface WorkspaceRequirementGraph {
  readonly workspaceTitle?: string
  readonly sessions: readonly WorkspaceRequirementSession[]
  readonly nodes: readonly WorkspaceRequirementNode[]
  readonly relations: readonly WorkspaceRequirementRelation[]
}

/**
 * Build a Workspace graph from Session-list projections without reading Session logs in React.
 * @param sessions - Current Session-list rows and their host-computed projection values.
 * @param workspaces - Current Workspace membership snapshot.
 * @param currentSessionId - Session whose containing Workspace selects the aggregation set.
 * @returns the ordered Session lanes, stable nodes, and valid relations for that Workspace.
 */
export function workspaceRequirementGraph(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
  currentSessionId: SessionId,
): WorkspaceRequirementGraph {
  const workspace = workspaces.items.find(item => item.sessionIds.includes(currentSessionId))
  const sessionIds = workspace?.sessionIds ?? [currentSessionId]
  const lanes: WorkspaceRequirementSession[] = []
  const allNodes: WorkspaceRequirementNode[] = []
  const allRelations: WorkspaceRequirementRelation[] = []
  for (const sessionId of sessionIds) {
    const summary = sessions.byId[sessionId]
    const projection = summary?.projectionValues?.requirementGraph
    if (summary === undefined || projection === undefined || projection.rounds.length === 0) continue
    const nodes: WorkspaceRequirementNode[] = projection.rounds.flatMap(round => round.nodes.map(node => ({
      key: `${sessionId}:${round.roundId}:${node.requirementId}`,
      sessionId,
      sessionTitle: summary.displayTitle,
      roundId: round.roundId,
      round: round.round,
      roundSummary: round.summary,
      requirementId: node.requirementId,
      title: node.title,
      acceptanceRefs: node.acceptanceRefs,
      taskIds: node.taskIds,
      status: node.status,
    })))
    const nodeKeys = new Set(nodes.map(node => node.key))
    for (const round of projection.rounds) {
      for (const relation of round.relations) {
        const sourceKey = `${sessionId}:${relation.source.roundId}:${relation.source.requirementId}`
        const targetKey = `${sessionId}:${relation.target.roundId}:${relation.target.requirementId}`
        if (!nodeKeys.has(sourceKey) || !nodeKeys.has(targetKey)) continue
        allRelations.push({
          key: `${sourceKey}:${relation.kind}:${targetKey}`,
          sourceKey,
          targetKey,
          kind: relation.kind,
          reason: relation.reason,
        })
      }
    }
    lanes.push({ sessionId, title: summary.displayTitle, nodes })
    allNodes.push(...nodes)
  }
  return {
    ...(workspace === undefined ? {} : { workspaceTitle: workspace.title }),
    sessions: lanes,
    nodes: allNodes,
    relations: allRelations,
  }
}
