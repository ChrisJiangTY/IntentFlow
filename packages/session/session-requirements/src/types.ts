/**
 * Pure durable vocabulary for requirement evolution reviews.
 * @module @deepseek-ai/dsh-session-requirements/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable user-visible identity of one requirement across revisions. */
export type RequirementId = Branded<'RequirementId'>

/** Stable identity of one product requirement round. */
export type RequirementRoundId = Branded<'RequirementRoundId'>

/** Stable identity of one implementation task inside a requirement round. */
export type RequirementTaskId = Branded<'RequirementTaskId'>

/** Stable identity of one persisted Notebook text or comment cell. */
export type RequirementNoteId = Branded<'RequirementNoteId'>

/** Language in which the user authored one requirement version. */
export type RequirementAuthoringLanguage = 'zh' | 'en'

/** Version-addressed current requirement expected by a revision request. */
export interface RequirementRef {
  /** Stable requirement identity. */
  readonly id: RequirementId
  /** Current user-owned version expected by the caller. */
  readonly version: number
}

/** Browser request that creates or revises one user-owned requirement. */
export type RequirementCommitRequest =
  | {
    readonly operation: 'add'
    readonly afterId?: RequirementId
    readonly language: RequirementAuthoringLanguage
    readonly title: string
    readonly statement: string
  }
  | {
    readonly operation: 'revise'
    readonly ref: RequirementRef
    readonly language: RequirementAuthoringLanguage
    readonly title: string
    readonly statement: string
  }

/** Identity and durable position returned after one requirement commit. */
export interface RequirementCommitResult {
  readonly requirementId: RequirementId
  readonly requirementVersion: number
  readonly eventSeq: number
}

/** Browser request that starts the structured requirement-to-validation flow. */
export interface RequirementRoundStartRequest {
  /** Raw user request preserved verbatim as the round's source. */
  readonly input: string
  /** Language selected by the user for the round's authored content. */
  readonly language: RequirementAuthoringLanguage
}

/** Identity returned after one structured requirement round is queued. */
export interface RequirementRoundStartResult {
  readonly roundId: RequirementRoundId
  readonly round: number
  readonly eventSeq: number
}

/** Browser request that replaces the editable requirement document draft. */
export interface RequirementDocumentEditRequest {
  readonly roundId: RequirementRoundId
  /** Latest document revision observed by the editor. */
  readonly revision: number
  readonly markdown: string
}

/** Browser request that generates tasks from one exact document revision. */
export interface RequirementTaskGenerateRequest {
  readonly roundId: RequirementRoundId
  readonly documentRevision: number
}

/** Durable position returned after a document edit or task-generation request. */
export interface RequirementDocumentActionResult {
  readonly roundId: RequirementRoundId
  readonly documentRevision: number
  readonly eventSeq: number
}

/** Browser request that runs one task Notebook cell. */
export interface RequirementTaskRunRequest {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
}

/** Identity returned after one task cell is queued. */
export interface RequirementTaskRunResult {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  readonly eventSeq: number
}

/** Browser request that persists task text, including empty drafts, without executing it. */
export interface RequirementTaskEditRequest {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  readonly title: string
  readonly statement: string
}

/** Browser request that changes one task's position in the current generated task list. */
export interface RequirementTaskMoveRequest {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  readonly direction: 'up' | 'down'
}

/** Browser request that withdraws one task before it is running. */
export interface RequirementTaskWithdrawRequest {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
}

/** Browser request that inserts a manually authored task; both text fields may be empty. */
export interface RequirementTaskAddRequest {
  readonly roundId: RequirementRoundId
  readonly afterTaskId?: RequirementTaskId
  readonly title: string
  readonly statement: string
}

/** Identity returned after a task-list mutation. */
export interface RequirementTaskMutationResult {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  readonly eventSeq: number
}

/** Browser request that runs the pending task cells in order. */
export interface RequirementRunAllRequest {
  readonly roundId: RequirementRoundId
}

/** Identity returned after an ordered task run has been started. */
export interface RequirementRunAllResult {
  readonly roundId: RequirementRoundId
  readonly taskId?: RequirementTaskId
  readonly eventSeq?: number
}

