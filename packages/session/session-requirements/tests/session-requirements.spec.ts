import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionRequirements from '../src/index.ts'

const contexts: Context[] = []
const config = {
  reviewerProvider: 'spawn',
  maxInputChars: 20_000,
  reviewerTools: ['read'],
  maxClarificationRounds: 2,
  maxQuestionsPerRound: 5,
}

const documentMarkdown = `# 需求文档

## 简介

实现一个可验证的页面。

## 需求

### 需求 1：页面结构

**用户故事：** 作为用户，我希望看到页面，以便完成操作。

#### 验收标准

1. 当页面打开时，系统应当显示导航栏。
2. 当用户提交表单时，系统应当显示结果。`

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function parent(id = 'requirements-parent') {
  const session = Session.create(SessionId(id))
  const followup = vi.fn<(message: UserMessage) => void>()
  const agent = { id: session.id, session, followup } as unknown as Agent
  return { agent, session, followup }
}

function reviewRun(taskId?: string, verdict: 'passed' | 'warning' | 'blocking' = 'passed'): SubagentRun {
  return {
    id: SessionId(`reviewer-${taskId ?? 'manual'}`),
    localAgent: undefined,
    result: Promise.resolve({
      stopReason: 'completed',
      output: [],
      structured: {
        ...(taskId === undefined ? {} : {
          task: {
            taskId,
            verdict,
            summary: { zh: '任务审核完成。', en: 'Task review completed.' },
            findings: [],
          },
        }),
        requirements: [{
          id: 'R1',
          title: { zh: '页面结构', en: 'Page structure' },
          statement: { zh: '页面展示导航栏。', en: 'The page shows navigation.' },
          lifecycle: 'active',
          change: 'added',
          sources: [],
          code: [],
          audit: {
            status: verdict === 'blocking' ? 'partial' : 'verified',
            summary: { zh: '已检查实现。', en: 'Implementation inspected.' },
            gaps: [],
          },
        }],
      },
    }),
    dispose: vi.fn(() => Promise.resolve()),
  }
}

async function setup(options: {
  readonly id?: string
  readonly review?: (request: SubagentStartRequest) => SubagentRun
  readonly ask?: (request: unknown) => Promise<unknown>
  readonly store?: boolean
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  if (options.store) await ctx.plugin(SessionStore)
  const owner = options.store
    ? (() => {
      const session = ctx.sessions.create(SessionId(options.id ?? 'requirements-live'))
      const followup = vi.fn<(message: UserMessage) => void>()
      return { session, followup, agent: { id: session.id, session, followup } as unknown as Agent }
    })()
    : parent(options.id)
  const tools = new Map<string, ToolDefinition>()
  const start = vi.fn((_provider: string, request: SubagentStartRequest) => Promise.resolve(
    options.review?.(request) ?? reviewRun(),
  ))
  const ask = vi.fn(options.ask ?? (() => Promise.resolve({
    answers: [{ id: 'scope', selected: ['仅当前页面'] }],
  })))
  ctx.provide('agents', { get: (id: SessionId) => id === owner.agent.id ? owner.agent : undefined } as never)
  ctx.provide('subagents', { start } as never)
  ctx.provide('tools', {
    register: (tool: ToolDefinition) => {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as never)
  ctx.provide('userQuestions', { ask } as never)
  await ctx.plugin(SessionRequirements, config)
  return { ctx, ...owner, tools, start, ask }
}

function exec(agent: Agent): ToolRunContext {
  return {
    agent,
    signal: new AbortController().signal,
    concludeTurn: vi.fn(),
    deferContext: vi.fn(),
  } as unknown as ToolRunContext
}

function emit(ctx: Context, session: Session, event: SessionEvent): void {
  ctx.emit('session/event', session, event)
}

function appendRoundArtifacts(session: Session): void {
  const roundId = 'ROUND-01' as never
  session.append('requirement/round', {
    version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'source-1' as never,
    language: 'zh', input: '创建页面。', status: 'tasks-ready',
  })
  session.append('requirement/document', {
    version: 1, revision: 1, roundId, turn: 1, summary: '创建可验证页面',
    markdown: documentMarkdown, valid: true, issues: [],
  })
  session.append('requirement/task-list', {
    version: 1, revision: 1, roundId, documentRevision: 1,
    tasks: [
      {
        id: 'TASK-A' as never, order: 0, kind: 'implementation', title: '实现页面',
        statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_', requirementRefs: ['1.1'], status: 'pending',
      },
      {
        id: 'TASK-FINAL' as never, order: 1, kind: 'final-test', title: '最终测试',
        statement: '- [ ] 2.1 完成最终验证\n\n_关联需求：1.1、1.2_', requirementRefs: ['1.1', '1.2'], status: 'pending',
      },
    ],
  })
}

async function finishTurn(ctx: Context, session: Session, message: UserMessage, turn: number): Promise<void> {
  session.append('turn/start', { turn })
  const input = session.append('user/message', message, { surfaceOp: 'append' })
  emit(ctx, session, input)
  await vi.waitFor(() => {
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { status: 'processing', turn },
    })
  })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: {
      id: MessageId(`assistant-${turn}`),
      role: 'assistant',
      content: [{ type: 'text', text: `任务 ${turn} 已完成。` }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    },
  }, { surfaceOp: 'append' })
  const end = session.append('turn/end', { turn, reason: { kind: 'completed' } })
  emit(ctx, session, end)
}

