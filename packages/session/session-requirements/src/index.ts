/**
 * Turn-end requirement evolution analysis and independent code review.
 * @module @deepseek-ai/dsh-session-requirements
 */

import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves the optional preset service used to address Agent-local Plan mode.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: resolves the optional command registry on injected child contexts.
import type {} from '@deepseek-ai/dsh-commands'
import type {
  RequirementAuthoringLanguage,
  RequirementCommitRequest,
  RequirementCommitResult,
  RequirementExecutionEvent,
  RequirementId,
  RequirementNoteRequest,
  RequirementNoteEditRequest,
  RequirementNoteId,
  RequirementNoteResult,
  RequirementPlanEvent,
  RequirementRegression,
  RequirementReviewCompleted,
  RequirementReviewEvent,
  RequirementRevision,
  RequirementRunAllRequest,
  RequirementRunAllResult,
  RequirementRoundEvent,
  RequirementRoundId,
  RequirementRoundStartRequest,
  RequirementRoundStartResult,
  RequirementTask,
  RequirementTaskAddRequest,
  RequirementTaskEditRequest,
  RequirementTaskExecutionEvent,
  RequirementTaskId,
  RequirementTaskMoveRequest,
  RequirementTaskMutationResult,
  RequirementTaskRunRequest,
  RequirementTaskRunResult,
  RequirementTaskListEvent,
  RequirementTaskWithdrawRequest,
  RequirementText,
  RequirementUserVersionEvent,
  RequirementValidationEvent,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionRequirements: SessionRequirements
  }
}

/** Deployment choices for the independent reviewer. */
export interface Config {
  /** Registered one-shot subagent provider. */
  readonly reviewerProvider: string
  /** Maximum characters retained in the reviewer prompt. */
  readonly maxInputChars: number
  /** Read-only tools exposed to the reviewer child. */
  readonly reviewerTools: string[]
}

interface RequirementAnalysis {
  readonly requirements: RequirementRevision[]
}

interface ReviewState {
  readonly controllers: Set<AbortController>
  tail: Promise<void>
}

interface RunAllState {
  readonly agent: Agent
  readonly roundId: RequirementRoundId
}

interface PlanModeLike {
  set(agent: Agent, active: boolean): string
}

const BILINGUAL_TEXT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['zh', 'en'],
  properties: {
    zh: { type: 'string' },
    en: { type: 'string' },
  },
}

const REVIEW_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements'],
  properties: {
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'statement', 'lifecycle', 'change', 'sources', 'code', 'audit'],
        properties: {
          id: { type: 'string' },
          title: BILINGUAL_TEXT_SCHEMA,
          statement: BILINGUAL_TEXT_SCHEMA,
          lifecycle: { type: 'string', enum: ['active', 'superseded', 'withdrawn'] },
          change: { type: 'string', enum: ['added', 'refined', 'replaced', 'unchanged', 'withdrawn'] },
          replaces: { type: 'string' },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['seq', 'kind', 'summary'],
              properties: {
                seq: { type: 'integer' },
                kind: { type: 'string', enum: ['user', 'assistant', 'plan', 'tool'] },
                summary: BILINGUAL_TEXT_SCHEMA,
              },
            },
          },
          code: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'relation', 'evidence'],
              properties: {
                path: { type: 'string' },
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
                relation: { type: 'string', enum: ['implements', 'tests', 'configures', 'documents', 'touches'] },
                evidence: BILINGUAL_TEXT_SCHEMA,
              },
            },
          },
          audit: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'summary', 'gaps'],
            properties: {
              status: { type: 'string', enum: ['verified', 'partial', 'unverified', 'not-applicable'] },
              summary: BILINGUAL_TEXT_SCHEMA,
              gaps: { type: 'array', items: BILINGUAL_TEXT_SCHEMA },
            },
          },
          regression: {
            type: 'object',
            additionalProperties: false,
            required: ['requirementId', 'reason'],
            properties: {
              requirementId: { type: 'string' },
              taskId: { type: 'string' },
              reason: BILINGUAL_TEXT_SCHEMA,
            },
          },
        },
      },
    },
  },
}

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function previousReview(events: readonly SessionEvent[]): RequirementReviewCompleted | undefined {
  const event = events.findLast(candidate => candidate.type === 'requirement/review')
  return event?.type === 'requirement/review' && event.data.status === 'completed'
    ? event.data
    : undefined
}

function reviewSources(events: readonly SessionEvent[], turn: number): string {
  const start = events.find(candidate => candidate.type === 'turn/start' && candidate.data.turn === turn)
  const end = events.findLast(candidate => candidate.type === 'turn/end' && candidate.data.turn === turn)
  if (end === undefined) return '[]'
  const lower = start?.seq ?? 0
  const messageIds = new Set<string>()
  for (const event of events) {
    if (event.seq < lower || event.seq > end.seq || event.type !== 'user/message') continue
    messageIds.add(event.data.id)
  }
  const rows: unknown[] = []
  for (const event of events) {
    if (event.type === 'requirement/user-version' && messageIds.has(event.data.messageId)) {
      rows.push({ seq: event.seq, kind: 'user', requirementVersion: event.data })
      continue
    }
    if (event.seq < lower || event.seq > end.seq) continue
    switch (event.type) {
      case 'user/message':
        rows.push({ seq: event.seq, kind: 'user', text: textOf(event.data.content) })
        break
      case 'assistant/message':
        rows.push({ seq: event.seq, kind: 'assistant', text: textOf(event.data.message.content) })
        break
      case 'tool/call':
        rows.push({ seq: event.seq, kind: event.data.name === 'todo_write' ? 'plan' : 'tool', name: event.data.name, arguments: event.data.arguments })
        break
      default:
        if ((event as { type: string }).type === 'plan/mode') {
          const candidate = event as unknown as { seq: number; data: { active: boolean } }
          rows.push({ seq: candidate.seq, kind: 'plan', active: candidate.data.active })
        } else if ((event as { type: string }).type === 'todo/write') {
          rows.push({ seq: event.seq, kind: 'plan', data: event.data })
        }
    }
  }
  return JSON.stringify(rows)
}