/** Browser request that stops an ordered run after its current task settles. */
export interface RequirementRunAllStopRequest {
  readonly roundId: RequirementRoundId
}

/** Durable position returned after an ordered run accepts a stop request. */
export interface RequirementRunAllStopResult {
  readonly roundId: RequirementRoundId
  readonly eventSeq: number
}

/** Browser request that adds a durable Notebook text or comment cell. */
export interface RequirementNoteRequest {
  readonly roundId: RequirementRoundId
  readonly kind: 'text' | 'comment'
  readonly content: string
  /** Whether this note should immediately enter the main Agent conversation. */
  readonly dispatch: boolean
}

/** Browser request that replaces a passive Markdown note's source, including empty text. */
export interface RequirementNoteEditRequest {
  readonly roundId: RequirementRoundId
  readonly noteId: RequirementNoteId
  readonly content: string
}

/** Identity returned after one Notebook note is queued. */
export interface RequirementNoteResult {
  readonly roundId: RequirementRoundId
  readonly noteId: RequirementNoteId
  readonly eventSeq: number
}

/** Lifecycle of one product requirement round. */
export type RequirementRoundStatus =
  | 'analyzing'
  | 'clarifying'
  | 'awaiting-input'
  | 'document-ready'
  | 'generating-tasks'
  | 'tasks-ready'
  | 'executing'
  | 'reviewing'
  | 'validating'
  | 'completed'
  | 'failed'

/** Durable product round identity and current orchestration status. */
export interface RequirementRoundEvent {
  readonly version: 1
  /** Monotonic replacement number for this round's whole value. */
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly round: number
  readonly sourceMessageId: MessageId
  readonly language: RequirementAuthoringLanguage
  readonly input: string
  readonly status: RequirementRoundStatus
  /** Task-generation message currently or most recently associated with the round. */
  readonly generationMessageId?: MessageId
  /** Parent Agent turn currently responsible for this round. */
  readonly turn?: number
}

/** One user-owned choice presented during requirement clarification. */
export interface RequirementClarificationQuestion {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options?: readonly {
    readonly label: string
    readonly description?: string
  }[]
}

/** One answer returned for a requirement clarification question. */
export interface RequirementClarificationAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

/** Durable request and settlement of one clarification batch. */
export interface RequirementClarificationEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  /** One-based clarification batch number, capped by the plugin configuration. */
  readonly attempt: number
  readonly status: 'asked' | 'answered' | 'dismissed'
  readonly questions: readonly RequirementClarificationQuestion[]
  readonly answers?: readonly RequirementClarificationAnswer[]
  readonly error?: string
}

/** Editable Chinese requirement document generated after clarification. */
export interface RequirementDocumentEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly turn: number
  /** Agent-authored read-only summary used by the round heading. */
  readonly summary: string
  readonly markdown: string
  /** Whether the current draft may generate tasks. */
  readonly valid: boolean
  /** Stable diagnostics for an invalid but persisted draft. */
  readonly issues: readonly string[]
}

/** Semantic role of one top-level executable task block. */
export type RequirementTaskKind = 'implementation' | 'checkpoint' | 'final-test'

/** One task shown in a requirement Notebook; empty pending drafts cannot execute. */
export interface RequirementTask {
  readonly id: RequirementTaskId
  readonly order: number
  readonly kind: RequirementTaskKind
  readonly title: string
  readonly statement: string
  /** Acceptance criteria such as `1.1` that this block implements or verifies. */
  readonly requirementRefs: readonly string[]
  readonly status: 'pending' | 'in_progress' | 'reviewing' | 'completed' | 'failed' | 'withdrawn'
}

/** Whole task-list replacement generated from one requirement document revision. */
export interface RequirementTaskListEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly documentRevision: number
  readonly tasks: readonly RequirementTask[]
}

/** One task execution transition shown inside its Notebook cell. */
export interface RequirementTaskExecutionEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  readonly messageId: MessageId
  readonly status: 'submitted' | 'processing' | 'reviewing' | 'completed' | 'failed'
  readonly turn?: number
  /** Bounded final Agent output attached to the task cell. */
  readonly output?: string
}

/** Durable lifecycle of a sequential Run All request. */
export interface RequirementRunAllEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly status: 'running' | 'stopping' | 'stopped' | 'completed' | 'failed'
}

