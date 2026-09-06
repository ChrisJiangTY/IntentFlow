import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionRequirements from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function parent() {
  const session = Session.create(SessionId('requirements-parent'))
  const followup = vi.fn<(message: UserMessage) => void>()
  const agent = { id: session.id, session, followup } as unknown as Agent
  return { agent, session, followup }
}

function appendExternalEvent(session: Session, type: string, data: unknown): SessionEvent {
  return (session as unknown as { append(type: string, data: unknown): SessionEvent }).append(type, data)
}

function completedRun(): SubagentRun {
  return {
    id: SessionId('requirements-reviewer'),
    localAgent: undefined,
    result: Promise.resolve({
      stopReason: 'completed',
      output: [],
      structured: {
        requirements: [{
          id: 'R1',
          title: { zh: '需求视图', en: 'Requirements view' },
          statement: {
            zh: '在轨迹旁展示需求演化。',
            en: 'Show requirement evolution beside the trajectory.',
          },
          lifecycle: 'active',
          change: 'added',
          sources: [{
            seq: 1,
            kind: 'user',
            summary: { zh: '用户要求增加该视图。', en: 'The user requested the view.' },
          }],
          code: [{
            path: 'packages/client/ui-requirements/src/client/RequirementsView.tsx',
            relation: 'implements',
            evidence: { zh: '组件渲染时间轴。', en: 'The component renders the timeline.' },
          }],
          audit: {
            status: 'verified',
            summary: { zh: '该视图已注册。', en: 'The view is registered.' },
            gaps: [],
          },
        }],
      },
    }),
    dispose: vi.fn(() => Promise.resolve()),
  }
}

