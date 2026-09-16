/** Package-owned durable requirement-review invariants. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { RequirementNoteEvent, RequirementText } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-requirements'

function hasBlankText(value: RequirementText, version: 1 | 2 | 3): boolean {
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
    if (!['analyzing', 'clarifying', 'awaiting-input', 'document-ready', 'generating-tasks', 'tasks-ready',
      'executing', 'reviewing', 'validating', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/round at seq ${event.seq} has an invalid status`)
    }
    return
  }
  if (event.type === 'requirement/clarification') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || !Number.isSafeInteger(data.attempt) || data.attempt < 1 || data.roundId.trim() === ''
      || data.questions.length < 1) {
      fail(`requirement/clarification at seq ${event.seq} has an invalid payload`)
    }
    if (!['asked', 'answered', 'dismissed'].includes(data.status)) {
      fail(`requirement/clarification at seq ${event.seq} has an invalid status`)
    }
    const ids = new Set<string>()
    for (const question of data.questions) {
      if (question.id.trim() === '' || question.question.trim() === '' || ids.has(question.id)
        || question.options !== undefined && (question.options.length < 2 || question.options.length > 3)) {
        fail(`requirement/clarification at seq ${event.seq} has an invalid question`)
      }
      ids.add(question.id)
    }
    if (data.status === 'answered') {
      const answerIds = new Set<string>()
      const invalidAnswers = data.answers === undefined || data.answers.length !== ids.size
        || data.answers.some((answer) => {
          const duplicate = answerIds.has(answer.id)
          answerIds.add(answer.id)
          return !ids.has(answer.id) || duplicate
            || answer.selected.length === 0 && (answer.custom === undefined || answer.custom.trim() === '')
        })
      if (invalidAnswers) fail(`requirement/clarification at seq ${event.seq} has invalid answers`)
    } else if (data.answers !== undefined) {
      fail(`requirement/clarification at seq ${event.seq} has answers before settlement`)
    }
    return
  }
  if (event.type === 'requirement/document') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || data.summary.trim() === '' || Array.from(data.summary).length > 30
      || data.markdown.trim() === '' || !Number.isSafeInteger(data.turn) || data.turn < 1
      || data.valid !== (data.issues.length === 0)) {
      fail(`requirement/document at seq ${event.seq} has an invalid payload`)
    }
    return
  }
  if (event.type === 'requirement/graph') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || !Number.isSafeInteger(data.documentRevision) || data.documentRevision < 1
      || data.roundId.trim() === '' || data.nodes.length === 0) {
      fail(`requirement/graph at seq ${event.seq} has an invalid payload`)
    }
    const nodeIds = new Set<string>()
    for (const node of data.nodes) {
      if (!/^\d+$/u.test(node.requirementId) || nodeIds.has(node.requirementId)
        || node.title.trim() === '' || node.acceptanceRefs.length === 0
        || node.acceptanceRefs.some(ref => !new RegExp(`^${node.requirementId}\\.\\d+$`, 'u').test(ref))) {
        fail(`requirement/graph at seq ${event.seq} has an invalid or duplicate node`)
      }
      nodeIds.add(node.requirementId)
    }
    const relationKeys = new Set<string>()
    for (const relation of data.relations) {
      const key = `${relation.source.roundId}:${relation.source.requirementId}:${relation.kind}:${relation.target.roundId}:${relation.target.requirementId}`
      if (relationKeys.has(key) || relation.source.roundId.trim() === '' || relation.target.roundId.trim() === ''
        || !/^\d+$/u.test(relation.source.requirementId) || !/^\d+$/u.test(relation.target.requirementId)
        || relation.source.roundId === relation.target.roundId
          && relation.source.requirementId === relation.target.requirementId
        || !['depends-on', 'refines', 'supersedes'].includes(relation.kind) || relation.reason.trim() === '') {
        fail(`requirement/graph at seq ${event.seq} has an invalid or duplicate relation`)
      }
      relationKeys.add(key)
    }
    const dependencies = new Map(data.nodes.map(node => [node.requirementId, [] as string[]]))
    for (const relation of data.relations) {
      if (relation.kind === 'depends-on') {
        dependencies.get(relation.source.requirementId)?.push(relation.target.requirementId)
      }
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (requirementId: string): void => {
      if (visiting.has(requirementId)) fail(`requirement/graph at seq ${event.seq} contains a dependency cycle`)
      if (visited.has(requirementId)) return
      visiting.add(requirementId)
      for (const target of dependencies.get(requirementId) ?? []) visit(target)
      visiting.delete(requirementId)
      visited.add(requirementId)
    }
    for (const node of data.nodes) visit(node.requirementId)
    return
  }
  if (event.type === 'requirement/task-list') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || data.roundId.trim() === ''
      || !Number.isSafeInteger(data.documentRevision) || data.documentRevision < 1) {
      fail(`requirement/task-list at seq ${event.seq} has an invalid payload`)
    }
    const ids = new Set<string>()
    const finalTasks = data.tasks.filter(task => task.kind === 'final-test')
    if (finalTasks.length !== 1 || data.tasks.at(-1)?.kind !== 'final-test') {
      fail(`requirement/task-list at seq ${event.seq} must end with exactly one Final Test`)
    }
    for (const [index, task] of data.tasks.entries()) {
      const summary: unknown = task.summary
      if (summary !== undefined && typeof summary !== 'string') {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task summary`)
      }
      if (task.humanInstruction !== undefined && (typeof task.humanInstruction !== 'string' || task.humanInstruction.trim() === '')) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid human instruction`)
      }
      if (task.id.trim() === '' || ids.has(task.id)) {
        fail(`requirement/task-list at seq ${event.seq} has an empty or duplicate task id`)
      }
      if (task.status !== 'pending' && task.status !== 'withdrawn'
        && task.title.trim() === '' && task.statement.trim() === '') {
        fail(`requirement/task-list at seq ${event.seq} has an empty executable task`)
      }
      ids.add(task.id)
      if (!Number.isSafeInteger(task.order) || task.order !== index) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task order`)
      }
      if (!['implementation', 'checkpoint', 'final-test'].includes(task.kind)) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task kind`)
      }
      if (!['pending', 'in_progress', 'reviewing', 'completed', 'failed', 'withdrawn'].includes(task.status)) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid task status`)
      }
      if (task.requirementRefs.some(ref => !/^\d+\.\d+$/u.test(ref))) {
        fail(`requirement/task-list at seq ${event.seq} has an invalid requirement reference`)
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
    if (!['submitted', 'processing', 'reviewing', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/task-execution at seq ${event.seq} has an invalid status`)
    }
    if (data.turn !== undefined && (!Number.isSafeInteger(data.turn) || data.turn < 1)) {
      fail(`requirement/task-execution at seq ${event.seq} has an invalid turn`)
    }
    return
  }
  if (event.type === 'requirement/run-all') {
    const data = event.data
    const version: unknown = data.version
    if (version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1
      || data.roundId.trim() === '' || !['running', 'stopping', 'stopped', 'completed', 'failed'].includes(data.status)) {
      fail(`requirement/run-all at seq ${event.seq} has an invalid payload`)
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
  if (version !== 1 && version !== 2 && version !== 3) {
    fail(`requirement/review at seq ${event.seq} has unsupported version`)
    return
  }
  if (!Number.isSafeInteger(data.turn) || data.turn < 0) fail(`requirement/review at seq ${event.seq} has invalid turn`)
  if (!Number.isSafeInteger(data.reviewedThroughSeq) || data.reviewedThroughSeq < -1) {
    fail(`requirement/review at seq ${event.seq} has invalid reviewedThroughSeq`)
  }
  if (data.status === 'failed') return
  if (data.task !== undefined && (data.task.taskId.trim() === ''
    || !['passed', 'warning', 'blocking'].includes(data.task.verdict)
    || hasBlankText(data.task.summary, version)
    || data.task.findings.some(finding => hasBlankText(finding, version)))) {
    fail(`requirement/review at seq ${event.seq} has an invalid task verdict`)
  }
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
  const clarificationRevisions = new Map<string, number>()
  const documentRevisions = new Map<string, number>()
  const graphRevisions = new Map<string, number>()
  const graphNodes = new Map<string, Set<string>>()
  const taskListRevisions = new Map<string, number>()
  const taskExecutionRevisions = new Map<string, number>()
  const taskIds = new Map<string, Set<string>>()
  const runAllRevisions = new Map<string, number>()
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
    if (event.type === 'requirement/clarification') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (clarificationRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/clarification at seq ${event.seq} has no valid round or revision`)
      }
      clarificationRevisions.set(key, event.data.revision)
      continue
    }
    if (event.type === 'requirement/document') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (documentRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/document at seq ${event.seq} has no valid round or revision`)
      }
      documentRevisions.set(key, event.data.revision)
      continue
    }
    if (event.type === 'requirement/graph') {
      const key = String(event.data.roundId)
      const currentNodeIds = new Set(event.data.nodes.map(node => node.requirementId))
      const validRelation = event.data.relations.every((relation) => {
        const sourceRound = String(relation.source.roundId)
        const targetRound = String(relation.target.roundId)
        if (sourceRound !== key || !currentNodeIds.has(relation.source.requirementId)) return false
        if (relation.kind === 'depends-on' && targetRound !== key) return false
        if (relation.kind !== 'depends-on' && targetRound === key) return false
        return targetRound === key
          ? currentNodeIds.has(relation.target.requirementId)
          : graphNodes.get(targetRound)?.has(relation.target.requirementId) === true
      })
      if (!rounds.has(key) || event.data.revision !== (graphRevisions.get(key) ?? 0) + 1
        || event.data.documentRevision !== documentRevisions.get(key) || !validRelation) {
        fail(`requirement/graph at seq ${event.seq} has no valid document or relation endpoint`)
      }
      graphRevisions.set(key, event.data.revision)
      graphNodes.set(key, currentNodeIds)
      continue
    }
    if (event.type === 'requirement/task-list') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (taskListRevisions.get(key) ?? 0) + 1
        || (documentRevisions.get(key) ?? 0) < event.data.documentRevision) {
        fail(`requirement/task-list at seq ${event.seq} has no valid round or revision`)
      }
      taskListRevisions.set(key, event.data.revision)
      taskIds.set(key, new Set(event.data.tasks.map(task => String(task.id))))
      continue
    }
    if (event.type === 'requirement/task-execution') {
      const key = String(event.data.roundId)
      const taskKey = `${key}:${String(event.data.taskId)}`
      const previousRevision = taskExecutionRevisions.get(taskKey) ?? 0
      if (!rounds.has(key) || !taskIds.get(key)?.has(String(event.data.taskId))
        || event.data.revision !== previousRevision + 1) {
        fail(`requirement/task-execution at seq ${event.seq} has no valid task or revision`)
      }
      taskExecutionRevisions.set(taskKey, event.data.revision)
      continue
    }
    if (event.type === 'requirement/run-all') {
      const key = String(event.data.roundId)
      if (!rounds.has(key) || event.data.revision !== (runAllRevisions.get(key) ?? 0) + 1) {
        fail(`requirement/run-all at seq ${event.seq} has no valid round or revision`)
      }
      runAllRevisions.set(key, event.data.revision)
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