/** A user-authored note; later events with the same round and note ids replace passive Markdown source. */
export interface RequirementNoteEvent {
  readonly version: 1
  readonly roundId: RequirementRoundId
  readonly noteId: RequirementNoteId
  readonly kind: 'text' | 'comment'
  readonly content: string
  /** True only for an explicit Agent-assistance request. */
  readonly dispatched: boolean
  /** Main-conversation message identity when `dispatched` is true. */
  readonly messageId?: MessageId
}

/** A historical requirement that the current round was confirmed to regress. */
export interface RequirementRegression {
  readonly requirementId: string
  /** Task responsible for the regression, when the reviewer can attribute it. */
  readonly taskId?: RequirementTaskId
  readonly reason: RequirementText
}

/** Final independent validation result for one requirement round. */
export interface RequirementValidationEvent {
  readonly version: 1
  readonly revision: number
  readonly roundId: RequirementRoundId
  readonly turn: number
  readonly reviewedThroughSeq: number
  readonly status: 'pending' | 'processing' | 'completed' | 'failed'
  readonly summary: RequirementText
  readonly regressions: readonly RequirementRegression[]
  readonly failedTaskIds: readonly RequirementTaskId[]
  readonly error?: string
}

/** User-authored requirement version committed before Agent execution. */
export interface RequirementUserVersionEvent {
  readonly version: 1
  readonly operation: 'added' | 'revised'
  readonly requirementId: RequirementId
  readonly requirementVersion: number
  readonly afterId?: RequirementId
  readonly language: RequirementAuthoringLanguage
  readonly title: string
  readonly statement: string
  /** User message queued to execute exactly this version. */
  readonly messageId: MessageId
}

/** Durable Agent execution transition for one user-owned requirement version. */
export interface RequirementExecutionEvent {
  readonly version: 1
  readonly requirementId: RequirementId
  readonly requirementVersion: number
  readonly messageId: MessageId
  readonly status: 'processing' | 'completed' | 'failed'
  /** Agent turn after the queued message enters execution. */
  readonly turn?: number
}

/** Current execution status derived from the committed version and its transitions. */
export type RequirementExecutionStatus = 'submitted' | RequirementExecutionEvent['status']

/** How one requirement differs from its previous reviewed revision. */
export type RequirementChangeKind = 'added' | 'refined' | 'replaced' | 'unchanged' | 'withdrawn'

/** Current lifecycle of a requirement in the reviewed conversation. */
export type RequirementLifecycle = 'active' | 'superseded' | 'withdrawn'

/** Independent code audit outcome. */
export type RequirementAuditStatus = 'verified' | 'partial' | 'unverified' | 'not-applicable'

/** Source category cited by the reviewer. */
export type RequirementSourceKind = 'user' | 'assistant' | 'plan' | 'tool'

/** Simplified Chinese and English renderings of reviewer-authored text. */
export interface RequirementLocalizedText {
  /** Simplified Chinese rendering. */
  readonly zh: string
  /** English rendering. */
  readonly en: string
}

/** Reviewer text from a bilingual snapshot or a legacy single-language snapshot. */
export type RequirementText = RequirementLocalizedText | string

/** A source event that supports one requirement revision. */
export interface RequirementSourceRef {
  /** Session event sequence number. */
  readonly seq: number
  /** Human prompt, assistant reply, plan artifact, or other tool activity. */
  readonly kind: RequirementSourceKind
  /** Short reviewer-authored explanation of the source's relevance. */
  readonly summary: RequirementText
}

/** How a file contributes to one requirement. */
export type RequirementCodeRelation = 'implements' | 'tests' | 'configures' | 'documents' | 'touches'

/** Code evidence independently inspected by the reviewer. */
export interface RequirementCodeLink {
  /** Workspace-relative file path. */
  readonly path: string
  /** First supporting line, when the reviewer can identify it. */
  readonly startLine?: number
  /** Last supporting line, when the reviewer can identify it. */
  readonly endLine?: number
  /** The file's relationship to the requirement. */
  readonly relation: RequirementCodeRelation
  /** Concrete observation from the file. */
  readonly evidence: RequirementText
}

