/** Complete Notebook cell state folded from the durable log, independent of Chat pagination. */

import { z } from 'zod'
import { assertNever } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { RequirementNotebookEvent, RequirementNotebookProjection } from './types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    requirementNotebook: RequirementNotebookProjection
  }
}

const text = z.union([z.string(), z.object({ zh: z.string(), en: z.string() }).strict()])
const id = z.string().min(1)
const integer = z.number().int().nonnegative()
const revision = z.number().int().positive()
const base = { version: z.literal(1), roundId: id }
const revised = { ...base, revision }
const regression = z.object({ requirementId: id, taskId: id.optional(), reason: text }).strict()
const task = z.object({
  id, order: integer, kind: z.enum(['implementation', 'checkpoint', 'final-test']),
  title: z.string(), summary: z.string(), statement: z.string(), humanInstruction: z.string().optional(),
  requirementRefs: z.array(z.string()),
  status: z.enum(['pending', 'in_progress', 'reviewing', 'completed', 'failed', 'withdrawn']),
}).strict()
const reviewBase = { version: z.union([z.literal(1), z.literal(2), z.literal(3)]), turn: integer, reviewedThroughSeq: z.number().int() }
const review = z.discriminatedUnion('status', [
  z.object({ ...reviewBase, status: z.literal('failed'), reviewerSessionId: id.optional(),
    error: z.object({ code: z.enum(['reviewer-unavailable', 'reviewer-failed', 'invalid-output']), message: z.string() }).strict(),
  }).strict(),
  z.object({ ...reviewBase, status: z.literal('completed'), reviewerSessionId: id,
    task: z.object({ taskId: id, verdict: z.enum(['passed', 'warning', 'blocking']), summary: text, findings: z.array(text) }).strict().optional(),
    requirements: z.array(z.object({
      id, title: text, statement: text, lifecycle: z.enum(['active', 'superseded', 'withdrawn']),
      change: z.enum(['added', 'refined', 'replaced', 'unchanged', 'withdrawn']), replaces: z.string().optional(),
      sources: z.array(z.object({ seq: integer, kind: z.enum(['user', 'assistant', 'plan', 'tool']), summary: text }).strict()),
      code: z.array(z.object({ path: z.string(), startLine: integer.optional(), endLine: integer.optional(),
        relation: z.enum(['implements', 'tests', 'configures', 'documents', 'touches']), evidence: text }).strict()),
      audit: z.object({ status: z.enum(['verified', 'partial', 'unverified', 'not-applicable']), summary: text, gaps: z.array(text) }).strict(),
      regression: regression.optional(),
    }).strict()),
  }).strict(),
])

function entry<T extends string, S extends z.ZodType>(type: T, data: S) {
  return z.object({ type: z.literal(type), seq: integer, time: z.number(), data }).strict()
}

const eventSchema = z.discriminatedUnion('type', [
  entry('requirement/round', z.object({ ...revised, round: revision, sourceMessageId: id,
    language: z.enum(['zh', 'en']), input: z.string(), generationMessageId: id.optional(), turn: integer.optional(),
    status: z.enum(['analyzing', 'clarifying', 'awaiting-input', 'document-ready', 'generating-tasks', 'tasks-ready', 'executing', 'reviewing', 'validating', 'completed', 'failed']),
  }).strict()),
  entry('requirement/document', z.object({ ...revised, turn: integer, summary: z.string(), markdown: z.string(), valid: z.boolean(), issues: z.array(z.string()) }).strict()),
  entry('requirement/clarification', z.object({ ...revised, attempt: revision, status: z.enum(['asked', 'answered', 'dismissed']),
    questions: z.array(z.object({ id, question: z.string(), header: z.string().optional(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() }).strict()).optional() }).strict()),
    answers: z.array(z.object({ id, selected: z.array(z.string()), custom: z.string().optional() }).strict()).optional(),
    error: z.string().optional(),
  }).strict()),
  entry('requirement/task-list', z.object({ ...revised, documentRevision: revision, tasks: z.array(task) }).strict()),
  entry('requirement/task-execution', z.object({ ...revised, taskId: id, messageId: id,
    status: z.enum(['submitted', 'processing', 'reviewing', 'completed', 'failed']), turn: integer.optional(), output: z.string().optional(),
  }).strict()),
  entry('requirement/run-all', z.object({ ...revised, status: z.enum(['running', 'stopping', 'stopped', 'completed', 'failed']) }).strict()),
  entry('requirement/note', z.object({ ...base, noteId: id, kind: z.enum(['text', 'comment']), content: z.string(), dispatched: z.boolean(), messageId: id.optional() }).strict()),
  entry('requirement/validation', z.object({ ...revised, turn: integer, reviewedThroughSeq: z.number().int(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']), summary: text, regressions: z.array(regression), failedTaskIds: z.array(id), error: z.string().optional(),
  }).strict()),
  entry('requirement/review', review),
  entry('requirement/user-version', z.object({ version: z.literal(1), operation: z.enum(['added', 'revised']),
    requirementId: id, requirementVersion: revision, afterId: id.optional(), language: z.enum(['zh', 'en']), title: z.string(), statement: z.string(), messageId: id,
  }).strict()),
  entry('requirement/execution', z.object({ version: z.literal(1), requirementId: id, requirementVersion: revision, messageId: id,
    status: z.enum(['processing', 'completed', 'failed']), turn: integer.optional(),
  }).strict()),
]).transform(value => value as RequirementNotebookEvent)

const schema: z.ZodType<RequirementNotebookProjection> = z.object({ entries: z.array(eventSchema) }).strict()

function cellKey(event: RequirementNotebookEvent): string {
  switch (event.type) {
    case 'requirement/document': return `${event.type}:${event.data.roundId}:${event.data.revision}`
    case 'requirement/task-list': return `${event.type}:${event.data.roundId}:${event.data.documentRevision}`
    case 'requirement/task-execution': return `${event.type}:${event.data.roundId}:${event.data.taskId}:${event.data.messageId}`
    case 'requirement/clarification': return `${event.type}:${event.data.roundId}:${event.data.attempt}`
    case 'requirement/note': return `${event.type}:${event.data.roundId}:${event.data.noteId}`
    case 'requirement/review': return `${event.type}:${event.data.turn}`
    case 'requirement/user-version':
    case 'requirement/execution': return `${event.type}:${event.data.requirementId}:${event.data.requirementVersion}`
    case 'requirement/validation': return `${event.type}:${event.data.roundId}:${event.data.turn}`
    case 'requirement/round':
    case 'requirement/run-all': return `${event.type}:${event.data.roundId}`
    default: return assertNever(event, 'RequirementNotebookEvent')
  }
}

/** Persisted Notebook projection with one value per cell/revision and per execution attempt. */
export const requirementNotebookProjectionDefinition = {
  key: 'requirementNotebook',
  stateVersion: 1,
  stateSchema: schema,
  init: (): RequirementNotebookProjection => ({ entries: [] }),
  apply: (state, event) => {
    switch (event.type) {
      case 'requirement/round': case 'requirement/document': case 'requirement/task-list':
      case 'requirement/task-execution': case 'requirement/clarification': case 'requirement/note':
      case 'requirement/review': case 'requirement/user-version': case 'requirement/execution':
      case 'requirement/validation': case 'requirement/run-all': {
        const key = cellKey(event)
        return { entries: [...state.entries.filter(previous => cellKey(previous) !== key), event] }
      }
      default: return state
    }
  },
  wire: { viewSchema: schema, view: state => state },
} satisfies ProjectionDefinition<'requirementNotebook', RequirementNotebookProjection>