function reviewerPrompt(
  session: Session,
  turn: number,
  maxInputChars: number,
): string {
  const previous = previousReview(session.events)
  const sources = reviewSources(session.events, turn)
  const prior = previous?.requirements ?? []
  const roundArtifacts = session.events.flatMap((event) => {
    if (event.type === 'requirement/round'
      || event.type === 'requirement/markdown'
      || event.type === 'requirement/plan'
      || event.type === 'requirement/task-list'
      || event.type === 'requirement/task-execution'
      || event.type === 'requirement/note') {
      return [{ seq: event.seq, type: event.type, data: event.data }]
    }
    return []
  })
  const body = 'You are the independent requirements reviewer for a coding session.\n\n'
    + `Reconstruct how the user's requirements stand after turn ${turn}, then inspect the current workspace to audit their real implementation. `
    + 'Treat user prompts as primary requirements. Assistant replies and plans are evidence of interpretation, never proof of completion. '
    + 'A requirement/user-version row is a direct user-confirmed record: preserve its requirementId and source-language title and statement verbatim, and translate only the other language. Never let an inferred review redefine it. '
    + 'Reuse stable requirement ids from the previous snapshot. Create R1, R2, ... only for genuinely new requirements. '
    + 'Use refined when wording becomes more precise without changing intent; replaced only when the new intent invalidates the old one; withdrawn only with clear user evidence. '
    + 'For every active requirement, search and read the relevant code. Never accept an assistant claim as code evidence. '
    + 'Verified requires concrete wired implementation evidence; partial names the missing wiring or behavior; unverified means no adequate implementation evidence. '
    + 'Cite workspace-relative paths and exact lines when available. Keep summaries concise and factual. '
    + 'Write every reviewer-authored human-facing field in both Simplified Chinese and English as {"zh":"...","en":"..."}: title, statement, source summary, code evidence, audit summary, and every audit gap. '
    + 'Inspect the requirement Notebook artifacts as well: the raw Markdown, the proposed or approved Plan, the task list, task execution results, and user-authored text/comment cells. '
    + 'A regression is a confirmed accidental break of an active historical requirement by the current round. Emit the optional regression object only for that case. '
    + 'A user-authorized refinement, replacement, withdrawal, or explicitly requested behavior change is not a regression. Do not infer regression from audit status, missing evidence, or a failed task alone. '
    + 'When a regression is confirmed, include the historical requirement id, include taskId only when the evidence attributes the break to one task, and explain the concrete reason in both languages. '
    + 'Preserve proper nouns, code identifiers, paths, and quoted user text where translation would change their meaning. Return the complete snapshot, including unchanged requirements.\n\n'
    + `Previous reviewed snapshot:\n${JSON.stringify(prior)}\n\n`
    + `Turn ${turn} evidence (session seqs are citation ids):\n${sources}\n\n`
    + `Requirement Notebook artifacts (session seqs are citation ids):\n${JSON.stringify(roundArtifacts)}`
  if (body.length <= maxInputChars) return body
  const suffix = body.slice(body.length - maxInputChars)
  return `Earlier reviewer input was truncated to the configured character limit. Preserve ids only when the retained evidence supports them.\n${suffix}`
}

function boundedDiagnostic(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  return text.length <= 512 ? text : `${text.slice(0, 509)}...`
}

function authoredText(value: RequirementText, language: RequirementAuthoringLanguage): string {
  return typeof value === 'string' ? value : value[language]
}

function latestReviewedRequirement(session: Session, id: string): RequirementRevision | undefined {
  return previousReview(session.events)?.requirements.find(requirement => (
    requirement.id === id && requirement.lifecycle === 'active'
  ))
}

function userVersions(session: Session, id?: string): RequirementUserVersionEvent[] {
  return session.events.flatMap(event => (
    event.type === 'requirement/user-version' && (id === undefined || event.data.requirementId === id)
      ? [event.data]
      : []
  ))
}

function latestUserVersion(session: Session, id: string): RequirementUserVersionEvent | undefined {
  return userVersions(session, id).at(-1)
}

function requirementExists(session: Session, id: string): boolean {
  return latestUserVersion(session, id) !== undefined || latestReviewedRequirement(session, id) !== undefined
}

function currentRequirementVersion(session: Session, id: string): number | undefined {
  const userVersion = latestUserVersion(session, id)
  if (userVersion !== undefined) return userVersion.requirementVersion
  return latestReviewedRequirement(session, id) === undefined ? undefined : 1
}

function nextRequirementId(session: Session): RequirementId {
  const ids = new Set([
    ...(previousReview(session.events)?.requirements.map(requirement => requirement.id) ?? []),
    ...userVersions(session).map(event => event.requirementId),
  ])
  const usesReqPrefix = [...ids].some(id => /^REQ-\d+$/iu.test(id))
  let maximum = 0
  for (const id of ids) {
    const match = /^(?:REQ-|R)(\d+)$/iu.exec(id)
    if (match?.[1] !== undefined) maximum = Math.max(maximum, Number(match[1]))
  }
  const next = maximum + 1
  return (usesReqPrefix ? `REQ-${String(next).padStart(2, '0')}` : `R${next}`) as RequirementId
}

function normalizedRequirementText(value: string, field: 'title' | 'statement'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`requirement ${field} must be a non-empty string`)
  }
  return value.trim()
}

function normalizedTaskText(value: string, field: 'title' | 'statement'): string {
  if (typeof value !== 'string') throw new TypeError(`task ${field} must be a string`)
  return value.trim()
}

function markdownNoteText(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Markdown note content must be a string')
  return value
}

function hasTaskContent(task: RequirementTask): boolean {
  return task.title.trim() !== '' || task.statement.trim() !== ''
}

function requirementPrompt(
  operation: 'added' | 'revised',
  id: RequirementId,
  version: number,
  title: string,
  statement: string,
  language: RequirementAuthoringLanguage,
  previous: { readonly title: string; readonly statement: string } | undefined,
  afterId: RequirementId | undefined,
): string {
  if (language === 'zh') {
    if (operation === 'added') {
      const heading = afterId === undefined ? `新增 ${id}` : `在 ${afterId} 后新增 ${id}`
      return `${heading}\n\n需求：\n${title}\n${statement}\n\n其他现有需求保持不变。`
    }
    return `修改 ${id} 为 v${version}\n\n原需求：\n${previous?.title ?? ''}\n${previous?.statement ?? ''}\n\n新需求：\n${title}\n${statement}\n\n其他现有需求保持不变。`
  }
  if (operation === 'added') {
    const heading = afterId === undefined ? `Add ${id}` : `Add ${id} after ${afterId}`
    return `${heading}\n\nRequirement:\n${title}\n${statement}\n\nAll other existing requirements remain unchanged.`
  }
  return `Revise ${id} as v${version}\n\nPrevious requirement:\n${previous?.title ?? ''}\n${previous?.statement ?? ''}\n\nNew requirement:\n${title}\n${statement}\n\nAll other existing requirements remain unchanged.`
}

function userVersionForMessage(session: Session, messageId: string): RequirementUserVersionEvent | undefined {
  return session.events.findLast(event => (
    event.type === 'requirement/user-version' && event.data.messageId === messageId
  ))?.data as RequirementUserVersionEvent | undefined
}

function latestExecution(
  session: Session,
  version: RequirementUserVersionEvent,
): RequirementExecutionEvent | undefined {
  return session.events.findLast(event => (
    event.type === 'requirement/execution'
      && event.data.requirementId === version.requirementId
      && event.data.requirementVersion === version.requirementVersion
  ))?.data as RequirementExecutionEvent | undefined
}

function rounds(session: Session): RequirementRoundEvent[] {
  return session.events.flatMap(event => event.type === 'requirement/round' ? [event.data] : [])
}

function latestRound(session: Session, roundId?: RequirementRoundId): RequirementRoundEvent | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'requirement/round'
    && (roundId === undefined || candidate.data.roundId === roundId))
  return event?.type === 'requirement/round' ? event.data : undefined
}

function roundForTurn(session: Session, turn: number): RequirementRoundEvent | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'requirement/round'
    && candidate.data.turn === turn)
  return event?.type === 'requirement/round' ? event.data : undefined
}

