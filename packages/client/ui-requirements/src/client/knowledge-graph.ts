/** Join current-Session requirements, Task executions, and recorded file mutations. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  RequirementCodeChange, RequirementGraphProjectedNode, RequirementRoundId, RequirementTask,
} from '@deepseek-ai/dsh-session-requirements/client'
import type { RequirementsSnapshot } from './contract.ts'

/** One document requirement in the selected Session. */
export interface SessionRequirementNode extends RequirementGraphProjectedNode {
  readonly key: string
  readonly roundId: RequirementRoundId
  readonly round: number
}

/** Executable work associated with one exact document revision. */
export interface TraceTask {
  readonly key: string
  readonly roundId: RequirementRoundId
  readonly task: RequirementTask
}

/** Shared file node; each mutation retains its owning Task and execution. */
export interface TraceFile {
  readonly key: string
  readonly path: string
  readonly changes: readonly (RequirementCodeChange & { readonly taskKey: string })[]
}

/** Directed requirement-to-Task or Task-to-file connection. */
export interface TraceEdge {
  readonly source: string
  readonly target: string
}

/** Three-layer graph scoped to one Session, including unassigned Tasks. */
export interface SessionRequirementGraph {
  readonly sessionId: SessionId
  readonly title: string
  readonly requirements: readonly SessionRequirementNode[]
  readonly tasks: readonly TraceTask[]
  readonly files: readonly TraceFile[]
  readonly edges: readonly TraceEdge[]
}

/**
 * Join explicit acceptance references and execution Turns without inferring links from file mentions.
 * @param sessions - Session-list projections; only the selected row is read.
 * @param snapshot - Selected Session's complete Notebook.
 * @param sessionId - Session displayed by the conversation.
 * @returns Three-layer graph with shared files and successful recorded modifications.
 */
export function sessionRequirementGraph(
  sessions: SessionListState, snapshot: RequirementsSnapshot, sessionId: SessionId,
): SessionRequirementGraph {
  const summary = sessions.byId[sessionId]
  const requirements: SessionRequirementNode[] = []
  const tasks: TraceTask[] = []
  const files = new Map<string, { key: string; path: string; changes: (RequirementCodeChange & { taskKey: string })[] }>()
  const edges = new Map<string, TraceEdge>()
  const turnOwners = new Map<number, Set<string>>()
  for (const execution of snapshot.taskExecutions) {
    const { roundId, taskId, turn } = execution.data
    if (turn === undefined) continue
    const owners = turnOwners.get(turn) ?? new Set<string>()
    owners.add(`task:${roundId}:${taskId}`)
    turnOwners.set(turn, owners)
  }
  const connect = (source: string, target: string): void => { edges.set(JSON.stringify([source, target]), { source, target }) }
  for (const round of summary?.projectionValues?.requirementGraph?.rounds ?? []) {
    const nodes = round.nodes.map(node => ({ ...node, key: `requirement:${round.roundId}:${node.requirementId}`, roundId: round.roundId, round: round.round }))
    requirements.push(...nodes)
    const list = snapshot.taskLists.filter(node => node.data.roundId === round.roundId
      && node.data.documentRevision === round.documentRevision)
      .sort((a, b) => a.anchorSeq - b.anchorSeq).at(-1)
    for (const task of list?.data.tasks ?? []) {
      if (task.status === 'withdrawn') continue
      const key = `task:${round.roundId}:${task.id}`
      tasks.push({ key, roundId: round.roundId, task })
      for (const node of nodes) {
        if (node.acceptanceRefs.some(ref => task.requirementRefs.includes(ref))) connect(node.key, key)
      }
      const turns = new Set(snapshot.taskExecutions.filter(execution => execution.data.roundId === round.roundId
        && execution.data.taskId === task.id && execution.data.turn !== undefined).map(execution => execution.data.turn))
      for (const change of summary?.projectionValues?.requirementChanges?.changes ?? []) {
        if (!turns.has(change.turn) || turnOwners.get(change.turn)?.size !== 1) continue
        const fileKey = `file:${change.path}`
        const file = files.get(fileKey) ?? { key: fileKey, path: change.path, changes: [] }
        file.changes.push({ ...change, taskKey: key })
        files.set(fileKey, file)
        connect(key, fileKey)
      }
    }
  }
  return { sessionId, title: summary?.displayTitle ?? '', requirements, tasks, files: [...files.values()], edges: [...edges.values()] }
}

/**
 * Select all directed ancestors and descendants without walking into sibling branches.
 * @param graph - Current three-layer graph.
 * @param key - Focused node, or undefined for the complete graph.
 * @returns Keys belonging to the focused paths.
 */
export function focusedTraceKeys(graph: SessionRequirementGraph, key: string | undefined): ReadonlySet<string> {
  if (key === undefined) return new Set([...graph.requirements, ...graph.tasks, ...graph.files].map(node => node.key))
  const result = new Set([key])
  for (const direction of ['source', 'target'] as const) {
    const visited = new Set([key])
    const queue = [key]
    for (const current of queue) {
      for (const edge of graph.edges) {
        if (edge[direction] !== current) continue
        const next = edge[direction === 'source' ? 'target' : 'source']
        if (!visited.has(next)) { visited.add(next); result.add(next); queue.push(next) }
      }
    }
  }
  return result
}
