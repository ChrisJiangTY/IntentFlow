/** Requirements Notebook target types and selector hook. */

import type { ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementExecutionEvent,
  RequirementMarkdownEvent,
  RequirementNoteEvent,
  RequirementPlanEvent,
  RequirementReviewEvent,
  RequirementRoundEvent,
  RequirementTaskExecutionEvent,
  RequirementTaskListEvent,
  RequirementUserVersionEvent,
  RequirementValidationEvent,
} from '@deepseek-ai/dsh-session-requirements/client'

/** One durable requirements event projected into Notebook order. */
export interface RequirementNotebookNode<T> extends ConversationViewNode {
  readonly target: 'requirements'
  readonly anchorSeq: number
  readonly time: number
  readonly data: T
}

/** One event node with its stable Notebook kind. */
export type RequirementReviewNode = RequirementNotebookNode<RequirementReviewEvent> & { readonly kind: 'requirements-review' }
/** Projected user-authored requirement version event. */
export type RequirementUserVersionNode = RequirementNotebookNode<RequirementUserVersionEvent> & { readonly kind: 'requirements-user-version' }
/** Projected execution transition for a user-authored requirement version. */
export type RequirementExecutionNode = RequirementNotebookNode<RequirementExecutionEvent> & { readonly kind: 'requirements-execution' }
/** Projected product requirement round event. */
export type RequirementRoundNode = RequirementNotebookNode<RequirementRoundEvent> & { readonly kind: 'requirements-round' }
/** Projected Markdown artifact for a requirement round. */
export type RequirementMarkdownNode = RequirementNotebookNode<RequirementMarkdownEvent> & { readonly kind: 'requirements-markdown' }
/** Projected Plan artifact and approval state for a requirement round. */
export type RequirementPlanNode = RequirementNotebookNode<RequirementPlanEvent> & { readonly kind: 'requirements-plan' }
/** Projected whole task-list replacement for a requirement round. */
export type RequirementTaskListNode = RequirementNotebookNode<RequirementTaskListEvent> & { readonly kind: 'requirements-task-list' }
/** Projected execution transition for one Notebook Task. */
export type RequirementTaskExecutionNode = RequirementNotebookNode<RequirementTaskExecutionEvent> & { readonly kind: 'requirements-task-execution' }
/** Projected user-authored text or comment cell. */
export type RequirementNoteNode = RequirementNotebookNode<RequirementNoteEvent> & { readonly kind: 'requirements-note' }
/** Projected final validation and historical regression event. */
export type RequirementValidationNode = RequirementNotebookNode<RequirementValidationEvent> & { readonly kind: 'requirements-validation' }

/** Every event node consumed by the Requirements snapshot builder. */
export type RequirementViewNode =
  | RequirementReviewNode
  | RequirementUserVersionNode
  | RequirementExecutionNode
  | RequirementRoundNode
  | RequirementMarkdownNode
  | RequirementPlanNode
  | RequirementTaskListNode
  | RequirementTaskExecutionNode
  | RequirementNoteNode
  | RequirementValidationNode

/** Complete requirements Notebook snapshot for one Session. */
export interface RequirementsSnapshot {
  readonly reviews: readonly RequirementReviewNode[]
  readonly userVersions: readonly RequirementUserVersionNode[]
  readonly executions: readonly RequirementExecutionNode[]
  readonly rounds: readonly RequirementRoundNode[]
  readonly markdowns: readonly RequirementMarkdownNode[]
  readonly plans: readonly RequirementPlanNode[]
  readonly taskLists: readonly RequirementTaskListNode[]
  readonly taskExecutions: readonly RequirementTaskExecutionNode[]
  readonly notes: readonly RequirementNoteNode[]
  readonly validations: readonly RequirementValidationNode[]
}

/** Selector hook over the current Session's requirements target. */
export type UseRequirements = SnapshotSelectorHook<RequirementsSnapshot>

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Durable requirements Notebook events. */
    requirements: RequirementsSnapshot
  }
}