function latestPlan(session: Session, roundId: RequirementRoundId): RequirementPlanEvent | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'requirement/plan'
    && candidate.data.roundId === roundId)
  return event?.type === 'requirement/plan' ? event.data : undefined
}

function latestPlanSeq(session: Session, roundId: RequirementRoundId): number | undefined {
  return session.events.findLast(event => event.type === 'requirement/plan'
    && event.data.roundId === roundId)?.seq
}

function latestTaskList(session: Session, roundId: RequirementRoundId): RequirementTaskListEvent | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'requirement/task-list'
    && candidate.data.roundId === roundId)
  return event?.type === 'requirement/task-list' ? event.data : undefined
}

function latestTaskExecution(
  session: Session,
  roundId: RequirementRoundId,
  taskId: RequirementTaskId,
): RequirementTaskExecutionEvent | undefined {
  const event = session.events.findLast(candidate => candidate.type === 'requirement/task-execution'
    && candidate.data.roundId === roundId && candidate.data.taskId === taskId)
  return event?.type === 'requirement/task-execution' ? event.data : undefined
}

function shortHash(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableTaskId(roundId: RequirementRoundId, title: string, statement: string): RequirementTaskId {
  return `TASK-${shortHash(`${roundId}\n${title}\n${statement}`)}` as RequirementTaskId
}

function currentOpenTurn(session: Session): number | undefined {
  let open: number | undefined
  for (const event of session.events) {
    if (event.type === 'turn/start') open = event.data.turn
    else if (event.type === 'turn/end') open = undefined
  }
  return open
}

function planFromArguments(argumentsText: string): string | undefined {
  try {
    const value: unknown = JSON.parse(argumentsText)
    if (typeof value !== 'object' || value === null || !('plan' in value)) return undefined
    const plan = (value as { plan?: unknown }).plan
    return typeof plan === 'string' && plan.trim() !== '' ? plan : undefined
  } catch {
    return undefined
  }
}

function markdownForRound(input: string, language: RequirementAuthoringLanguage): string {
  const heading = language === 'zh' ? '# 用户需求' : '# User requirement'
  return `${heading}\n\n${input}`
}

function taskStatus(value: 'pending' | 'in_progress' | 'completed'): RequirementTask['status'] {
  return value
}

function taskTextFromTodo(content: string, order: number): Pick<RequirementTask, 'title' | 'statement'> {
  const normalized = content.replaceAll('\r\n', '\n').trim()
  const [title = '', ...statementLines] = normalized.split('\n')
  const statement = statementLines.join('\n').trim()
  if (title.trim() === '' || statement === '') {
    return { title: `Task ${order + 1}`, statement: normalized }
  }
  return { title: title.trim(), statement }
}

function taskListFromTodo(
  roundId: RequirementRoundId,
  todos: readonly { readonly content: string; readonly status: 'pending' | 'in_progress' | 'completed' }[],
  previous: RequirementTaskListEvent | undefined,
): RequirementTask[] {
  return todos.map((todo, order) => {
    const text = taskTextFromTodo(todo.content, order)
    return {
      id: previous?.tasks.find(task => task.status !== 'withdrawn'
        && task.title === text.title && task.statement === text.statement)?.id
        ?? stableTaskId(roundId, text.title, text.statement),
      order,
      ...text,
      status: taskStatus(todo.status),
    }
  })
}

function taskListWithStatus(
  list: RequirementTaskListEvent,
  taskId: RequirementTaskId,
  status: RequirementTask['status'],
): RequirementTask[] {
  return list.tasks.map(task => task.id === taskId ? { ...task, status } : { ...task })
}

function localizedSummary(
  round: RequirementRoundEvent,
  regressions: readonly RequirementRegression[],
  failedTaskIds: readonly RequirementTaskId[],
): RequirementText {
  const zhRound = `第 ${round.round} 轮`
  const enRound = `Round ${round.round}`
  if (regressions.length > 0) {
    return { zh: `${zhRound} 验证发现 ${regressions.length} 个历史需求被本轮意外破坏。`, en: `Validation of ${enRound} found ${regressions.length} historical requirement regression(s).` }
  }
  if (failedTaskIds.length > 0) {
    return { zh: `${zhRound} 的任务执行存在失败项，未确认历史需求回归。`, en: `${enRound} has failed task executions; no historical requirement regression was confirmed.` }
  }
  return { zh: `${zhRound} 已完成独立验证，未发现历史需求回归。`, en: `${enRound} completed independent validation with no historical requirement regression.` }
}

/** Coordinates user-owned versions and serialized independent reviews. */
export class SessionRequirements extends TypertRemoteService {
  static inject = ['agents', 'subagents']

  static Config: s<Config> = s.object({
    reviewerProvider: s.string().required(),
    maxInputChars: s.number().step(1).min(1).required(),
    reviewerTools: s.array(s.string()).required(),
  })

  private readonly states = new WeakMap<Session, ReviewState>()
  private readonly liveStates = new Set<ReviewState>()
  private readonly runAllStates = new WeakMap<Session, RunAllState>()

  /**
   * @param ctx - Host context carrying live agents and the subagent registry.
   * @param config - Explicit reviewer provider, prompt cap, and read-only tools.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'sessionRequirements')
    ctx.effect(() => async () => {
      for (const state of this.liveStates) {
        for (const controller of state.controllers) controller.abort('session-requirements disposed')
      }
      await Promise.allSettled([...this.liveStates].map(state => state.tail))
      this.liveStates.clear()
    }, 'session-requirements.reviewDrain')

    ctx.on('session/event', (session, event) => {
      queueMicrotask(() => {
        try {
          this.trackExecution(session, event)
          this.trackPipeline(session, event)
          if (event.type !== 'turn/end' || session.header.origin === 'subagent') return
          const agent = ctx.agents.get(session.id)
          if (agent === undefined || agent.session !== session) return
          void this.review(agent, event.data.turn)
        } catch (error: unknown) {
          ctx.logger.warn('dsh-session-requirements: failed to project Session event: %o', error)
        }
      })
    })

    ctx.on('session/disposed', (session) => {
      const state = this.states.get(session)
      if (state === undefined) return
      for (const controller of state.controllers) controller.abort('parent session disposed')
    })

    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      const version = userVersionForMessage(agent.session, message.id)
      if (version !== undefined && latestExecution(agent.session, version) === undefined) {
        agent.session.append('requirement/execution', {
          version: 1,
          requirementId: version.requirementId,
          requirementVersion: version.requirementVersion,
          messageId: version.messageId,
          status: 'failed',
        })
      }
      const task = this.taskExecutionForMessage(agent.session, message.id)
      if (task === undefined) return
      const latest = latestTaskExecution(agent.session, task.roundId, task.taskId)
      if (latest === undefined || latest.status === 'completed' || latest.status === 'failed') return
      agent.session.append('requirement/task-execution', {
        version: 1,
        revision: latest.revision + 1,
        roundId: task.roundId,
        taskId: task.taskId,
        messageId: task.messageId,
        status: 'failed',
        ...(task.turn === undefined ? {} : { turn: task.turn }),
        output: 'Task message was discarded before execution completed.',
      })
      const list = latestTaskList(agent.session, task.roundId)
      if (list !== undefined) {
        this.appendTaskList(agent.session, task.roundId,
          taskListWithStatus(list, task.taskId, 'failed'), list.planSeq)
      }
      const runAll = this.runAllStates.get(agent.session)
      if (runAll?.roundId === task.roundId) this.runAllStates.delete(agent.session)
    })

    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'requirements',
        description: 'Run an independent requirement and implementation review',
        handler: async ({ agent }) => {
          const end = agent.session.events.findLast(event => event.type === 'turn/end')
          const turn = end?.type === 'turn/end' ? end.data.turn : 0
          await this.review(agent, turn)
          return { kind: 'success', text: 'Requirements reviewed.' }
        },
      })
    })
  }

  /**
   * Start one product requirement round. The raw request, Markdown artifact,
   * and the live Agent composition's plan-mode selection are recorded before
   * the Agent is woken.
   * @param agent - exact live Agent that receives the round.
   * @param request - raw requirement and authoring language.
   * @returns the durable round identity and first event sequence.
   */
  @Remote('startRound')
  startRound(agent: Agent, request: RequirementRoundStartRequest): RequirementRoundStartResult {
    this.requireLiveAgent(agent)
    normalizedRequirementText(request.input, 'statement')
    const input = request.input
    this.requireLanguage(request.language)
    const session = agent.session
    const round = Math.max(0, ...rounds(session).map(item => item.round)) + 1
    const roundId = `ROUND-${String(round).padStart(2, '0')}` as RequirementRoundId
    const message = createUserMessage({
      content: [{ type: 'text', text: this.roundPrompt(round, input, request.language) }],
      source: { kind: 'user' },
    })
    const roundEvent = session.append('requirement/round', {
      version: 1,
      revision: 1,
      roundId,
      round,
      sourceMessageId: message.id,
      language: request.language,
      input,
      status: 'planning',
    })
    session.append('requirement/markdown', {
      version: 1,
      revision: 1,
      roundId,
      sourceMessageId: message.id,
      language: request.language,
      markdown: markdownForRound(input, request.language),
    })
    try {
      const planMode = (this.ctx.get('agentPresets')?.serviceFor(agent, 'planMode')
        ?? this.ctx.get('planMode')) as PlanModeLike | undefined
      if (planMode === undefined) throw new Error('plan mode is not available for a requirement round')
      planMode.set(agent, true)
      agent.followup(message)
    } catch (error: unknown) {
      this.updateRound(session, roundId, { status: 'failed' })
      throw error
    }
    return { roundId, round, eventSeq: roundEvent.seq }
  }

  /**
   * Queue one nonblank task cell as a standalone Agent turn; empty drafts are rejected.
   * @param agent - exact live Agent that receives the task.
   * @param request - round and stable task identity.
   * @returns the task execution identity and submitted event sequence.
   */
  @Remote('runTask')
  runTask(agent: Agent, request: RequirementTaskRunRequest): RequirementTaskRunResult {
    this.requireLiveAgent(agent)
    const session = agent.session
    const round = latestRound(session, request.roundId)
    if (round === undefined) throw new Error(`requirement round "${request.roundId}" does not exist`)
    const list = latestTaskList(session, request.roundId)
    const task = list?.tasks.find(item => item.id === request.taskId)
    if (list === undefined || task === undefined) {
      throw new Error(`requirement task "${request.taskId}" does not exist`)
    }
    if (task.status === 'withdrawn') throw new Error(`requirement task "${request.taskId}" is withdrawn`)
    if (!hasTaskContent(task)) throw new Error(`requirement task "${request.taskId}" is empty`)
    const otherRunningTask = list.tasks.find(item => item.id !== request.taskId && item.status === 'in_progress')
    if (otherRunningTask !== undefined) {
      throw new Error(`requirement task "${otherRunningTask.id}" is already running`)
    }
    const previous = latestTaskExecution(session, request.roundId, request.taskId)
    if (previous?.status === 'submitted' || previous?.status === 'processing') {
      throw new Error(`requirement task "${request.taskId}" is already running`)
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: this.taskPrompt(round, task) }],
      source: { kind: 'user' },
    })
    session.append('requirement/task-list', {
      version: 1,
      revision: list.revision + 1,
      roundId: request.roundId,
      ...(list.planSeq === undefined ? {} : { planSeq: list.planSeq }),
      tasks: taskListWithStatus(list, request.taskId, 'in_progress'),
    })
    this.updateRound(session, request.roundId, { status: 'executing' })
    const execution = session.append('requirement/task-execution', {
      version: 1,
      revision: (previous?.revision ?? 0) + 1,
      roundId: request.roundId,
      taskId: request.taskId,
      messageId: message.id,
      status: 'submitted',
    })
    try {
      agent.followup(message)
    } catch (error: unknown) {
      session.append('requirement/task-execution', {
        version: 1,
        revision: execution.data.revision + 1,
        roundId: request.roundId,
        taskId: request.taskId,
        messageId: message.id,
        status: 'failed',
        output: boundedDiagnostic(error),
      })
      session.append('requirement/task-list', {
        version: 1,
        revision: list.revision + 2,
        roundId: request.roundId,
        ...(list.planSeq === undefined ? {} : { planSeq: list.planSeq }),
        tasks: taskListWithStatus(list, request.taskId, 'failed'),
      })
      throw error
    }
    return { roundId: request.roundId, taskId: request.taskId, eventSeq: execution.seq }
  }

  /**
   * Insert one manually authored task, including an empty pending draft, into the current round.
   * @param agent - exact live Agent that owns the round.
   * @param request - task text and optional insertion point.
   * @returns the durable task identity and task-list event sequence.
   */
  @Remote('addTask')
  addTask(agent: Agent, request: RequirementTaskAddRequest): RequirementTaskMutationResult {
    this.requireLiveAgent(agent)
    const title = normalizedTaskText(request.title, 'title')
    const statement = normalizedTaskText(request.statement, 'statement')
    const session = agent.session
    const list = latestTaskList(session, request.roundId)
    if (list === undefined) throw new Error(`requirement task list for round "${request.roundId}" does not exist`)
    const afterIndex = request.afterTaskId === undefined
      ? list.tasks.length - 1
      : list.tasks.findIndex(task => task.id === request.afterTaskId)
    if (request.afterTaskId !== undefined && afterIndex < 0) {
      throw new Error(`requirement task "${request.afterTaskId}" does not exist`)
    }
    const taskId = stableTaskId(request.roundId, `manual-${list.revision + 1}`, `${title}\n${statement}`)
    const task: RequirementTask = { id: taskId, order: 0, title, statement, status: 'pending' }
    const tasks = [...list.tasks]
    tasks.splice(afterIndex + 1, 0, task)
    const ordered = tasks.map((item, order) => ({ ...item, order }))
    const event = this.appendTaskList(session, request.roundId, ordered, list.planSeq)
    return { roundId: request.roundId, taskId, eventSeq: event.seq }
  }

  /**
   * Persist a task's editable text, including empty drafts, and return it to the pending state.
   * @param agent - exact live Agent that owns the round.
   * @param request - task identity and replacement text.
   * @returns the durable task identity and task-list event sequence.
   */
  @Remote('editTask')
  editTask(agent: Agent, request: RequirementTaskEditRequest): RequirementTaskMutationResult {
    this.requireLiveAgent(agent)
    const title = normalizedTaskText(request.title, 'title')
    const statement = normalizedTaskText(request.statement, 'statement')
    const session = agent.session
    const list = latestTaskList(session, request.roundId)
    const task = list?.tasks.find(item => item.id === request.taskId)
    if (list === undefined || task === undefined) throw new Error(`requirement task "${request.taskId}" does not exist`)
    if (task.status === 'in_progress') throw new Error(`requirement task "${request.taskId}" is running`)
    const event = this.appendTaskList(session, request.roundId, list.tasks.map(item => item.id === request.taskId
      ? { ...item, title, statement, status: 'pending' }
      : { ...item }), list.planSeq)
    return { roundId: request.roundId, taskId: request.taskId, eventSeq: event.seq }
  }

  /**
   * Move a task one position in the current Plan without executing it.
   * @param agent - exact live Agent that owns the round.
   * @param request - task identity and direction.
   * @returns the durable task identity and task-list event sequence.
   */
  @Remote('moveTask')
  moveTask(agent: Agent, request: RequirementTaskMoveRequest): RequirementTaskMutationResult {
    this.requireLiveAgent(agent)
    const session = agent.session
    const list = latestTaskList(session, request.roundId)
    const index = list?.tasks.findIndex(task => task.id === request.taskId) ?? -1
    if (list === undefined || index < 0) throw new Error(`requirement task "${request.taskId}" does not exist`)
    if (list.tasks.some(task => task.status === 'in_progress')) throw new Error('cannot reorder while a task is running')
    const target = request.direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= list.tasks.length) throw new Error('task is already at the requested edge')
    const tasks = [...list.tasks]
    const [moved] = tasks.splice(index, 1)
    if (moved === undefined) throw new Error(`requirement task "${request.taskId}" does not exist`)
    tasks.splice(target, 0, moved)
    const event = this.appendTaskList(session, request.roundId,
      tasks.map((task, order) => ({ ...task, order })), list.planSeq)
    return { roundId: request.roundId, taskId: request.taskId, eventSeq: event.seq }
  }

  /**
   * Withdraw a task while retaining its historical task-list entries.
   * @param agent - exact live Agent that owns the round.
   * @param request - task identity to withdraw.
   * @returns the durable task identity and task-list event sequence.
   */
  @Remote('withdrawTask')
  withdrawTask(agent: Agent, request: RequirementTaskWithdrawRequest): RequirementTaskMutationResult {
    this.requireLiveAgent(agent)
    const session = agent.session
    const list = latestTaskList(session, request.roundId)
    const task = list?.tasks.find(item => item.id === request.taskId)
    if (list === undefined || task === undefined) throw new Error(`requirement task "${request.taskId}" does not exist`)
    if (task.status !== 'pending') {
      throw new Error(`requirement task "${request.taskId}" can no longer be withdrawn`)
    }
    const event = this.appendTaskList(session, request.roundId, list.tasks.map(item => item.id === request.taskId
      ? { ...item, status: 'withdrawn' }
      : { ...item }), list.planSeq)
    return { roundId: request.roundId, taskId: request.taskId, eventSeq: event.seq }
  }

  /**
   * Run the next pending task and continue in order after each completed task, skipping empty drafts.
   * @param agent - exact live Agent that receives the task turns.
   * @param request - round whose pending tasks should run.
   * @returns the first queued task, when one exists.
   */
  @Remote('runAll')
  runAll(agent: Agent, request: RequirementRunAllRequest): RequirementRunAllResult {
    this.requireLiveAgent(agent)
    if (this.runAllStates.has(agent.session)) {
      throw new Error(`requirement tasks for round "${request.roundId}" are already running`)
    }
    const list = latestTaskList(agent.session, request.roundId)
    const next = list?.tasks.find(task => hasTaskContent(task) && (task.status === 'pending' || task.status === 'failed'))
    if (list === undefined || next === undefined) return { roundId: request.roundId }
    this.runAllStates.set(agent.session, { agent, roundId: request.roundId })
    try {
      return this.runTask(agent, { roundId: request.roundId, taskId: next.id })
    } catch (error: unknown) {
      this.runAllStates.delete(agent.session)
      throw error
    }
  }

  /**
   * Add a durable note; passive Markdown may be empty, dispatched notes and comments must be nonblank.
   * @param agent - exact live Agent that receives the note.
   * @param request - round, cell kind, and user-authored content.
   * @returns the note identity and event sequence.
   */
  @Remote('addNote')
  addNote(agent: Agent, request: RequirementNoteRequest): RequirementNoteResult {
    this.requireLiveAgent(agent)
    const round = latestRound(agent.session, request.roundId)
    if (round === undefined) throw new Error(`requirement round "${request.roundId}" does not exist`)
    const kind: unknown = request.kind
    if (kind !== 'text' && kind !== 'comment') throw new TypeError('requirement note has an invalid kind')
    const dispatch: unknown = request.dispatch
    if (typeof dispatch !== 'boolean') throw new TypeError('requirement note dispatch must be a boolean')
    const content = request.kind === 'text' && !request.dispatch
      ? markdownNoteText(request.content)
      : normalizedRequirementText(request.content, 'statement')
    const noteCount = agent.session.events.filter(event => event.type === 'requirement/note'
      && event.data.roundId === request.roundId).length + 1
    const noteId = `NOTE-${String(noteCount).padStart(2, '0')}` as RequirementNoteId
    const message = request.dispatch
      ? createUserMessage({
        content: [{ type: 'text', text: this.notePrompt(round, request.kind, content) }],
        source: { kind: 'user' },
      })
      : undefined
    const note = agent.session.append('requirement/note', {
      version: 1,
      roundId: request.roundId,
      noteId,
      kind: request.kind,
      content,
      dispatched: request.dispatch,
      ...(message === undefined ? {} : { messageId: message.id }),
    })
    if (message !== undefined) agent.followup(message)
    return { roundId: request.roundId, noteId, eventSeq: note.seq }
  }

  /**
   * Persist replacement Markdown for a passive text note without dispatching a message.
   * @param agent - exact live Agent that owns the note's Session.
   * @param request - round, note identity, and verbatim Markdown source; empty text is allowed.
   * @returns the existing note identity and new event sequence; missing or dispatched notes are rejected.
   */
  @Remote('editNote')
  editNote(agent: Agent, request: RequirementNoteEditRequest): RequirementNoteResult {
    this.requireLiveAgent(agent)
    const content = markdownNoteText(request.content)
    const previous = agent.session.events.findLast(event => event.type === 'requirement/note'
      && event.data.roundId === request.roundId && event.data.noteId === request.noteId)
    if (previous?.type !== 'requirement/note') throw new Error(`requirement note "${request.noteId}" does not exist`)
    if (previous.data.kind !== 'text' || previous.data.dispatched) {
      throw new Error('only passive Markdown notes can be edited')
    }
    const event = agent.session.append('requirement/note', { ...previous.data, content })
    return { roundId: request.roundId, noteId: request.noteId, eventSeq: event.seq }
  }

  private requireLiveAgent(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new Error(`requirements agent "${agent.id}" is not live`)
    }
  }

  private requireLanguage(language: RequirementAuthoringLanguage): void {
    const value: unknown = language
    if (value !== 'zh' && value !== 'en') throw new TypeError('requirement language must be zh or en')
  }

  private roundPrompt(round: number, input: string, language: RequirementAuthoringLanguage): string {
    return language === 'zh'
      ? `第 ${round} 轮需求 Notebook\n\n用户原始需求（请保留原意并先整理成 Markdown）：\n${input}\n\n请自动进入 Plan 模式，提出完整可执行的 Plan。Plan 获得批准后，立即用 todo_write 按原顺序为 Plan 中的每个顶层编号阶段（每个 \`## N. 阶段标题\`）创建一个 Todo。不要把同一阶段内的 \`N.1\`、\`N.2\` 等勾选项拆成多个 Todo，也不要把不同阶段合并。每个 Todo 的 content 必须采用以下结构：\n<第一行：用一句不依赖技术背景也能看懂的话概括整个阶段完成后会得到什么；不要使用“Task 1”等泛称，也不要重复阶段编号>\n技术细节：\n## N. <阶段标题>\n- [ ] N.1 <任务内容>\n  - <具体操作>\n<继续完整保留该阶段直到下一个 \`##\` 标题之前的所有勾选项和缩进细节>\n必须保留该阶段的完整标题、任务编号、checkbox 状态、文件、命令、配置、依赖、实现子步骤和验证条件；不得压缩成关键词串，不得省略细节。不要删除或改变历史需求，除非用户明确提出修改。`
      : `Requirement Notebook round ${round}\n\nRaw user requirement (preserve its intent and first organize it as Markdown):\n${input}\n\nEnter Plan mode automatically and present a complete executable Plan. After approval, immediately use todo_write to create one Todo for each top-level numbered Plan phase (each \`## N. Phase title\`), in the same order. Do not split the \`N.1\`, \`N.2\`, and other checklist items within one phase into separate Todos, and do not merge different phases. Every Todo content must use this structure:\n<First line: one plain-language sentence explaining what completing the whole phase gives the user or project, without requiring technical knowledge; do not use generic labels such as "Task 1" or repeat the phase number>\nTechnical details:\n## N. <Phase title>\n- [ ] N.1 <Task content>\n  - <Concrete action>\n<Continue with every checklist item and indented detail in this phase, stopping immediately before the next \`##\` heading>\nPreserve the complete phase title, task numbers, checkbox states, files, commands, configuration, dependencies, implementation substeps, and validation conditions. Do not compress them into a keyword string or omit details. Do not remove or change historical requirements unless the user explicitly asks for it.`
  }

  private taskPrompt(round: RequirementRoundEvent, task: RequirementTask): string {
    return round.language === 'zh'
      ? `继续执行第 ${round.round} 轮需求 Notebook 的任务 ${task.order + 1}：${task.title}\n\n任务说明：\n${task.statement}\n\n只完成这个任务，保留当前 Notebook 中已确认的其他需求，并在完成后给出可验证结果。`
      : `Continue the Requirement Notebook round ${round.round} task ${task.order + 1}: ${task.title}\n\nTask statement:\n${task.statement}\n\nComplete only this task, preserve the other confirmed requirements in the Notebook, and report a verifiable result when done.`
  }

  private notePrompt(round: RequirementRoundEvent, kind: 'text' | 'comment', content: string): string {
    const label = kind === 'text' ? 'text cell' : 'comment'
    return round.language === 'zh'
      ? `第 ${round.round} 轮 Notebook 新增${kind === 'text' ? '文本单元格' : '批注'}：\n${content}\n\n请把它作为本轮需求上下文处理。`
      : `New ${label} in Requirement Notebook round ${round.round}:\n${content}\n\nTreat it as context for this requirement round.`
  }

  private updateRound(
    session: Session,
    roundId: RequirementRoundId,
    update: Partial<Pick<RequirementRoundEvent, 'status' | 'turn'>>,
  ): RequirementRoundEvent {
    const current = latestRound(session, roundId)
    if (current === undefined) throw new Error(`requirement round "${roundId}" does not exist`)
    const next = { ...current, ...update }
    if (next.status === current.status && next.turn === current.turn) return current
    return session.append('requirement/round', {
      ...next,
      version: 1,
      revision: current.revision + 1,
    }).data
  }

  private appendTaskList(
    session: Session,
    roundId: RequirementRoundId,
    tasks: readonly RequirementTask[],
    planSeq?: number,
  ): RequirementTaskListEvent & { readonly seq: number } {
    const previous = latestTaskList(session, roundId)
    const data: RequirementTaskListEvent = {
      version: 1,
      revision: (previous?.revision ?? 0) + 1,
      roundId,
      tasks: tasks.map(task => ({ ...task })),
      ...(planSeq === undefined ? {} : { planSeq }),
    }
    const event = session.append('requirement/task-list', data)
    return { ...event.data, seq: event.seq }
  }

  private appendTaskExecution(
    session: Session,
    previous: RequirementTaskExecutionEvent | undefined,
    data: Omit<RequirementTaskExecutionEvent, 'version' | 'revision'>,
  ): RequirementTaskExecutionEvent {
    return session.append('requirement/task-execution', {
      version: 1,
      revision: (previous?.revision ?? 0) + 1,
      ...data,
    }).data
  }

  private roundForMessage(session: Session, messageId: string): RequirementRoundEvent | undefined {
    const round = session.events.findLast(event => event.type === 'requirement/round'
      && event.data.sourceMessageId === messageId)
    if (round?.type === 'requirement/round') return round.data
    const execution = session.events.findLast(event => event.type === 'requirement/task-execution'
      && event.data.messageId === messageId)
    if (execution?.type === 'requirement/task-execution') return latestRound(session, execution.data.roundId)
    const note = session.events.findLast(event => event.type === 'requirement/note'
      && event.data.dispatched && event.data.messageId === messageId)
    return note?.type === 'requirement/note' ? latestRound(session, note.data.roundId) : undefined
  }

  private taskExecutionForMessage(session: Session, messageId: string): RequirementTaskExecutionEvent | undefined {
    const event = session.events.findLast(candidate => candidate.type === 'requirement/task-execution'
      && candidate.data.messageId === messageId)
    return event?.type === 'requirement/task-execution' ? event.data : undefined
  }

  private assistantOutput(session: Session, turn: number): string | undefined {
    const output = session.events.flatMap(event => event.type === 'assistant/message' && event.data.turn === turn
      ? [textOf(event.data.message.content)]
      : []).filter(text => text.trim() !== '').join('\n')
    if (output === '') return undefined
    return output.length <= 4000 ? output : `${output.slice(0, 3997)}...`
  }

  private trackPipeline(session: Session, event: SessionEvent): void {
    if (event.type === 'user/message') {
      const round = this.roundForMessage(session, event.data.id)
      const turn = currentOpenTurn(session)
      if (round !== undefined && turn !== undefined) this.updateRound(session, round.roundId, { turn })
      const execution = this.taskExecutionForMessage(session, event.data.id)
      if (execution !== undefined && turn !== undefined) {
        this.appendTaskExecution(session, execution, {
          roundId: execution.roundId,
          taskId: execution.taskId,
          messageId: execution.messageId,
          status: 'processing',
          turn,
        })
      }
      return
    }
    if (event.type === 'tool/call' && event.data.name === 'exit_plan_mode') {
      const round = roundForTurn(session, event.data.turn)
      const plan = planFromArguments(event.data.arguments)
      if (round === undefined || plan === undefined) return
      const previous = latestPlan(session, round.roundId)
      session.append('requirement/plan', {
        version: 1,
        revision: (previous?.revision ?? 0) + 1,
        roundId: round.roundId,
        turn: event.data.turn,
        status: 'proposed',
        markdown: plan,
      })
      this.updateRound(session, round.roundId, { status: 'awaiting-approval' })
      return
    }
    if ((event as { type: string }).type === 'plan/mode') {
      const data = (event as unknown as { data: { active: boolean } }).data
      if (data.active) return
      const round = session.events.findLast(candidate => candidate.type === 'requirement/round'
        && candidate.data.status === 'awaiting-approval')
      if (round?.type !== 'requirement/round') return
      const plan = latestPlan(session, round.data.roundId)
      if (plan?.status !== 'proposed') return
      session.append('requirement/plan', {
        ...plan,
        version: 1,
        revision: plan.revision + 1,
        status: 'approved',
      })
      this.updateRound(session, round.data.roundId, { status: 'executing' })
      return
    }
    if ((event as { type: string }).type === 'todo/write') {
      const data = (event as unknown as { data: { todos: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[] } }).data
      const turn = currentOpenTurn(session)
      const round = turn === undefined ? undefined : roundForTurn(session, turn)
      if (round === undefined || !Array.isArray(data.todos)) return
      const current = latestTaskList(session, round.roundId)
      const tasks = taskListFromTodo(round.roundId, data.todos, current)
      if (current === undefined || JSON.stringify(current.tasks) !== JSON.stringify(tasks)) {
        this.appendTaskList(session, round.roundId, tasks, latestPlanSeq(session, round.roundId))
      }
      this.updateRound(session, round.roundId, { status: 'executing' })
      return
    }
    if (event.type !== 'turn/end') return
    const round = roundForTurn(session, event.data.turn)
    if (round === undefined) return
    const completed = event.data.reason.kind === 'completed'
    const output = this.assistantOutput(session, event.data.turn)
    const taskExecutions = session.events.filter(candidate => candidate.type === 'requirement/task-execution'
      && candidate.data.turn === event.data.turn && candidate.data.status === 'processing')
    for (const candidate of taskExecutions) {
      if (candidate.type !== 'requirement/task-execution') continue
      this.appendTaskExecution(session, candidate.data, {
        roundId: candidate.data.roundId,
        taskId: candidate.data.taskId,
        messageId: candidate.data.messageId,
        status: completed ? 'completed' : 'failed',
        turn: event.data.turn,
        ...(output === undefined ? {} : { output }),
      })
      const list = latestTaskList(session, candidate.data.roundId)
      if (list !== undefined) {
        this.appendTaskList(session, candidate.data.roundId,
          taskListWithStatus(list, candidate.data.taskId, completed ? 'completed' : 'failed'), list.planSeq)
      }
    }
    const runAll = this.runAllStates.get(session)
    if (runAll?.roundId === round.roundId && completed) {
      const next = latestTaskList(session, round.roundId)?.tasks.find(task => task.status === 'pending' && hasTaskContent(task))
      if (next !== undefined) {
        try {
          this.runTask(runAll.agent, { roundId: round.roundId, taskId: next.id })
          return
        } catch {
          this.runAllStates.delete(session)
        }
      } else {
        this.runAllStates.delete(session)
      }
    } else if (runAll?.roundId === round.roundId) {
      this.runAllStates.delete(session)
    }
    const currentPlan = latestPlan(session, round.roundId)
    const currentTasks = latestTaskList(session, round.roundId)
    const hasUnfinishedTasks = currentTasks?.tasks.some(task => (
      (task.status === 'pending' && hasTaskContent(task)) || task.status === 'in_progress'
    )) ?? false
    if (currentPlan?.status === 'proposed' && currentTasks === undefined) {
      this.updateRound(session, round.roundId, { status: 'awaiting-approval' })
    } else if (currentTasks === undefined || hasUnfinishedTasks) {
      this.updateRound(session, round.roundId, { status: 'executing' })
    } else {
      this.updateRound(session, round.roundId, { status: 'validating' })
    }
  }

  /**
   * Commit one user-authored requirement version, then queue its exact change
   * as an ordinary user turn. The durable version remains current when Agent
   * execution later fails.
   * @param agent - exact live Agent that receives the change prompt.
   * @param request - added or revised requirement content.
   * @returns committed identity, version, and event sequence.
   */
  @Remote('commit')
  commit(agent: Agent, request: RequirementCommitRequest): RequirementCommitResult {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new Error(`requirements agent "${agent.id}" is not live`)
    }
    const title = normalizedRequirementText(request.title, 'title')
    const statement = normalizedRequirementText(request.statement, 'statement')
    const session = agent.session
    let requirementId: RequirementId
    let requirementVersion: number
    let operation: 'added' | 'revised'
    let afterId: RequirementId | undefined
    let previous: { readonly title: string; readonly statement: string } | undefined

    if (request.operation === 'add') {
      if (request.afterId !== undefined && !requirementExists(session, request.afterId)) {
        throw new Error(`requirement "${request.afterId}" does not exist`)
      }
      requirementId = nextRequirementId(session)
      requirementVersion = 1
      operation = 'added'
      afterId = request.afterId
    } else {
      const currentVersion = currentRequirementVersion(session, request.ref.id)
      if (currentVersion === undefined) throw new Error(`requirement "${request.ref.id}" does not exist`)
      if (!Number.isSafeInteger(request.ref.version) || request.ref.version < 1) {
        throw new TypeError('requirement revision must carry a positive safe-integer version')
      }
      if (currentVersion !== request.ref.version) {
        throw new Error(
          `stale requirement "${request.ref.id}" version ${request.ref.version}; current is ${currentVersion}`,
        )
      }
      const userVersion = latestUserVersion(session, request.ref.id)
      const reviewed = latestReviewedRequirement(session, request.ref.id)
      previous = userVersion === undefined
        ? reviewed === undefined ? undefined : {
          title: authoredText(reviewed.title, request.language),
          statement: authoredText(reviewed.statement, request.language),
        }
        : { title: userVersion.title, statement: userVersion.statement }
      requirementId = request.ref.id
      requirementVersion = currentVersion + 1
      operation = 'revised'
    }

    const prompt = requirementPrompt(
      operation,
      requirementId,
      requirementVersion,
      title,
      statement,
      request.language,
      previous,
      afterId,
    )
    const message = createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    })
    const versionEvent = session.append('requirement/user-version', {
      version: 1,
      operation,
      requirementId,
      requirementVersion,
      ...(afterId === undefined ? {} : { afterId }),
      language: request.language,
      title,
      statement,
      messageId: message.id,
    })
    try {
      agent.followup(message)
    } catch (error: unknown) {
      session.append('requirement/execution', {
        version: 1,
        requirementId,
        requirementVersion,
        messageId: message.id,
        status: 'failed',
      })
      throw error
    }
    return { requirementId, requirementVersion, eventSeq: versionEvent.seq }
  }

  /**
   * Queue one independent review after prior reviews for the same Session.
   * @param agent - Exact live parent Agent whose workspace and log are reviewed.
   * @param turn - Parent turn represented by the appended review event.
   * @returns when the review event has been appended or a failure recorded.
   */
  review(agent: Agent, turn: number): Promise<void> {
    const session = agent.session
    let state = this.states.get(session)
    if (state === undefined) {
      state = { controllers: new Set(), tail: Promise.resolve() }
      this.states.set(session, state)
    }
    this.liveStates.add(state)
    const queued = state.tail.catch(() => {}).then(() => this.runReview(agent, turn, state))
    state.tail = queued
    void queued.finally(() => {
      if (state.tail === queued && state.controllers.size === 0) this.liveStates.delete(state)
    }).catch(() => {})
    return queued
  }

  private trackExecution(session: Session, event: SessionEvent): void {
    if (event.type === 'user/message') {
      const version = userVersionForMessage(session, event.data.id)
      if (version === undefined || latestExecution(session, version) !== undefined) return
      const start = session.events.findLast(candidate => candidate.type === 'turn/start')
      if (start?.type !== 'turn/start') return
      session.append('requirement/execution', {
        version: 1,
        requirementId: version.requirementId,
        requirementVersion: version.requirementVersion,
        messageId: version.messageId,
        status: 'processing',
        turn: start.data.turn,
      })
      return
    }
    if (event.type !== 'turn/end') return
    const status = event.data.reason.kind === 'completed' ? 'completed' : 'failed'
    const versions = userVersions(session)
    for (const version of versions) {
      const execution = latestExecution(session, version)
      if (execution?.status !== 'processing' || execution.turn !== event.data.turn) continue
      session.append('requirement/execution', {
        version: 1,
        requirementId: version.requirementId,
        requirementVersion: version.requirementVersion,
        messageId: version.messageId,
        status,
        turn: event.data.turn,
      })
    }
  }

  private async runReview(agent: Agent, turn: number, state: ReviewState): Promise<void> {
    const session = agent.session
    const reviewedThroughSeq = session.events.at(-1)?.seq ?? -1
    const controller = new AbortController()
    state.controllers.add(controller)
    let run: SubagentRun | undefined
    try {
      run = await this.ctx.subagents.start(this.config.reviewerProvider, {
        label: `Requirements review · turn ${turn}`,
        prompt: [{ type: 'text', text: reviewerPrompt(session, turn, this.config.maxInputChars) }],
        parent: agent,
        signal: controller.signal,
        maxDepth: 1,
        toolFilter: { allow: this.config.reviewerTools },
        outputSchema: REVIEW_OUTPUT_SCHEMA,
      })
      const result = await run.result
      if (result.stopReason !== 'completed') {
        this.appendFailure(session, turn, reviewedThroughSeq, 'reviewer-failed', result.diagnostic ?? result.stopReason, run)
        return
      }
      if (result.structured === undefined) {
        this.appendFailure(session, turn, reviewedThroughSeq, 'invalid-output', 'reviewer returned no structured result', run)
        return
      }
      const analysis = result.structured as RequirementAnalysis
      const event: RequirementReviewEvent = {
        version: 2,
        status: 'completed',
        turn,
        reviewedThroughSeq,
        reviewerSessionId: run.id,
        requirements: analysis.requirements,
      }
      if (this.ctx.agents.get(session.id) === agent) {
        session.append('requirement/review', event)
        this.appendValidation(session, event)
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted && this.ctx.agents.get(session.id) === agent) {
        this.appendFailure(session, turn, reviewedThroughSeq, 'reviewer-unavailable', boundedDiagnostic(error), run)
      }
    } finally {
      try {
        await run?.dispose()
      } finally {
        state.controllers.delete(controller)
      }
    }
  }

  private appendFailure(
    session: Session,
    turn: number,
    reviewedThroughSeq: number,
    code: 'reviewer-unavailable' | 'reviewer-failed' | 'invalid-output',
    message: string,
    run: SubagentRun | undefined,
  ): void {
    session.append('requirement/review', {
      version: 2,
      status: 'failed',
      turn,
      reviewedThroughSeq,
      ...(run === undefined ? {} : { reviewerSessionId: run.id }),
      error: { code, message: boundedDiagnostic(message) },
    })
    const round = roundForTurn(session, turn)
    if (round === undefined) return
    const list = latestTaskList(session, round.roundId)
    const failedTaskIds = list?.tasks.filter(task => task.status === 'failed').map(task => task.id) ?? []
    const validation = session.events.filter(event => event.type === 'requirement/validation'
      && event.data.roundId === round.roundId)
    const previousValidation = validation.at(-1)
    session.append('requirement/validation', {
      version: 1,
      revision: (previousValidation?.type === 'requirement/validation' ? previousValidation.data.revision : 0) + 1,
      roundId: round.roundId,
      turn,
      reviewedThroughSeq,
      status: 'failed',
      summary: { zh: '独立验证未完成。', en: 'Independent validation did not complete.' },
      regressions: [],
      failedTaskIds,
      error: boundedDiagnostic(message),
    })
    this.updateRound(session, round.roundId, { status: 'failed' })
  }

  private appendValidation(session: Session, review: RequirementReviewCompleted): void {
    const round = roundForTurn(session, review.turn)
    if (round === undefined) return
    const regressions = review.requirements.flatMap(requirement => (
      requirement.regression === undefined ? [] : [requirement.regression]
    ))
    const list = latestTaskList(session, round.roundId)
    const failedTaskIds = list?.tasks.filter(task => task.status === 'failed').map(task => task.id) ?? []
    const plan = latestPlan(session, round.roundId)
    const hasPendingTasks = list?.tasks.some(task => task.status === 'pending' || task.status === 'in_progress') ?? false
    const status: RequirementValidationEvent['status'] = plan?.status === 'proposed' || hasPendingTasks
      ? 'pending'
      : 'completed'
    const previous = session.events.findLast(event => event.type === 'requirement/validation'
      && event.data.roundId === round.roundId)
    session.append('requirement/validation', {
      version: 1,
      revision: (previous?.type === 'requirement/validation' ? previous.data.revision : 0) + 1,
      roundId: round.roundId,
      turn: review.turn,
      reviewedThroughSeq: review.reviewedThroughSeq,
      status,
      summary: status === 'pending'
        ? { zh: '等待 Plan 审批或任务完成后进行最终验证。', en: 'Final validation waits for Plan approval or task completion.' }
        : localizedSummary(round, regressions, failedTaskIds),
      regressions,
      failedTaskIds,
    })
    if (status === 'completed') this.updateRound(session, round.roundId, { status: 'completed' })
  }
}

export default SessionRequirements