/** Independent implementation finding for one requirement. */
export interface RequirementAudit {
  /** Evidence-based outcome, separate from the builder's claims. */
  readonly status: RequirementAuditStatus
  /** Concise explanation of the outcome. */
  readonly summary: RequirementText
  /** Missing behavior or evidence that prevents full verification. */
  readonly gaps: readonly RequirementText[]
}

/** One requirement at one reviewed point in the conversation. */
export interface RequirementRevision {
  /** Stable reviewer-maintained identity such as `R1`. */
  readonly id: string
  /** Short human-facing label. */
  readonly title: RequirementText
  /** Current precise requirement statement. */
  readonly statement: RequirementText
  /** Current lifecycle in the global requirement set. */
  readonly lifecycle: RequirementLifecycle
  /** Change against the previous review snapshot. */
  readonly change: RequirementChangeKind
  /** Prior requirement identity when this revision replaces another requirement. */
  readonly replaces?: string
  /** Conversation evidence used to infer this revision. */
  readonly sources: readonly RequirementSourceRef[]
  /** Independently inspected code relationships. */
  readonly code: readonly RequirementCodeLink[]
  /** Independent implementation finding. */
  readonly audit: RequirementAudit
  /** Present only when the reviewer confirms that this round broke it. */
  readonly regression?: RequirementRegression
}

/** Successful requirement review written after one parent turn. */
export interface RequirementReviewCompleted {
  /** Version 2 stores bilingual text; version 3 adds an optional task verdict. */
  readonly version: 1 | 2 | 3
  readonly status: 'completed'
  /** Parent turn whose finished state was reviewed. */
  readonly turn: number
  /** Last parent event visible to the reviewer. */
  readonly reviewedThroughSeq: number
  /** One-shot child that performed the independent review. */
  readonly reviewerSessionId: SessionId
  /** Full requirement snapshot at this point in time. */
  readonly requirements: readonly RequirementRevision[]
  /** Gate verdict when this review was requested for a Notebook task. */
  readonly task?: {
    readonly taskId: RequirementTaskId
    readonly verdict: 'passed' | 'warning' | 'blocking'
    readonly summary: RequirementText
    readonly findings: readonly RequirementText[]
  }
}

/** Failed review retained on the same timeline without inventing findings. */
export interface RequirementReviewFailed {
  readonly version: 1 | 2 | 3
  readonly status: 'failed'
  readonly turn: number
  readonly reviewedThroughSeq: number
  /** Present when the one-shot child was published before it failed. */
  readonly reviewerSessionId?: SessionId
  readonly error: {
    /** Stable failure category owned by this package. */
    readonly code: 'reviewer-unavailable' | 'reviewer-failed' | 'invalid-output'
    /** Bounded operational explanation without workspace contents. */
    readonly message: string
  }
}

/** Append-only review record projected by the requirements view. */
export type RequirementReviewEvent = RequirementReviewCompleted | RequirementReviewFailed

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * User-confirmed requirement version. The version is effective when this
     * event is appended; later Agent failure does not roll it back.
     */
    'requirement/user-version': RequirementUserVersionEvent
    /** Agent execution status for one user-confirmed requirement version. */
    'requirement/execution': RequirementExecutionEvent
    /**
     * Full requirement snapshot and independent audit produced after a parent
     * turn. Repeated turns append new records; prior reviews are never edited.
     */
    'requirement/review': RequirementReviewEvent
    /** Product round and its raw user request. */
    'requirement/round': RequirementRoundEvent
    /** Requirement clarification batch and its user answer. */
    'requirement/clarification': RequirementClarificationEvent
    /** Editable requirement document produced after clarification. */
    'requirement/document': RequirementDocumentEvent
    /** Whole task list generated from the current requirement document. */
    'requirement/task-list': RequirementTaskListEvent
    /** Execution status for one Notebook task. */
    'requirement/task-execution': RequirementTaskExecutionEvent
    /** Sequential Run All lifecycle. */
    'requirement/run-all': RequirementRunAllEvent
    /** User-authored Notebook text and comment cells. */
    'requirement/note': RequirementNoteEvent
    /** Independent final validation and confirmed historical regressions. */
    'requirement/validation': RequirementValidationEvent
  }
}
