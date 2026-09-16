/** Requirement Notebook event projection into the conversation view engine. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition,
  ConversationViewBuilder,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RequirementExecutionEvent,
  RequirementClarificationEvent,
  RequirementDocumentEvent,
  RequirementNoteEvent,
  RequirementReviewEvent,
  RequirementRoundEvent,
  RequirementRunAllEvent,
  RequirementTaskExecutionEvent,
  RequirementTaskListEvent,
  RequirementUserVersionEvent,
  RequirementValidationEvent,
  RequirementNotebookProjection,
} from '@deepseek-ai/dsh-session-requirements/client'
import type { RequirementViewNode, RequirementsSnapshot } from './contract.ts'

const EMPTY_NODES: readonly never[] = Object.freeze([])

/** Stable empty snapshot before the first Notebook event. */
export const EMPTY_REQUIREMENTS_SNAPSHOT: RequirementsSnapshot = {
  reviews: EMPTY_NODES,
  userVersions: EMPTY_NODES,
  executions: EMPTY_NODES,
  rounds: EMPTY_NODES,
  clarifications: EMPTY_NODES,
  documents: EMPTY_NODES,
  taskLists: EMPTY_NODES,
  taskExecutions: EMPTY_NODES,
  runAlls: EMPTY_NODES,
  notes: EMPTY_NODES,
  validations: EMPTY_NODES,
}

type PayloadEvent<T> = { readonly type: string; readonly seq: number; readonly time: number; readonly data: T }

function eventDefinition<T>(kind: string, eventType: string): ConversationNodeDefinition<T> {
  return {
    kind,
    target: 'requirements',
    match: event => event.type === eventType
      ? { id: `${eventType}:${String(event.seq)}`, role: 'start' }
      : null,
    start: (_context, match) => {
      const event = match.event as PayloadEvent<T>
      if (event.type !== eventType) throw new Error(`${kind} start requires ${eventType}`)
      return event.data
    },
    update: context => context.state,
    publication: () => 'immediate',
    buildViewNode: (context) => {
      const start = context.start
      if (start === undefined || context.state === undefined) return null
      const event = start.event as PayloadEvent<T>
      return {
        key: context.key,
        kind: context.kind,
        id: context.id,
        target: 'requirements',
        anchorSeq: event.seq,
        time: event.time,
        data: context.state,
      }
    },
  }
}

const reviewDefinition = eventDefinition<RequirementReviewEvent>('requirements-review', 'requirement/review')
const userVersionDefinition = eventDefinition<RequirementUserVersionEvent>('requirements-user-version', 'requirement/user-version')
const executionDefinition = eventDefinition<RequirementExecutionEvent>('requirements-execution', 'requirement/execution')
const roundDefinition = eventDefinition<RequirementRoundEvent>('requirements-round', 'requirement/round')
const clarificationDefinition = eventDefinition<RequirementClarificationEvent>('requirements-clarification', 'requirement/clarification')
const documentDefinition = eventDefinition<RequirementDocumentEvent>('requirements-document', 'requirement/document')
const taskListDefinition = eventDefinition<RequirementTaskListEvent>('requirements-task-list', 'requirement/task-list')
const taskExecutionDefinition = eventDefinition<RequirementTaskExecutionEvent>('requirements-task-execution', 'requirement/task-execution')
const runAllDefinition = eventDefinition<RequirementRunAllEvent>('requirements-run-all', 'requirement/run-all')
const noteDefinition = eventDefinition<RequirementNoteEvent>('requirements-note', 'requirement/note')
const validationDefinition = eventDefinition<RequirementValidationEvent>('requirements-validation', 'requirement/validation')

/** Incremental append-only requirements snapshot builder. */
export class RequirementsSnapshotBuilder implements ConversationViewBuilder<RequirementViewNode, RequirementsSnapshot> {
  readonly empty = EMPTY_REQUIREMENTS_SNAPSHOT
  private readonly nodes = new Map<string, RequirementViewNode>()

  replace(input: { readonly nodes: readonly RequirementViewNode[] }): RequirementsSnapshot {
    this.nodes.clear()
    for (const node of input.nodes) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  apply(input: { readonly upserts: readonly RequirementViewNode[] }): RequirementsSnapshot {
    for (const node of input.upserts) this.nodes.set(node.key, node)
    return this.snapshot()
  }

  private snapshot(): RequirementsSnapshot {
    const nodes = [...this.nodes.values()].sort((left, right) => left.anchorSeq - right.anchorSeq)
    return {
      reviews: nodes.flatMap(node => node.kind === 'requirements-review' ? [node] : []),
      userVersions: nodes.flatMap(node => node.kind === 'requirements-user-version' ? [node] : []),
      executions: nodes.flatMap(node => node.kind === 'requirements-execution' ? [node] : []),
      rounds: nodes.flatMap(node => node.kind === 'requirements-round' ? [node] : []),
      clarifications: nodes.flatMap(node => node.kind === 'requirements-clarification' ? [node] : []),
      documents: nodes.flatMap(node => node.kind === 'requirements-document' ? [node] : []),
      taskLists: nodes.flatMap(node => node.kind === 'requirements-task-list' ? [node] : []),
      taskExecutions: nodes.flatMap(node => node.kind === 'requirements-task-execution' ? [node] : []),
      runAlls: nodes.flatMap(node => node.kind === 'requirements-run-all' ? [node] : []),
      notes: nodes.flatMap(node => node.kind === 'requirements-note' ? [node] : []),
      validations: nodes.flatMap(node => node.kind === 'requirements-validation' ? [node] : []),
    }
  }
}

/**
 * Materialize the full persisted Notebook without consulting the Chat event window.
 * @param projection - Whole Session Notebook value, absent before its baseline arrives.
 * @returns Cell snapshot across every recorded round and execution attempt.
 */
export function notebookSnapshot(projection: RequirementNotebookProjection | undefined): RequirementsSnapshot {
  if (projection === undefined) return EMPTY_REQUIREMENTS_SNAPSHOT
  const nodes = projection.entries.map(event => ({
    key: `${event.type}:${event.seq}`,
    id: `${event.type}:${event.seq}`,
    kind: event.type.replace('requirement/', 'requirements-'),
    target: 'requirements',
    anchorSeq: event.seq,
    time: event.time,
    data: event.data,
  } as RequirementViewNode))
  return new RequirementsSnapshotBuilder().replace({ nodes })
}

/** Requirements target factory. */
export const requirementsViewDefinition: ConversationViewDefinition<RequirementViewNode, RequirementsSnapshot> = {
  target: 'requirements',
  create: () => new RequirementsSnapshotBuilder(),
}

/**
 * Register the Notebook event definitions and requirements target.
 * @param ctx - Browser context carrying the Conversation registries.
 */
export function registerRequirementsAssembly(ctx: Context): void {
  for (const definition of [
    reviewDefinition,
    userVersionDefinition,
    executionDefinition,
    roundDefinition,
    clarificationDefinition,
    documentDefinition,
    taskListDefinition,
    taskExecutionDefinition,
    runAllDefinition,
    noteDefinition,
    validationDefinition,
  ]) ctx.uiConversation.events.register(definition)
  ctx.uiConversation.views.register(requirementsViewDefinition)
}