describe('session requirements document pipeline', () => {
  it('starts with ambiguity analysis and never enters Plan mode', async () => {
    const { ctx, agent, session, followup, tools } = await setup()
    const input = '  保留原始输入的换行\n并先澄清  '

    const result = ctx.sessionRequirements.startRound(agent, { input, language: 'zh' })

    expect(result).toMatchObject({ roundId: 'ROUND-01', round: 1 })
    expect(session.events.find(event => event.type === 'requirement/round')?.data).toMatchObject({
      input,
      status: 'analyzing',
    })
    expect(session.events.some(event => (event as { type: string }).type === 'requirement/plan')).toBe(false)
    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'clarify_requirements', 'submit_requirements_document', 'submit_requirement_tasks',
    ]))
    const prompt = followup.mock.calls[0]?.[0]?.content[0]
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('不要进入 Plan 模式')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('不得包含术语表')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('当前 Session 的历史需求图谱索引')
  })

  it('records a clarification answer and commits a validated Chinese document', async () => {
    const { ctx, agent, session, followup, tools, ask } = await setup()
    ctx.sessionRequirements.startRound(agent, { input: '创建页面。', language: 'zh' })
    const source = followup.mock.calls[0]?.[0]
    if (source === undefined) throw new Error('expected source message')
    session.append('turn/start', { turn: 1 })
    const input = session.append('user/message', source, { surfaceOp: 'append' })
    emit(ctx, session, input)
    await Promise.resolve()

    const clarification = tools.get('clarify_requirements')
    const submit = tools.get('submit_requirements_document')
    if (clarification === undefined || submit === undefined) throw new Error('expected requirement tools')
    await clarification.execute({
      questions: [{
        id: 'scope', question: '本次改动覆盖哪里？', header: '范围',
        options: [{ label: '仅当前页面' }, { label: '整个站点' }],
      }],
    }, exec(agent))
    await submit.execute({
      summary: '创建可验证页面',
      markdown: documentMarkdown,
      relations: [],
    }, exec(agent))

    expect(ask).toHaveBeenCalledOnce()
    expect(session.events.filter(event => event.type === 'requirement/clarification').map(event => event.data.status))
      .toEqual(['asked', 'answered'])
    expect(session.events.findLast(event => event.type === 'requirement/document')).toMatchObject({
      data: { summary: '创建可验证页面', markdown: documentMarkdown, valid: true },
    })
    expect(session.events.findLast(event => event.type === 'requirement/graph')).toMatchObject({
      data: {
        revision: 1,
        documentRevision: 1,
        nodes: [{ requirementId: '1', title: '页面结构', acceptanceRefs: ['1.1', '1.2'] }],
        relations: [],
      },
    })
    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
      data: { status: 'document-ready' },
    })
  })

  it('pauses after two clarification batches and refuses a document until the user resumes', async () => {
    const { ctx, agent, session, followup, tools, ask } = await setup()
    ctx.sessionRequirements.startRound(agent, { input: '创建页面。', language: 'zh' })
    const source = followup.mock.calls[0]?.[0]
    if (source === undefined) throw new Error('expected source message')
    session.append('turn/start', { turn: 1 })
    const input = session.append('user/message', source, { surfaceOp: 'append' })
    emit(ctx, session, input)
    await Promise.resolve()

    const clarification = tools.get('clarify_requirements')
    const submit = tools.get('submit_requirements_document')
    if (clarification === undefined || submit === undefined) throw new Error('expected requirement tools')
    const questions = {
      questions: [{
        id: 'scope', question: '本次改动覆盖哪里？', header: '范围',
        options: [{ label: '仅当前页面' }, { label: '整个站点' }],
      }],
    }
    await clarification.execute(questions, exec(agent))
    await clarification.execute(questions, exec(agent))
    await expect(clarification.execute(questions, exec(agent))).rejects.toThrow('limited to 2 batches')
    await expect(submit.execute({ summary: '创建可验证页面', markdown: documentMarkdown, relations: [] }, exec(agent)))
      .rejects.toThrow('no Requirement Notebook round is ready')

    expect(ask).toHaveBeenCalledTimes(2)
    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
      data: { status: 'awaiting-input' },
    })
  })

  it('pauses when an authoring turn finishes without submitting a document', async () => {
    const { ctx, agent, session, followup } = await setup()
    ctx.sessionRequirements.startRound(agent, { input: '创建页面。', language: 'zh' })
    const source = followup.mock.calls[0]?.[0]
    if (source === undefined) throw new Error('expected source message')
    session.append('turn/start', { turn: 1 })
    const input = session.append('user/message', source, { surfaceOp: 'append' })
    emit(ctx, session, input)
    await Promise.resolve()
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    emit(ctx, session, end)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { status: 'awaiting-input' },
      })
    })
  })

  it('persists invalid document edits but refuses task generation until repaired', async () => {
    const { ctx, agent, session } = await setup()
    appendRoundArtifacts(session)

    const edited = ctx.sessionRequirements.editDocument(agent, {
      roundId: 'ROUND-01' as never,
      revision: 1,
      markdown: '# 需求文档\n\n## 简介\n\n缺少需求。',
    })

    expect(edited.documentRevision).toBe(2)
    expect(session.events.findLast(event => event.type === 'requirement/document')).toMatchObject({
      data: { revision: 2, valid: false },
    })
    expect(() => ctx.sessionRequirements.generateTasks(agent, {
      roundId: 'ROUND-01' as never,
      documentRevision: 2,
    })).toThrow('invalid')
  })

  it('rejects non-Chinese requirement content and discontinuous acceptance criteria', async () => {
    const { ctx, agent, session } = await setup()
    appendRoundArtifacts(session)
    const invalid = documentMarkdown
      .replace('### 需求 1：页面结构', '### 需求 1：Page structure')
      .replace('1. 当页面打开时，系统应当显示导航栏。', '1. Navigation is visible.')
      .replace('2. 当用户提交表单时，系统应当显示结果。', '3. 当用户提交表单时，系统应当显示结果。')

    ctx.sessionRequirements.editDocument(agent, {
      roundId: 'ROUND-01' as never,
      revision: 1,
      markdown: invalid,
    })

    const document = session.events.findLast(event => event.type === 'requirement/document')
    expect(document).toMatchObject({ data: { valid: false } })
    expect(document?.type === 'requirement/document' ? document.data.issues : []).toEqual(expect.arrayContaining([
      '需求 1 的标题应使用中文。',
      '需求 1 的验收标准 1 应使用中文。',
      '需求 1 的验收标准编号应连续；第 2 项使用了编号 3。',
    ]))
  })

  it('invalidates generated tasks when the requirement document changes', async () => {
    const { ctx, agent, session } = await setup()
    appendRoundArtifacts(session)
    ctx.sessionRequirements.editDocument(agent, {
      roundId: 'ROUND-01' as never,
      revision: 1,
      markdown: documentMarkdown.replace('实现一个可验证的页面。', '实现一个清晰且可验证的页面。'),
    })

    expect(() => ctx.sessionRequirements.runTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: 'TASK-A' as never,
    })).toThrow('generated tasks are stale')
    expect(() => ctx.sessionRequirements.runAll(agent, {
      roundId: 'ROUND-01' as never,
    })).toThrow('generated tasks are stale')
  })

  it('generates mandatory top-level task blocks with an immutable last Final Test', async () => {
    const { ctx, agent, session, followup, tools } = await setup()
    appendRoundArtifacts(session)
    const repaired = ctx.sessionRequirements.editDocument(agent, {
      roundId: 'ROUND-01' as never, revision: 1, markdown: documentMarkdown,
    })
    ctx.sessionRequirements.generateTasks(agent, {
      roundId: 'ROUND-01' as never, documentRevision: repaired.documentRevision,
    })
    const generation = followup.mock.calls[0]?.[0]
    if (generation === undefined) throw new Error('expected generation message')
    session.append('turn/start', { turn: 2 })
    const input = session.append('user/message', generation, { surfaceOp: 'append' })
    emit(ctx, session, input)
    await Promise.resolve()
    const submit = tools.get('submit_requirement_tasks')
    if (submit === undefined) throw new Error('expected task submission tool')

    await expect(submit.execute({
      tasks: [{
        kind: 'implementation', title: '实现页面',
        markdown: '- [ ] 1.2 实现导航栏和表单', requirement_refs: ['1.1', '1.2'],
      }],
      final_test: {
        title: '最终测试', markdown: '- [ ] 2.1 运行所有相关测试并修复本轮问题',
        requirement_refs: ['1.1', '1.2'],
      },
    }, exec(agent))).rejects.toThrow('checklist numbering')

    await submit.execute({
      tasks: [{
        kind: 'implementation', title: '实现页面',
        markdown: '- [ ] 1.1 实现导航栏和表单', requirement_refs: ['1.1', '1.2'],
      }],
      final_test: {
        title: '最终测试', markdown: '- [ ] 2.1 运行所有相关测试并修复本轮问题',
        requirement_refs: ['1.1', '1.2'],
      },
    }, exec(agent))

    const list = session.events.findLast(event => event.type === 'requirement/task-list')
    expect(list?.type === 'requirement/task-list' ? list.data.documentRevision : undefined).toBe(2)
    expect(list?.type === 'requirement/task-list' ? list.data.tasks.map(task => task.kind) : [])
      .toEqual(['implementation', 'final-test'])
    expect(() => ctx.sessionRequirements.withdrawTask(agent, {
      roundId: 'ROUND-01' as never, taskId: list?.type === 'requirement/task-list' ? list.data.tasks[1]!.id : 'missing' as never,
    })).toThrow('Final Test')
  })

  it('keeps the task generation source revision stable and reorders a task exactly once', async () => {
    const { ctx, agent, session } = await setup()
    appendRoundArtifacts(session)
    session.append('requirement/round', {
      version: 1, revision: 2, roundId: 'ROUND-01' as never, round: 1, sourceMessageId: 'source-1' as never,
      language: 'zh', input: '创建页面。', status: 'generating-tasks', generationMessageId: 'generation-1' as never,
    })

    expect(() => ctx.sessionRequirements.editDocument(agent, {
      roundId: 'ROUND-01' as never,
      revision: 1,
      markdown: documentMarkdown,
    })).toThrow('task generation is running')

    session.append('requirement/round', {
      version: 1, revision: 3, roundId: 'ROUND-01' as never, round: 1, sourceMessageId: 'source-1' as never,
      language: 'zh', input: '创建页面。', status: 'tasks-ready',
    })
    const inserted = ctx.sessionRequirements.addTask(agent, {
      roundId: 'ROUND-01' as never,
      afterTaskId: 'TASK-A' as never,
      title: '实现结果区',
      statement: '- [ ] 2.1 实现结果区\n\n_关联需求：1.2_',
    })
    ctx.sessionRequirements.moveTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: inserted.taskId,
      direction: 'up',
    })

    const tasks = session.events.findLast(event => event.type === 'requirement/task-list')
    expect(tasks?.type === 'requirement/task-list' ? tasks.data.tasks.map(task => task.id) : [])
      .toEqual([inserted.taskId, 'TASK-A', 'TASK-FINAL'])
  })

  it('waits for the independent task verdict before Run All advances and honors stop', async () => {
    const { ctx, agent, session, followup } = await setup({
      review: () => reviewRun('TASK-A'),
    })
    appendRoundArtifacts(session)

    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    ctx.sessionRequirements.stopRunAll(agent, { roundId: 'ROUND-01' as never })
    const first = followup.mock.calls[0]?.[0]
    if (first === undefined) throw new Error('expected first task')
    await finishTurn(ctx, session, first, 2)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'completed' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
        data: { status: 'stopped' },
      })
    })
    expect(followup).toHaveBeenCalledOnce()
    expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
      data: { tasks: [expect.objectContaining({ status: 'completed' }), expect.objectContaining({ status: 'pending' })] },
    })
  })

  it('stops on a blocking review and completes only after Final Test passes', async () => {
    let blocking = true
    let reviews = 0
    const { ctx, agent, session, followup } = await setup({
      review: () => {
        reviews += 1
        const taskId = reviews === 3 ? 'TASK-FINAL' : 'TASK-A'
        const verdict = blocking && taskId === 'TASK-A' ? 'blocking' : 'passed'
        return reviewRun(taskId, verdict)
      },
    })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)
    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'failed' },
      })
    })
    expect(followup).toHaveBeenCalledOnce()

    blocking = false
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[1]![0], 3)
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(3) })
    await finishTurn(ctx, session, followup.mock.calls[2]![0], 4)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/validation')).toMatchObject({
        data: { status: 'completed', regressions: [], failedTaskIds: [] },
      })
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { status: 'completed' },
      })
    })
  })

  it('keeps manual review read-only and records provider failure without invented findings', async () => {
    const { ctx, agent, session, start } = await setup({
      review: () => reviewRun(),
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '检查当前实现。' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await ctx.sessionRequirements.review(agent, 1)

    expect(start.mock.calls[0]?.[1]).toMatchObject({ maxDepth: 1, toolFilter: { allow: ['read'] } })
    expect(session.events.at(-1)).toMatchObject({
      type: 'requirement/review', data: { version: 3, status: 'completed', turn: 1 },
    })
  })
})
