/** Package-owned durable requirement-review invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { RequirementNoteEvent, RequirementText } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-requirements'

function hasBlankText(value: RequirementText, version: 1 | 2): boolean {
  if (version === 1) return typeof value !== 'string' || value.trim() === ''
  return typeof value !== 'object' || value.zh.trim() === '' || value.en.trim() === ''
}

/** Cordis companion plugin name. */
export const name = 'session-requirements-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function validate(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'requirement/user-version') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1) fail(`requirement/user-version at seq ${event.seq} has unsupported version`)
    if (data.requirementId.trim() === '' || data.messageId.trim() === '') {
      fail(`requirement/user-version at seq ${event.seq} has an empty identity`)
    }
    if (!Number.isSafeInteger(data.requirementVersion) || data.requirementVersion < 1) {
      fail(`requirement/user-version at seq ${event.seq} has invalid requirementVersion`)
    }
    if (data.title.trim() === '' || data.statement.trim() === '') {
      fail(`requirement/user-version at seq ${event.seq} has blank requirement text`)
    }
    const language: unknown = data.language
    if (language !== 'zh' && language !== 'en') {
      fail(`requirement/user-version at seq ${event.seq} has invalid language`)
    }
    return
  }
  if (event.type === 'requirement/execution') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1) fail(`requirement/execution at seq ${event.seq} has unsupported version`)
    if (data.requirementId.trim() === '' || data.messageId.trim() === '') {
      fail(`requirement/execution at seq ${event.seq} has an empty identity`)
    }
    if (!Number.isSafeInteger(data.requirementVersion) || data.requirementVersion < 1) {
      fail(`requirement/execution at seq ${event.seq} has invalid requirementVersion`)
    }
    if (data.status !== 'failed' && (!Number.isSafeInteger(data.turn) || (data.turn ?? -1) < 1)) {
      fail(`requirement/execution at seq ${event.seq} has invalid turn`)
    }
    return
  }
  if (event.type === 'requirement/round') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) {
      fail(`requirement/round at seq ${event.seq} has an invalid version or revision`)
    }
    if (data.roundId.trim() === '' || data.sourceMessageId.trim() === '' || data.input.trim() === '') {
      fail(`requirement/round at seq ${event.seq} has an empty identity or input`)
    }
    if (!Number.isSafeInteger(data.round) || data.round < 1) {
      fail(`requirement/round at seq ${event.seq} has an invalid round number`)
    }
    if (!['planning', 'awaiting-approval', 'executing', 'validating', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/round at seq ${event.seq} has an invalid status`)
    }
    return
  }
  if (event.type === 'requirement/markdown') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || data.sourceMessageId.trim() === '' || data.markdown.trim() === '') {
      fail(`requirement/markdown at seq ${event.seq} has an invalid payload`)
    }
    return
  }
  if (event.type === 'requirement/plan') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || data.markdown.trim() === '') {
      fail(`requirement/plan at seq ${event.seq} has an invalid payload`)
    }
    if (!Number.isSafeInteger(data.turn) || data.turn < 1) {
      fail(`requirement/plan at seq ${event.seq} has an invalid turn`)
    }
    if (!['proposed', 'approved', 'failed'].includes(data.status)) {
      fail(`requirement/plan at seq ${event.seq} has an invalid status`)
    }
    return
  }
  if (event.type === 'requirement/task-list') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || data.roundId.trim() === '') {
      fail(`requirement/task-list at seq ${event.seq} has an invalid payload`)
    }
    const ids = new Set<string>()
    for (const task of data.tasks) {
      if (task.id.trim() === '' || ids.has(task.id)) {
        fail(`requirement/task-list at seq ${event.seq} has an empty or duplicate task id`)
      }
      if (task.status !== 'pending' && task.status !== 'withdrawn'
        && task.title.trim() === '' && task.statement.trim() === '') {
        fail(`requirement/task-list at seq ${event.seq} has an empty executable task`)
      }
      ids.add(task.id)
      if (!Number.isSafeInteger(task.order) || task.order < 0) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task order`)
      }
      if (!['pending', 'in_progress', 'completed', 'failed', 'withdrawn'].includes(task.status)) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task status`)
      }
    }
    return
  }
  if (event.type === 'requirement/task-execution') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || data.taskId.trim() === '' || data.messageId.trim() === '') {
      fail(`requirement/task-execution at seq ${event.seq} has an invalid identity`)
    }
    if (!['submitted', 'processing', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/task-execution at seq ${event.seq} has an invalid status`)
    }
    if (data.turn !== undefined && (!Number.isSafeInteger(data.turn) || data.turn < 1)) {
      fail(`requirement/task-execution at seq ${event.seq} has an invalid turn`)
    }
    return
  }
  if (event.type === 'requirement/note') {
    const data = event.data
    const version: unknown = data.version
    const kind: unknown = data.kind
    const dispatched: unknown = data.dispatched
    const validMessage = data.dispatched
      ? data.messageId !== undefined && data.messageId.trim() !== ''
      : data.messageId === undefined
    if (version !== 1 || data.roundId.trim() === '' || data.noteId.trim() === ''
      || ((kind !== 'text' || data.dispatched) && data.content.trim() === '')
      || typeof dispatched !== 'boolean' || !validMessage) {
      fail(`requirement/note at seq ${event.seq} has an invalid payload`)
    }
    if (kind !== 'text' && kind !== 'comment') {
      fail(`requirement/note at seq ${event.seq} has an invalid kind`)
    }
    return
  }
  if (event.type === 'requirement/validation') {
    const data = event.data
    const version: unknown = data.version
    const summaryVersion = typeof data.summary === 'string' ? 1 : 2
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || hasBlankText(data.summary, summaryVersion)) {
      fail(`requirement/validation at seq ${event.seq} has an invalid payload`)
    }
    if (!Number.isSafeInteger(data.turn) || data.turn < 0
      || !Number.isSafeInteger(data.reviewedThroughSeq) || data.reviewedThroughSeq < -1) {
      fail(`requirement/validation at seq ${event.seq} has an invalid review location`)
    }
    if (!['pending', 'processing', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/validation at seq ${event.seq} has an invalid status`)
    }
    for (const regression of data.regressions) {
      const reasonVersion = typeof regression.reason === 'string' ? 1 : 2
      if (regression.requirementId.trim() === '' || hasBlankText(regression.reason, reasonVersion)) {
        fail(`requirement/validation at seq ${event.seq} has an invalid regression`)
      }
    }
    return
  }
  if (event.type !== 'requirement/review') return
  const data = event.data
  const version: unknown = data.version
  if (version !== 1 && version !== 2) {
    fail(`requirement/review at seq ${event.seq} has unsupported version`)
    return
  }
  if (!Number.isSafeInteger(data.turn) || data.turn < 0) fail(`requirement/review at seq ${event.seq} has invalid turn`)
  if (!Number.isSafeInteger(data.reviewedThroughSeq) || data.reviewedThroughSeq < -1) {
    fail(`requirement/review at seq ${event.seq} has invalid reviewedThroughSeq`)
  }
  if (data.status === 'failed') return
  const ids = new Set<string>()
  for (const requirement of data.requirements) {
    if (requirement.id.trim() === '' || ids.has(requirement.id)) {
      fail(`requirement/review at seq ${event.seq} has an empty or duplicate requirement id`)
    }
    ids.add(requirement.id)
    if (hasBlankText(requirement.title, version) || hasBlankText(requirement.statement, version)) {
      fail(`requirement/review at seq ${event.seq} has blank requirement text`)
    }
    if (requirement.sources.some(source => hasBlankText(source.summary, version))) {
      fail(`requirement/review at seq ${event.seq} has blank source summary`)
    }
    if (requirement.code.some(link => hasBlankText(link.evidence, version))) {
      fail(`requirement/review at seq ${event.seq} has blank code evidence`)
    }
    if (hasBlankText(requirement.audit.summary, version)
      || requirement.audit.gaps.some(gap => hasBlankText(gap, version))) {
      fail(`requirement/review at seq ${event.seq} has blank audit text`)
    }
  }
}

function validateRelations(events: readonly SessionEvent[], fail: InvariantFailure): void {
  const reviewed = new Set<string>()
  const versions = new Map<string, { readonly version: number; readonly messageId: string }>()
  const executions = new Map<string, 'processing' | 'completed' | 'failed'>()
  const rounds = new Map<string, number>()
  const taskRevisions = new Map<string, number>()
  const taskIds = new Map<string, Set<string>>()
  const planRevisions = new Map<string, number>()
  const markdownRevisions = new Map<string, number>()
  const validationRevisions = new Map<string, number>()
  const notes = new Map<string, RequirementNoteEvent>()
  for (const event of events) {
    if (event.type === 'requirement/round') {
      const previous = rounds.get(String(event.data.roundId))
      const expected = (previous ?? 0) + 1
      if (event.data.revision !== expected) {
        fail(`requirement/round at seq ${event.seq} violates revision order`)
      }
      rounds.set(String(event.data.roundId), event.data.revision)
      continue
    }
    if (event.type === 'requirement/markdown') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (markdownRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/markdown at seq ${event.seq} has no valid round or revision`)
      }
      markdownRevisions.set(key, event.data.revision)
      continue
    }
    if (event.type === 'requirement/plan') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (planRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/plan at seq ${event.seq} has no valid round or revision`)
      }
      planRevisions.set(key, event.data.revision)
      continue
    }
    if (event.type === 'requirement/task-list') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (taskRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/task-list at seq ${event.seq} has no valid round or revision`)
      }
      taskRevisions.set(key, event.data.revision)
      taskIds.set(key, new Set(event.data.tasks.map(task => String(task.id))))
      continue
    }
    if (event.type === 'requirement/task-execution') {
      const key = String(event.data.roundId)
      const taskKey = `${key}:${String(event.data.taskId)}`
      const previousRevision = taskRevisions.get(taskKey) ?? 0
      if (!rounds.has(key) || !taskIds.get(key)?.has(String(event.data.taskId))
        || event.data.revision !== previousRevision + 1) {
        fail(`requirement/task-execution at seq ${event.seq} has no valid task or revision`)
      }
      taskRevisions.set(taskKey, event.data.revision)
      continue
    }
    if (event.type === 'requirement/note') {
      if (!rounds.has(String(event.data.roundId))) {
        fail(`requirement/note at seq ${event.seq} has no matching round`)
      }
      const key = `${event.data.roundId}:${event.data.noteId}`
      const previous = notes.get(key)
      if (previous !== undefined && (previous.kind !== 'text' || previous.dispatched
        || event.data.kind !== 'text' || event.data.dispatched)) {
        fail(`requirement/note at seq ${event.seq} replaces a non-editable note`)
      }
      notes.set(key, event.data)
      continue
    }
    if (event.type === 'requirement/validation') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (validationRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/validation at seq ${event.seq} has no valid round or revision`)
      }
      validationRevisions.set(key, event.data.revision)
      continue
    }
    if (event.type === 'requirement/review' && event.data.status === 'completed') {
      for (const requirement of event.data.requirements) reviewed.add(requirement.id)
      continue
    }
    if (event.type === 'requirement/user-version') {
      const data = event.data
      const current = versions.get(data.requirementId)?.version
        ?? (reviewed.has(data.requirementId) ? 1 : undefined)
      const expected = data.operation === 'added' ? 1 : (current ?? 0) + 1
      if (data.requirementVersion !== expected
        || data.operation === 'added' && current !== undefined
        || data.operation === 'revised' && current === undefined) {
        fail(`requirement/user-version at seq ${event.seq} violates append-only version order`)
      }
      versions.set(data.requirementId, {
        version: data.requirementVersion,
        messageId: data.messageId,
      })
      continue
    }
    if (event.type !== 'requirement/execution') continue
    const data = event.data
    const version = versions.get(data.requirementId)
    if (version?.version !== data.requirementVersion || version.messageId !== data.messageId) {
      fail(`requirement/execution at seq ${event.seq} has no matching user version`)
      continue
    }
    const key = `${data.requirementId}:${data.requirementVersion}`
    const previous = executions.get(key)
    if (data.status === 'processing' ? previous !== undefined : data.turn !== undefined && previous !== 'processing') {
      fail(`requirement/execution at seq ${event.seq} has an invalid status transition`)
    }
    executions.set(key, data.status)
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validate(event, fail)
    validateRelations(session.events, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validate(event, fail)
    const events = session.events
    validateRelations(events.some(candidate => candidate.seq === event.seq) ? events : [...events, event], fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the requirement review stream invariant.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