describe('session requirements review', () => {
  it('starts a product round from the raw input and enters Plan mode automatically', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    const setPlanMode = vi.fn()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    ctx.provide('planMode', { set: setPlanMode } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    const input = '  保留原始输入的换行\n并自动规划  '
    const result = ctx.sessionRequirements.startRound(agent, { input, language: 'zh' })
    expect(result).toMatchObject({ roundId: 'ROUND-01', round: 1 })
    expect(setPlanMode).toHaveBeenCalledWith(agent, true)
    expect(followup).toHaveBeenCalledOnce()
    expect(session.events.filter(event => event.type === 'requirement/round')).toHaveLength(1)
    expect(session.events.find(event => event.type === 'requirement/round')?.data.input).toBe(input)
    expect(session.events.find(event => event.type === 'requirement/markdown')?.data.markdown).toContain(input)
    const planningContent = followup.mock.calls[0]?.[0]?.content[0]
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('每个顶层编号阶段（每个 `## N. 阶段标题`）创建一个 Todo')
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('不要把同一阶段内的 `N.1`、`N.2` 等勾选项拆成多个 Todo')
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('继续完整保留该阶段直到下一个 `##` 标题之前的所有勾选项和缩进细节')
  })

  it('enters the Plan mode instance isolated inside the live Agent preset', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, followup } = parent()
    const setPlanMode = vi.fn()
    const serviceFor = vi.fn(() => ({ set: setPlanMode }))
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    ctx.provide('agentPresets', { serviceFor } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    ctx.sessionRequirements.startRound(agent, { input: 'Build an HTML page.', language: 'en' })

    expect(serviceFor).toHaveBeenCalledWith(agent, 'planMode')
    expect(setPlanMode).toHaveBeenCalledWith(agent, true)
    expect(followup).toHaveBeenCalledOnce()
    const planningContent = followup.mock.calls[0]?.[0]?.content[0]
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('one Todo for each top-level numbered Plan phase')
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('Do not split the `N.1`, `N.2`, and other checklist items within one phase')
    expect(planningContent?.type === 'text' ? planningContent.text : '').toContain('stopping immediately before the next `##` heading')
  })

  it('projects live planning events after Session append publication completes', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('requirements-live'))
    const followup = vi.fn<(message: UserMessage) => void>()
    const agent = { id: session.id, session, followup } as unknown as Agent
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    ctx.provide('planMode', { set: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    const started = ctx.sessionRequirements.startRound(agent, {
      input: 'Build an HTML page.',
      language: 'en',
    })
    const planningMessage = followup.mock.calls[0]?.[0]
    if (planningMessage === undefined) throw new Error('expected the planning message')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', planningMessage, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-live-plan' as never,
      name: 'exit_plan_mode',
      arguments: JSON.stringify({ plan: '# Plan\n\n1. Build the page.' }),
    })

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { roundId: started.roundId, turn: 1, status: 'awaiting-approval' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/plan')).toMatchObject({
        data: { roundId: started.roundId, turn: 1, status: 'proposed' },
      })
    })
  })

  it('persists Task insertion, editing, reordering, and withdrawal as task-list replacements', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    session.append('requirement/round', {
      version: 1,
      revision: 1,
      roundId: 'ROUND-01' as never,
      round: 1,
      sourceMessageId: 'message-1' as never,
      language: 'en',
      input: 'Build a notebook.',
      status: 'executing',
    })
    session.append('requirement/task-list', {
      version: 1,
      revision: 1,
      roundId: 'ROUND-01' as never,
      tasks: [
        { id: 'TASK-A' as never, order: 0, title: 'First', statement: 'Do first.', status: 'pending' },
        { id: 'TASK-B' as never, order: 1, title: 'Second', statement: 'Do second.', status: 'pending' },
      ],
    })

    const added = ctx.sessionRequirements.addTask(agent, {
      roundId: 'ROUND-01' as never,
      afterTaskId: 'TASK-A' as never,
      title: 'Inserted',
      statement: 'Do between the existing tasks.',
    })
    const insertedList = session.events.findLast(event => event.type === 'requirement/task-list')
    expect(added.taskId).toBe(insertedList?.type === 'requirement/task-list' ? insertedList.data.tasks[1]?.id : undefined)

    ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: added.taskId,
      title: 'Edited',
      statement: 'Use the edited task.',
    })
    ctx.sessionRequirements.moveTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: added.taskId,
      direction: 'up',
    })
    ctx.sessionRequirements.withdrawTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: added.taskId,
    })

    const latest = session.events.findLast(event => event.type === 'requirement/task-list')
    expect(latest?.type === 'requirement/task-list' ? latest.data.tasks.find(task => task.id === added.taskId) : undefined).toMatchObject({
      title: 'Edited',
      statement: 'Use the edited task.',
      status: 'withdrawn',
    })
    expect(session.events.filter(event => event.type === 'requirement/task-list')).toHaveLength(5)
  })

  it('persists empty drafts, rejects empty execution, and runs title-only content', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, { reviewerProvider: 'spawn', maxInputChars: 20_000, reviewerTools: ['read'] })
    const roundId = 'ROUND-01' as never
    session.append('requirement/round', {
      version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'message-1' as never,
      language: 'en', input: 'Build a notebook.', status: 'executing',
    })
    session.append('requirement/task-list', { version: 1, revision: 1, roundId, tasks: [] })
    const first = ctx.sessionRequirements.addTask(agent, { roundId, title: '', statement: '' })
    const second = ctx.sessionRequirements.addTask(agent, { roundId, title: '', statement: '' })
    const eventCount = session.events.length
    expect(first.taskId).not.toBe(second.taskId)
    expect(session.events.at(-1)).toMatchObject({ type: 'requirement/task-list', data: {
      tasks: [expect.objectContaining({ title: '', statement: '', status: 'pending' }),
        expect.objectContaining({ title: '', statement: '', status: 'pending' })],
    } })
    expect(() => ctx.sessionRequirements.runTask(agent, first)).toThrow('is empty')
    expect(ctx.sessionRequirements.runAll(agent, { roundId })).toEqual({ roundId })
    expect(session.events).toHaveLength(eventCount)
    expect(followup).not.toHaveBeenCalled()
    expect(() => ctx.sessionRequirements.editTask(agent, { ...second, title: null as never, statement: '' })).toThrow('must be a string')
    expect(() => ctx.sessionRequirements.addTask(agent, { roundId, title: '', statement: null as never })).toThrow('must be a string')
    ctx.sessionRequirements.editTask(agent, { ...second, title: 'Create the page', statement: '' })
    ctx.sessionRequirements.editTask(agent, { ...second, title: '', statement: '' })
    expect(() => ctx.sessionRequirements.runTask(agent, second)).toThrow('is empty')
    ctx.sessionRequirements.editTask(agent, { ...second, title: 'Create the page', statement: '' })
    expect(ctx.sessionRequirements.runAll(agent, { roundId }).taskId).toBe(second.taskId)
    const message = followup.mock.calls[0]![0]
    const prompt = message.content[0]
    if (prompt?.type !== 'text') throw new Error('expected a text task prompt')
    expect(prompt.text).toContain('Create the page')
    session.append('turn/start', { turn: 1 })
    const received = session.append('user/message', message, { surfaceOp: 'append' })
    ctx.emit('session/event', session, received)
    await Promise.resolve()
    const ended = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.emit('session/event', session, ended)
    await Promise.resolve()
    expect(followup).toHaveBeenCalledOnce()
    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({ data: { status: 'validating' } })
  })

  it('serializes task execution and marks a discarded task as failed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    session.append('requirement/round', {
      version: 1,
      revision: 1,
      roundId: 'ROUND-01' as never,
      round: 1,
      sourceMessageId: 'message-1' as never,
      language: 'en',
      input: 'Build a notebook.',
      status: 'executing',
    })
    session.append('requirement/task-list', {
      version: 1,
      revision: 1,
      roundId: 'ROUND-01' as never,
      tasks: [
        { id: 'TASK-A' as never, order: 0, title: 'First', statement: 'Do first.', status: 'pending' },
        { id: 'TASK-B' as never, order: 1, title: 'Second', statement: 'Do second.', status: 'pending' },
      ],
    })

    const first = ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    expect(first.taskId).toBe('TASK-A')
    expect(() => ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })).toThrow('already running')
    expect(() => ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-B' as never })).toThrow('already running')

    const taskMessage = followup.mock.calls[0]?.[0]
    if (taskMessage === undefined) throw new Error('expected task follow-up')
    ctx.emit('agent/inbox/discarded', { agent, message: taskMessage })

    const latestTaskList = session.events.at(-1)
    expect(latestTaskList?.type).toBe('requirement/task-list')
    if (latestTaskList?.type !== 'requirement/task-list') throw new Error('expected task-list event')
    expect(latestTaskList.data.tasks.find(task => task.id === 'TASK-A')).toMatchObject({ status: 'failed' })
    expect(session.events.at(-2)).toMatchObject({
      type: 'requirement/task-execution',
      data: { taskId: 'TASK-A', status: 'failed' },
    })
  })

  it('commits only one user-owned version and tracks its Agent execution separately', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    const added = ctx.sessionRequirements.commit(agent, {
      operation: 'add',
      language: 'zh',
      title: '导出筛选结果',
      statement: '支持用户导出当前筛选结果。',
    })
    const queued = followup.mock.calls[0]?.[0] as UserMessage

    expect(added).toMatchObject({ requirementId: 'R1', requirementVersion: 1 })
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/user-version',
      data: {
        operation: 'added',
        requirementId: 'R1',
        requirementVersion: 1,
        title: '导出筛选结果',
        messageId: queued.id,
      },
    })
    const addedPrompt = queued.content[0]
    expect(addedPrompt?.type).toBe('text')
    if (addedPrompt?.type !== 'text') throw new Error('expected a text follow-up')
    expect(addedPrompt.text).toContain('其他现有需求保持不变。')

    session.append('turn/start', { turn: 1 })
    const queuedEvent = session.append('user/message', queued, { surfaceOp: 'append' })
    ctx.emit('session/event', session, queuedEvent)
    await Promise.resolve()
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/execution',
      data: { requirementId: 'R1', requirementVersion: 1, status: 'processing', turn: 1 },
    })
    const turnEnd = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.emit('session/event', session, turnEnd)
    await Promise.resolve()
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/execution',
      data: { requirementId: 'R1', requirementVersion: 1, status: 'completed', turn: 1 },
    })
  })

  it('appends revisions and rejects a stale requirement version', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    const added = ctx.sessionRequirements.commit(agent, {
      operation: 'add',
      language: 'en',
      title: 'Export results',
      statement: 'Export the current filtered results.',
    })
    const revised = ctx.sessionRequirements.commit(agent, {
      operation: 'revise',
      ref: { id: added.requirementId, version: 1 },
      language: 'en',
      title: 'Export filtered results',
      statement: 'Export the current filtered results as CSV.',
    })

    expect(revised.requirementVersion).toBe(2)
    const revisedPrompt = followup.mock.calls[1]?.[0]?.content[0]
    expect(revisedPrompt?.type).toBe('text')
    if (revisedPrompt?.type !== 'text') throw new Error('expected a text follow-up')
    expect(revisedPrompt.text).toContain('Previous requirement:\nExport results')
    expect(session.events.filter(event => event.type === 'requirement/user-version')).toHaveLength(2)
    expect(() => ctx.sessionRequirements.commit(agent, {
      operation: 'revise',
      ref: { id: added.requirementId, version: 1 },
      language: 'en',
      title: 'Stale edit',
      statement: 'This edit must not be accepted.',
    })).toThrow('stale requirement')
  })

  it('runs a read-only child and appends the complete reviewed snapshot', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session } = parent()
    const run = completedRun()
    const start = vi.fn((_provider: string, _request: SubagentStartRequest) => Promise.resolve(run))
    ctx.provide('agents', { get: (id: SessionId) => id === agent.id ? agent : undefined } as never)
    ctx.provide('subagents', { start } as never)

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Add a requirements view.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('assistant-1'),
        role: 'assistant',
        content: [{ type: 'text', text: 'I implemented it.' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read', 'glob', 'grep'],
    })
    await ctx.sessionRequirements.review(agent, 1)

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn')
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      parent: agent,
      maxDepth: 1,
      toolFilter: { allow: ['read', 'glob', 'grep'] },
    })
    const prompt = start.mock.calls[0]?.[1].prompt[0]
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('Add a requirements view.')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('never proof of completion')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('both Simplified Chinese and English')
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/review',
      data: {
        version: 2,
        status: 'completed',
        turn: 1,
        reviewerSessionId: 'requirements-reviewer',
        requirements: [{
          id: 'R1',
          title: { zh: '需求视图', en: 'Requirements view' },
          audit: { status: 'verified' },
        }],
      },
    })
    // oxlint-disable-next-line typescript/unbound-method -- the field is a receiver-free mock.
    expect(run.dispose).toHaveBeenCalledOnce()
  })

  it('records a failed review without inventing requirement evidence', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', {
      start: () => Promise.reject(new Error('provider missing')),
    } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    await ctx.sessionRequirements.review(agent, 0)

    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/review',
      data: {
        version: 2,
        status: 'failed',
        error: { code: 'reviewer-unavailable', message: 'provider missing' },
      },
    })
  })

  it('persists text and comment cells without execution unless dispatch is explicit', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })
    session.append('requirement/round', {
      version: 1,
      revision: 1,
      roundId: 'ROUND-01' as never,
      round: 1,
      sourceMessageId: 'message-1' as never,
      language: 'zh',
      input: '创建 HTML 页面。',
      status: 'executing',
    })

    const added = ctx.sessionRequirements.addNote(agent, {
      roundId: 'ROUND-01' as never,
      kind: 'text',
      content: '验收时检查语义化结构。',
      dispatch: false,
    })
    expect(followup).not.toHaveBeenCalled()
    const passiveNote = session.events.at(-1)
    expect(passiveNote).toMatchObject({
      type: 'requirement/note',
      data: { kind: 'text', dispatched: false },
    })
    expect(passiveNote?.type === 'requirement/note'
      ? passiveNote.data.messageId
      : 'wrong event').toBeUndefined()

    const source = '\n# 备注\n\n保留 Markdown 换行。  \n下一行。\n'
    ctx.sessionRequirements.editNote(agent, { ...added, content: source })
    expect(session.events.at(-1)).toMatchObject({ type: 'requirement/note', data: {
      noteId: added.noteId, content: source, dispatched: false,
    } })
    expect(passiveNote?.type === 'requirement/note' ? passiveNote.data.content : '').toBe('验收时检查语义化结构。')
    ctx.sessionRequirements.editNote(agent, { ...added, content: '' })
    expect(session.events.at(-1)).toMatchObject({ type: 'requirement/note', data: { content: '' } })
    const empty = ctx.sessionRequirements.addNote(agent, { roundId: added.roundId, kind: 'text', content: '', dispatch: false })
    expect(empty.noteId).not.toBe(added.noteId)
    expect(followup).not.toHaveBeenCalled()
    expect(() => ctx.sessionRequirements.editNote(agent, { ...added, noteId: 'missing' as never, content: 'x' })).toThrow('does not exist')
    expect(() => ctx.sessionRequirements.editNote(agent, { ...added, roundId: 'missing' as never, content: 'x' })).toThrow('does not exist')
    expect(() => ctx.sessionRequirements.editNote(agent, { ...added, content: null as never })).toThrow('must be a string')

    const dispatched = ctx.sessionRequirements.addNote(agent, {
      roundId: 'ROUND-01' as never,
      kind: 'comment',
      content: '解释当前 HTML Task。',
      dispatch: true,
    })
    expect(followup).toHaveBeenCalledOnce()
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/note',
      data: { kind: 'comment', dispatched: true },
    })
    expect(() => ctx.sessionRequirements.editNote(agent, { ...dispatched, content: 'changed' })).toThrow('only passive Markdown notes')
    const comment = ctx.sessionRequirements.addNote(agent, { roundId: added.roundId, kind: 'comment', content: 'comment', dispatch: false })
    expect(() => ctx.sessionRequirements.editNote(agent, { ...comment, content: 'changed' })).toThrow('only passive Markdown notes')
    expect(() => ctx.sessionRequirements.addNote(agent, { roundId: added.roundId, kind: 'comment', content: '', dispatch: false })).toThrow('non-empty string')
    expect(() => ctx.sessionRequirements.addNote(agent, {
      roundId: 'ROUND-01' as never,
      kind: 'comment',
      content: 'invalid dispatch',
      dispatch: 'yes' as never,
    })).toThrow('dispatch must be a boolean')
  })

  it('drives an HTML request through Markdown, Plan, Tasks, execution, and final validation', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const { agent, session, followup } = parent()
    const setPlanMode = vi.fn()
    const startReviewer = vi.fn(() => Promise.resolve(completedRun()))
    ctx.provide('agents', { get: () => agent } as never)
    ctx.provide('subagents', { start: startReviewer } as never)
    ctx.provide('planMode', { set: setPlanMode } as never)
    await ctx.plugin(SessionRequirements, {
      reviewerProvider: 'spawn',
      maxInputChars: 20_000,
      reviewerTools: ['read'],
    })

    const started = ctx.sessionRequirements.startRound(agent, {
      input: '创建一个带导航栏和登录表单的 index.html。',
      language: 'zh',
    })
    const planningMessage = followup.mock.calls[0]?.[0]
    if (planningMessage === undefined) throw new Error('expected the planning message')
    session.append('turn/start', { turn: 1 })
    const planningInput = session.append('user/message', planningMessage, { surfaceOp: 'append' })
    ctx.emit('session/event', session, planningInput)
    await Promise.resolve()
    const exitPlan = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-plan' as never,
      name: 'exit_plan_mode',
      arguments: JSON.stringify({
        plan: '# 任务列表\n\n## 1. 登录页面基础设置\n\n- [ ] 1.1 创建页面结构\n  - 创建 `index.html`\n  - 添加导航栏和登录表单\n\n- [ ] 1.2 验证页面结构\n  - 检查页面语义结构\n  - 运行 HTML 验证',
      }),
    })
    ctx.emit('session/event', session, exitPlan)
    await Promise.resolve()
    const approval = appendExternalEvent(session, 'plan/mode', { active: false })
    ctx.emit('session/event', session, approval)
    await Promise.resolve()
    const taskContent = '准备好可运行且经过检查的登录页面基础结构\n技术细节：\n## 1. 登录页面基础设置\n- [ ] 1.1 创建页面结构\n  - 创建 `index.html`\n  - 添加导航栏和登录表单\n- [ ] 1.2 验证页面结构\n  - 检查页面语义结构\n  - 运行 HTML 验证'
    const todos = appendExternalEvent(session, 'todo/write', {
      todos: [{ content: taskContent, status: 'pending' }],
    })
    ctx.emit('session/event', session, todos)
    await Promise.resolve()
    const planningEnd = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.emit('session/event', session, planningEnd)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/plan')).toMatchObject({
        data: { status: 'approved' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
        data: {
          tasks: [{
            title: '准备好可运行且经过检查的登录页面基础结构',
            statement: '技术细节：\n## 1. 登录页面基础设置\n- [ ] 1.1 创建页面结构\n  - 创建 `index.html`\n  - 添加导航栏和登录表单\n- [ ] 1.2 验证页面结构\n  - 检查页面语义结构\n  - 运行 HTML 验证',
            status: 'pending',
          }],
        },
      })
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { status: 'executing' },
      })
    })

    const taskList = session.events.findLast(event => event.type === 'requirement/task-list')
    if (taskList?.type !== 'requirement/task-list' || taskList.data.tasks[0] === undefined) {
      throw new Error('expected the HTML task')
    }
    ctx.sessionRequirements.runAll(agent, { roundId: started.roundId })
    const taskMessage = followup.mock.calls.at(-1)?.[0]
    if (taskMessage === undefined || taskMessage === planningMessage) throw new Error('expected the task message')
    const taskPrompt = taskMessage.content[0]
    expect(taskPrompt?.type === 'text' ? taskPrompt.text : '').toContain('准备好可运行且经过检查的登录页面基础结构')
    expect(taskPrompt?.type === 'text' ? taskPrompt.text : '').toContain('- [ ] 1.2 验证页面结构')
    expect(taskPrompt?.type === 'text' ? taskPrompt.text : '').toContain('  - 运行 HTML 验证')
    session.append('turn/start', { turn: 2 })
    const taskInput = session.append('user/message', taskMessage, { surfaceOp: 'append' })
    ctx.emit('session/event', session, taskInput)
    await Promise.resolve()
    session.append('assistant/message', {
      turn: 2,
      step: 1,
      message: {
        id: MessageId('assistant-html'),
        role: 'assistant',
        content: [{ type: 'text', text: '已创建 index.html，并验证导航栏与登录表单。' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    }, { surfaceOp: 'append' })
    const taskEnd = session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    ctx.emit('session/event', session, taskEnd)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { status: 'completed', output: '已创建 index.html，并验证导航栏与登录表单。' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/validation')).toMatchObject({
        data: { status: 'completed', regressions: [], failedTaskIds: [] },
      })
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { status: 'completed' },
      })
    })

    const markdown = session.events.find(event => event.type === 'requirement/markdown')
    const plan = session.events.find(event => event.type === 'requirement/plan')
    const firstTaskList = session.events.find(event => event.type === 'requirement/task-list')
    const completedTask = session.events.findLast(event => event.type === 'requirement/task-execution'
      && event.data.status === 'completed')
    const validation = session.events.findLast(event => event.type === 'requirement/validation'
      && event.data.status === 'completed')
    expect(markdown?.seq).toBeLessThan(plan?.seq ?? -1)
    expect(plan?.seq).toBeLessThan(firstTaskList?.seq ?? -1)
    expect(firstTaskList?.seq).toBeLessThan(completedTask?.seq ?? -1)
    expect(completedTask?.seq).toBeLessThan(validation?.seq ?? -1)
    expect(setPlanMode).toHaveBeenCalledWith(agent, true)
    expect(startReviewer).toHaveBeenCalled()
  })
})
