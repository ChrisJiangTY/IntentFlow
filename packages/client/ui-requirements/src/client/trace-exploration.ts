/** View-only expansion, round filtering, and search for the Session trace graph. */

import type { SessionRequirementGraph, TraceDocument, SessionRequirementNode, TraceTask, TraceFile } from './knowledge-graph.ts'

/** Discriminated node used by graph rendering and search. */
export type TraceNode =
  | (TraceDocument & { readonly kind: 'document' })
  | (SessionRequirementNode & { readonly kind: 'requirement' })
  | (TraceTask & { readonly kind: 'task' })
  | (TraceFile & { readonly kind: 'code' })

/**
 * Select one round without losing shared-file attribution to other rounds.
 * @param graph - Complete Session graph.
 * @param roundId - Round filter, or empty for all rounds.
 * @returns Graph restricted to that round and files touched by its Tasks.
 */
export function filterTraceRound(graph: SessionRequirementGraph, roundId: string): SessionRequirementGraph {
  if (roundId === '') return graph
  const documents = graph.documents.filter(node => node.roundId === roundId)
  const requirements = graph.requirements.filter(node => node.roundId === roundId)
  const tasks = graph.tasks.filter(node => node.roundId === roundId)
  const taskKeys = new Set(tasks.map(node => node.key))
  const files = graph.files.filter(file => file.changes.some(change => taskKeys.has(change.taskKey)))
  const keys = new Set([...documents, ...requirements, ...tasks, ...files].map(node => node.key))
  const edges = graph.edges.filter(edge => keys.has(edge.source) && keys.has(edge.target))
  return { ...graph, documents, requirements, tasks, files, edges }
}

/**
 * Preserve layer order while attaching discriminants for presentation.
 * @param graph - Session graph, optionally filtered by round.
 * @returns Documents, requirements, Tasks, and shared files.
 */
export function traceNodes(graph: SessionRequirementGraph): TraceNode[] {
  return [
    ...graph.documents.map(node => ({ ...node, kind: 'document' as const })),
    ...graph.requirements.map(node => ({ ...node, kind: 'requirement' as const })),
    ...graph.tasks.map(node => ({ ...node, kind: 'task' as const })),
    ...graph.files.map(node => ({ ...node, kind: 'code' as const })),
  ]
}

/**
 * Compute reachable visible nodes; hidden expansion flags never expose descendants.
 * @param graph - Graph after round filtering.
 * @param expanded - Nodes whose direct children are disclosed.
 * @param revealed - Explicit search targets, including Tasks with no recorded requirement assignment.
 * @returns Visible identities, deduplicated across all open branches.
 */
export function visibleTraceKeys(
  graph: SessionRequirementGraph, expanded: ReadonlySet<string>, revealed: ReadonlySet<string> = new Set(),
): Set<string> {
  const available = new Set(traceNodes(graph).map(node => node.key))
  const visible = new Set([...graph.documents.map(node => node.key), ...[...revealed].filter(key => available.has(key))])
  const queue = [...visible]
  for (const key of queue) {
    if (!expanded.has(key)) continue
    for (const edge of graph.edges) {
      if (edge.source !== key || visible.has(edge.target)) continue
      visible.add(edge.target)
      queue.push(edge.target)
    }
  }
  return visible
}

/**
 * Find every ancestor needed to reveal a search result, without opening the result's children.
 * @param graph - Graph to search, before applying any round filter.
 * @param key - Search target.
 * @returns Ancestors to add to existing expansion state.
 */
export function traceAncestors(graph: SessionRequirementGraph, key: string): Set<string> {
  const ancestors = new Set<string>()
  const queue = [key]
  for (const current of queue) {
    for (const edge of graph.edges) {
      if (edge.target !== current || ancestors.has(edge.source)) continue
      ancestors.add(edge.source)
      queue.push(edge.source)
    }
  }
  return ancestors
}

/**
 * Search hidden and visible nodes without scanning historical code snippets.
 * @param nodes - Complete Session node list.
 * @param query - Case-insensitive words that must all match a node's text.
 * @returns Matching nodes in stable layer order.
 */
export function searchTrace(nodes: readonly TraceNode[], query: string): TraceNode[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return []
  return nodes.filter((node) => {
    const content = node.kind === 'document' ? `${node.title} ${node.markdown}`
      : node.kind === 'requirement' ? `${node.title} ${node.requirementId} ${node.acceptanceRefs.join(' ')}`
        : node.kind === 'task' ? `${node.task.id} ${node.task.title} ${node.task.summary} ${node.task.statement}` : node.path
    return words.every(word => content.toLocaleLowerCase().includes(word))
  })
}
