import { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, MessageId, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SessionRequirements from '../src/index.ts'

const contexts: Context[] = []
const config = {
  reviewerProvider: 'spawn',
  maxInputChars: 20_000,
  reviewerTools: ['read'],
  maxClarificationRounds: 2,
  maxQuestionsPerRound: 5,
  taskHealthCheckAfterMs: 3_600_000,
  taskHealthCheckTimeoutMs: 300_000,
}

class NonzeroShellExecutor extends ShellExecutor {
  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/workspace',
      timeoutMs: request.timeoutMs ?? 1_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      ...request.signal === undefined ? {} : { signal: request.signal },
      ...request.dshEnv === undefined ? {} : { dshEnv: request.dshEnv },
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  override run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return Promise.resolve({
      exitCode: 9,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
    })
  }

  override start(): ShellProcess {
    throw new Error('background execution is disabled in this test')
  }
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
  vi.useRealTimers()
})

function parent(id = 'requirements-parent') {
  const session = Session.create(SessionId(id))
  const followup = vi.fn<(message: UserMessage) => void>()
  const agent = { id: session.id, session, followup, whenIdle: vi.fn(() => Promise.resolve()) } as unknown as Agent
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
  readonly transform?: (request: SubagentStartRequest) => SubagentRun
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
      return {
        session,
        followup,
        agent: { id: session.id, session, followup, whenIdle: vi.fn(() => Promise.resolve()) } as unknown as Agent,
      }
    })()
    : parent(options.id)
  const tools = new Map<string, ToolDefinition>()
  const start = vi.fn((_provider: string, request: SubagentStartRequest) => Promise.resolve(
    request.label === 'Translate task for human' || request.label === 'Revise task from human instruction'
      ? options.transform?.(request) ?? taskTextRun(request) : options.review?.(request) ?? reviewRun(),
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

function taskTextRun(request: SubagentStartRequest): SubagentRun {
  const content = request.prompt[0]
  if (content?.type !== 'text') throw new Error('expected task text prompt')
  const input = JSON.parse(content.text.slice(content.text.lastIndexOf('\n\n') + 2)) as {
    task: { title: string; statement: string }
    humanInstruction?: string
  }
  return { ...reviewRun(), result: Promise.resolve({ stopReason: 'completed', output: [], structured: {
    title: input.task.title || '创建任务', summary: '用户可以查看清晰的结果。',
    markdown: input.humanInstruction === undefined ? input.task.statement : `**目标**：${input.humanInstruction}\n- [ ] 1.1 按最新要求实现并验证`,
  } }) }
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
        id: 'TASK-A' as never, order: 0, kind: 'implementation', title: '实现页面', summary: '用户可以使用完整页面。',
        statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_', requirementRefs: ['1.1'], status: 'pending',
      },
      {
        id: 'TASK-FINAL' as never, order: 1, kind: 'final-test', title: '最终测试', summary: '确认页面满足全部需求。',
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
    turn, step: 0,
    message: {
      id: MessageId(`progress-${turn}`), role: 'assistant', content: [{ type: 'text', text: '正在读取文件和执行命令。' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    },
  }, { surfaceOp: 'append' })
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
  await vi.waitFor(() => {
    expect(session.events.findLast(event => event.type === 'requirement/task-execution' && event.data.turn === turn)).toMatchObject({
      data: { output: `任务 ${turn} 已完成。` },
    })
  })
}

describe('session requirements document pipeline', () => {
  it('cancels only the selected active turn, stops Run All, and permits retry after settlement', async () => {
    const { ctx, agent, session, followup } = await setup()
    appendRoundArtifacts(session)
    const cancel = vi.fn()
    Object.assign(agent, { cancel, inbox: { remove: vi.fn(() => false) } })
    const request = { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never }
    ctx.sessionRequirements.runAll(agent, { roundId: request.roundId })
    const message = followup.mock.calls[0]![0]
    const started = session.append('turn/start', { turn: 1 })
    emit(ctx, session, started)
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 1 })
    await vi.waitFor(() => { expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({ data: { status: 'processing' } }) })
    ctx.sessionRequirements.stopTask(agent, request)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({ data: { status: 'stopped' } })
    emit(ctx, session, session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
    await vi.waitFor(() => { expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({ data: { status: 'failed' } }) })
    ctx.sessionRequirements.runTask(agent, request)
    expect(followup).toHaveBeenCalledTimes(2)
  })

  it('ignores a cancelled queued review and never starts its reviewer', async () => {
    const { ctx, agent, session, start } = await setup()
    appendRoundArtifacts(session)
    const request = { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never }
    session.append('requirement/task-execution', {
      version: 1, revision: 1, ...request, messageId: MessageId('reviewed'), status: 'reviewing', turn: 1,
    })
    const review = ctx.sessionRequirements.review(agent, 1)
    ctx.sessionRequirements.stopTask(agent, request)
    await review
    expect(start).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({ data: { revision: 2, status: 'failed' } })
    ctx.sessionRequirements.runTask(agent, request)
  })

  it('aborts an active reviewer and rejects its late successful result', async () => {
    const completed = reviewRun('TASK-A')
    const dispose = vi.fn(() => Promise.resolve())
    let resolve!: (value: Awaited<SubagentRun['result']>) => void
    const pending = new Promise<Awaited<SubagentRun['result']>>((done) => { resolve = done })
    const { ctx, agent, session, start } = await setup({ review: () => ({ ...completed, result: pending, dispose }) })
    appendRoundArtifacts(session)
    const request = { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never }
    session.append('requirement/task-execution', {
      version: 1, revision: 1, ...request, messageId: MessageId('reviewed'), status: 'reviewing', turn: 1,
    })
    const review = ctx.sessionRequirements.review(agent, 1)
    await vi.waitFor(() => { expect(start).toHaveBeenCalledOnce() })
    ctx.sessionRequirements.stopTask(agent, request)
    expect(start.mock.calls[0]?.[1].signal?.aborted).toBe(true)
    resolve(await completed.result)
    await review
    expect(session.events.some(event => event.type === 'requirement/review')).toBe(false)
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({ data: { status: 'failed' } })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('removes a queued task message without cancelling an unrelated active turn', async () => {
    const { ctx, agent, session, followup } = await setup()
    appendRoundArtifacts(session)
    const cancel = vi.fn()
    const remove = vi.fn(() => true)
    Object.assign(agent, { cancel, inbox: { remove } })
    const request = { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never }
    ctx.sessionRequirements.runTask(agent, request)
    ctx.sessionRequirements.stopTask(agent, request)
    expect(remove).toHaveBeenCalledWith(followup.mock.calls[0]![0].id)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('rewrites execution from human direction and uses that direction in the next run', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    appendRoundArtifacts(session)
    const result = await ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never, title: '实现页面',
      summary: '只显示结果，不再需要导航栏。', statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_', humanEdit: true,
    })
    expect(result.task).toMatchObject({ summary: '只显示结果，不再需要导航栏。', humanInstruction: '只显示结果，不再需要导航栏。', status: 'pending' })
    expect(result.task?.statement).toContain('只显示结果，不再需要导航栏。')
    expect(start.mock.calls[0]?.[1].toolFilter).toEqual({ allow: [] })
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    const prompt = followup.mock.calls[0]?.[0]?.content[0]
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('只显示结果，不再需要导航栏。')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('最终回复仅含两个二级标题：\n## 交付结果')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('不得隐瞒失败')
  })

  it('saves different task descriptions concurrently without losing either edit', async () => {
    const { ctx, agent, session } = await setup()
    appendRoundArtifacts(session)
    const list = session.events.findLast(event => event.type === 'requirement/task-list')
    if (list?.type !== 'requirement/task-list') throw new Error('expected tasks')
    await Promise.all(list.data.tasks.map(task => ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never, taskId: task.id, title: task.title, statement: task.statement,
      summary: `人类修改：${task.summary}`, humanEdit: true,
    })))
    expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
      data: { tasks: list.data.tasks.map(task => expect.objectContaining({
        id: task.id, summary: `人类修改：${task.summary}`, humanInstruction: `人类修改：${task.summary}`,
      }) as unknown) },
    })
  })

  it('rejects a stale rewrite without replacing a newer task', async () => {
    let resolve!: (value: Awaited<SubagentRun['result']>) => void
    const pending = new Promise<Awaited<SubagentRun['result']>>((done) => { resolve = done })
    const { ctx, agent, session, start } = await setup({ transform: () => ({ ...reviewRun(), result: pending }) })
    appendRoundArtifacts(session)
    const saving = ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never, title: '实现页面',
      summary: '改成搜索页面。', statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_', humanEdit: true,
    })
    await vi.waitFor(() =>{  expect(start).toHaveBeenCalledOnce() })
    ctx.sessionRequirements.withdrawTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    const expected = session.events.at(-1)
    resolve({ stopReason: 'completed', output: [], structured: { title: '实现搜索', summary: '用户可以搜索。', markdown: '- [ ] 1.1 实现搜索' } })
    await expect(saving).rejects.toThrow('task changed during translation')
    expect(session.events.at(-1)).toBe(expected)
  })

  it('keeps the saved task intact when the translator returns execution details in its summary', async () => {
    const { ctx, agent, session } = await setup({ transform: () => ({ ...reviewRun(), result: Promise.resolve({
      stopReason: 'completed', output: [], structured: { title: '实现搜索', summary: '运行 pnpm test 验证。', markdown: '- [ ] 1.1 实现搜索' },
    }) }) })
    appendRoundArtifacts(session)
    const expected = session.events.at(-1)
    await expect(ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never, title: '实现页面',
      summary: '改成搜索页面。', statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_', humanEdit: true,
    })).rejects.toThrow('without commands')
    expect(session.events.at(-1)).toBe(expected)
  })

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
    const generationPrompt = generation.content[0]
    expect(generationPrompt?.type === 'text' ? generationPrompt.text : '').toContain('先完成 markdown')
    expect(generationPrompt?.type === 'text' ? generationPrompt.text : '').toContain('独立翻译器读取完整任务')
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
      summary: '用户可以查看清晰的结果。',
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

  it('invalidates a completed Final Test when a nonempty task is added', async () => {
    const { ctx, agent, session, followup } = await setup({ review: () => reviewRun('TASK-FINAL') })
    appendRoundArtifacts(session)
    const initial = session.events.findLast(event => event.type === 'requirement/task-list')
    if (initial?.type !== 'requirement/task-list') throw new Error('expected tasks')
    session.append('requirement/task-list', {
      ...initial.data,
      revision: 2,
      tasks: initial.data.tasks.map(task => ({ ...task, status: 'completed' as const })),
    })
    session.append('requirement/round', {
      version: 1, revision: 2, roundId: 'ROUND-01' as never, round: 1, sourceMessageId: 'source-1' as never,
      language: 'zh', input: '创建页面。', status: 'completed',
    })

    const inserted = ctx.sessionRequirements.addTask(agent, {
      roundId: 'ROUND-01' as never,
      afterTaskId: 'TASK-A' as never,
      title: '补充结果区',
      summary: '用户可以查看补充结果。',
      statement: '- [ ] 2.1 补充结果区\n\n_关联需求：1.2_',
    })

    expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
      data: { tasks: expect.arrayContaining([
        expect.objectContaining({ id: inserted.taskId, status: 'pending' }),
        expect.objectContaining({ id: 'TASK-FINAL', status: 'pending' }),
      ]) as unknown },
    })
    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
      data: { status: 'tasks-ready' },
    })

    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await finishTurn(ctx, session, followup.mock.calls[1]![0], 3)
    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/validation')).toMatchObject({
        data: { status: 'completed' },
      })
    })
  })

  it('completes an implementation Task without review and honors a graceful stop', async () => {
    const { ctx, agent, session, followup, start } = await setup()
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
    expect(start).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
      data: { tasks: [expect.objectContaining({ status: 'completed' }), expect.objectContaining({ status: 'pending' })] },
    })

    await ctx.sessionRequirements.editTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: 'TASK-A' as never,
      title: '实现页面',
      summary: '用户能直接读懂已完成的页面任务。',
      statement: '- [ ] 1.1 实现导航栏\n\n_关联需求：1.1_',
    })
    expect(session.events.findLast(event => event.type === 'requirement/task-list')).toMatchObject({
      data: { tasks: expect.arrayContaining([
        expect.objectContaining({ status: 'pending', summary: '用户能直接读懂已完成的页面任务。' }),
      ]) as unknown },
    })
  })

  it('returns a standalone implementation Task to tasks-ready without review', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    appendRoundArtifacts(session)

    ctx.sessionRequirements.runTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: 'TASK-A' as never,
    })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'completed' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
        data: { status: 'tasks-ready' },
      })
    })
    expect(start).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
  })

  it('waits for whole-Agent idle before queuing the next Task', async () => {
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
    const { ctx, agent, session, followup, start } = await setup({ review: () => reviewRun('TASK-FINAL') })
    Object.assign(agent, { whenIdle: vi.fn(() => idle) })
    appendRoundArtifacts(session)

    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    expect(followup).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    expect(() => ctx.sessionRequirements.runTask(agent, {
      roundId: 'ROUND-01' as never,
      taskId: 'TASK-FINAL' as never,
    })).toThrow('while Run All is active')

    releaseIdle()
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await finishTurn(ctx, session, followup.mock.calls[1]![0], 3)
    await vi.waitFor(() => { expect(start).toHaveBeenCalledOnce() })
  })

  it('does not queue the next Run All Task after disposal while waiting for idle', async () => {
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
    const { ctx, agent, session, followup } = await setup()
    Object.assign(agent, { whenIdle: vi.fn(() => idle) })
    appendRoundArtifacts(session)

    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    expect(followup).toHaveBeenCalledOnce()

    ctx.emit('session/disposed', session)
    releaseIdle()
    await Promise.resolve()
    await Promise.resolve()

    expect(followup).toHaveBeenCalledOnce()
  })

  it('retries every failed task in order before Final Test', async () => {
    const { ctx, agent, session, followup, start } = await setup({ review: () => reviewRun('TASK-FINAL') })
    appendRoundArtifacts(session)
    const list = session.events.findLast(event => event.type === 'requirement/task-list')
    if (list?.type !== 'requirement/task-list') throw new Error('expected tasks')
    session.append('requirement/task-list', { ...list.data, revision: 2, tasks: [
      { ...list.data.tasks[0]!, status: 'failed' },
      { ...list.data.tasks[0]!, id: 'TASK-B' as never, order: 1, status: 'failed' },
      { ...list.data.tasks[1]!, order: 2 },
    ] })
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    for (let index = 0; index < 3; index += 1) {
      await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(index + 1) })
      await finishTurn(ctx, session, followup.mock.calls[index]![0], index + 2)
    }
    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({ data: { status: 'completed' } })
    })
    expect(start).toHaveBeenCalledOnce()
  })

  it('stops on a blocking checkpoint review and completes only after Final Test passes', async () => {
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
    const initial = session.events.findLast(event => event.type === 'requirement/task-list')
    if (initial?.type !== 'requirement/task-list') throw new Error('expected tasks')
    session.append('requirement/task-list', { ...initial.data, revision: 2, tasks: initial.data.tasks.map(task => (
      task.id === 'TASK-A' ? { ...task, kind: 'checkpoint' as const } : task
    )) })
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

  it('stops Run All immediately when an implementation turn ends with an error', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('expected first task')
    session.append('turn/start', { turn: 2 })
    emit(ctx, session, session.append('user/message', message, { surfaceOp: 'append' }))
    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'processing' },
      })
    })
    emit(ctx, session, session.append('turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { message: 'command failed', code: 'UNKNOWN' } },
    }))
    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'failed' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
        data: { status: 'failed' },
      })
    })
    expect(followup).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('fails the Task and Run All when its message cannot be queued', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    followup.mockImplementation(() => { throw new Error('queue unavailable') })
    appendRoundArtifacts(session)

    expect(() => ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never }))
      .toThrow('queue unavailable')

    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'failed', output: 'queue unavailable' },
    })
    expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
      data: { status: 'failed' },
    })
    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
      data: { status: 'failed' },
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('records one failed round when queuing the next Run All Task fails', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    followup.mockImplementation(() => {
      if (followup.mock.calls.length === 2) throw new Error('next queue unavailable')
    })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    await finishTurn(ctx, session, followup.mock.calls[0]![0], 2)

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
        data: { status: 'failed' },
      })
    })
    expect(session.events.filter(event => event.type === 'requirement/round' && event.data.status === 'failed'))
      .toHaveLength(1)
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-FINAL', status: 'failed', output: 'next queue unavailable' },
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('stops Run All when a claimed Task fails before its user message is logged', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('expected first task')
    session.append('turn/start', { turn: 2 })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 2 })
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'processing', turn: 2 },
    })

    emit(ctx, session, session.append('turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { message: 'system prompt assembly failed', code: 'UNKNOWN' } },
    }))

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'failed', turn: 2 },
      })
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
        data: { status: 'failed' },
      })
    })
    expect(followup).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('lets a Task recover from a tool error and complete normally', async () => {
    const { ctx, agent, session, followup, start } = await setup()
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('expected first task')
    session.append('turn/start', { turn: 2 })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 2 })

    emit(ctx, session, {
      type: 'tool/result', seq: 100, time: 100,
      data: {
        turn: 2,
        step: 0,
        message: {
          id: MessageId('failed-tool-result'),
          role: 'user',
          source: { kind: 'tool', callId: 'failed-call' as never },
          content: [{
            type: 'tool-result', toolCallId: 'failed-call' as never, isError: true,
            content: [{ type: 'text', text: 'command failed' }],
          }],
        },
      },
    })

    await vi.waitFor(() => {
      expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
        data: { taskId: 'TASK-A', status: 'processing' },
      })
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
        data: { status: 'running' },
      })
    })
    expect(cancel).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()

    emit(ctx, session, session.append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    expect(session.events.findLast(event => event.type === 'requirement/task-execution' && event.data.taskId === 'TASK-A')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'completed' },
    })
  })

  it.each(['bash', 'pwsh'] as const)('keeps the Task processing when %s exits non-zero', async (toolName) => {
    const { ctx, agent, session, followup, start } = await setup()
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('expected first task')
    session.append('turn/start', { turn: 2 })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 2 })

    const emitCommand = (suffix: string, exitCode: number, text: string): void => {
      const callId = ToolCallId(`${toolName}-${suffix}`)
      session.append('tool/call', {
        turn: 2, step: 0, callId, name: toolName,
        arguments: JSON.stringify({ command: exitCode === 0 ? 'printf marker' : `exit ${exitCode}`, description: 'test command' }),
      })
      ctx.emit('tools/result', {
        callId,
        rootCallId: callId,
        token: Symbol(`${toolName}-${suffix}`) as never,
        name: toolName,
        arguments: { command: `exit ${exitCode}`, description: 'test command' },
        agent,
        signal: new AbortController().signal,
      }, {
        isError: false,
        value: {
          kind: 'foreground', exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1_000,
          stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false },
        },
        content: [{ type: 'text', text }],
      })
    }

    emitCommand('printed-marker', 0, '[exit code: 9]')
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'processing' },
    })

    emitCommand('nonzero', 9, '[exit code: 9]')
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'processing' },
    })
    expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
      data: { status: 'running' },
    })
    expect(cancel).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('lets the real Agent Loop consume a Bash failure and finish the Task', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(NonzeroShellExecutor)
    await ctx.plugin(ShellEnvPlugin)
    await ctx.plugin(ToolBash, { enableRunInBackground: false })
    const reviewer = vi.fn(() => { throw new Error('reviewer must not start') })
    ctx.provide('subagents', { start: reviewer } as never)
    ctx.provide('userQuestions', { ask: vi.fn() } as never)
    await ctx.plugin(SessionRequirements, config)
    const adapter = new MockAdapter([
      toolCallResponse('command-failure', 'bash', { command: 'exit 9', description: 'Fail command' }),
      textResponse('The command failed; handled the error and finished the task.'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('requirements-command-failure'), {
      provider: 'mock', model: 'mock',
    })
    appendRoundArtifacts(agent.session)

    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    await agent.whenIdle()

    const toolResult = agent.session.events.find(event => event.type === 'tool/result')
    if (toolResult?.type !== 'tool/result') throw new Error('expected Bash result')
    const resultBlock = toolResult.data.message.content[0]
    expect(resultBlock?.isError).toBe(false)
    expect(resultBlock?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
      .toContain('[exit code: 9]')
    expect(adapter.requests).toHaveLength(2)

    const completed = agent.session.events.findLast(event => event.type === 'requirement/task-execution'
      && event.data.taskId === 'TASK-A' && event.data.status === 'completed')
    const ended = agent.session.events.findLast(event => event.type === 'turn/end')
    expect(completed).toBeDefined()
    expect(ended).toMatchObject({
      data: { reason: { kind: 'completed' } },
    })
    expect(agent.session.events.some(event => event.type === 'requirement/task-execution'
      && event.data.taskId === 'TASK-FINAL')).toBe(false)
    expect(reviewer).not.toHaveBeenCalled()
  })

  it('allows the Task to recover from a nested PTC tool failure', async () => {
    const { ctx, agent, session, followup } = await setup()
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('expected first task')
    session.append('turn/start', { turn: 2 })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 2 })
    const rootCallId = ToolCallId('run-code-root')
    session.append('tool/call', {
      turn: 2, step: 0, callId: rootCallId, name: 'run_code', arguments: JSON.stringify({ code: 'await tools.read()' }),
    })

    ctx.emit('tools/result', {
      callId: ToolCallId('nested-read'),
      rootCallId,
      token: Symbol('nested-read') as never,
      parent: Symbol('run-code-parent') as never,
      name: 'read_file',
      arguments: { path: 'missing' },
      agent,
      signal: new AbortController().signal,
    }, {
      isError: true,
      error: { message: 'nested read failed' },
      content: [{ type: 'text', text: 'nested read failed' }],
    })

    expect(session.events.findLast(event => event.type === 'requirement/task-execution')).toMatchObject({
      data: { taskId: 'TASK-A', status: 'processing' },
    })
    expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
      data: { status: 'running' },
    })
    expect(cancel).not.toHaveBeenCalled()
  })

  it.each(['continue', 'stop'] as const)('checks after one hour and obeys an evidence-backed %s verdict', async (action) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dispose = vi.fn(async () => {})
    const { ctx, agent, session, followup, start } = await setup({ review: () => ({
      ...reviewRun(), dispose,
      result: Promise.resolve({ stopReason: 'completed', output: [], structured: {
        action, reason: action === 'stop' ? 'Repeated work without progress' : 'Implementation is progressing',
        evidence: action === 'stop' ? 'The same command and unchanged output recur across the inspected steps.' : '',
      } }),
    }) })
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runAll(agent, { roundId: 'ROUND-01' as never })
    const message = followup.mock.calls[0]![0]
    session.append('turn/start', { turn: 2 })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message, turn: 2 })
    await vi.advanceTimersByTimeAsync(3_599_999)
    expect(start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      label: 'Task health check · TASK-A', parent: agent, maxDepth: 1, toolFilter: { allow: ['read'] },
    })
    const request = start.mock.calls[0]![1]
    const prompt = request.prompt[0]
    expect(prompt?.type === 'text' ? prompt.text.split('\n')[0] : undefined).toMatchSnapshot('health-check instruction')
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')?.data).toMatchObject({
      taskId: 'TASK-A', status: action === 'stop' ? 'failed' : 'processing',
    })
    expect(cancel).toHaveBeenCalledTimes(action === 'stop' ? 1 : 0)
    expect(dispose).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(start).toHaveBeenCalledOnce()
  })

  it.each([undefined, { action: 'stop', reason: 'Too long', evidence: '' }])('does not stop on an invalid health verdict: %j', async (structured) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ctx, agent, session, followup } = await setup({ review: () => ({
      ...reviewRun(), result: Promise.resolve({ stopReason: 'completed', output: [], structured }),
    }) })
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: followup.mock.calls[0]![0], turn: 2 })
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(cancel).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')?.data).toMatchObject({ status: 'processing' })
  })

  it('does not inspect a Task that completed before one hour', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { ctx, agent, session, followup, start } = await setup()
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: followup.mock.calls[0]![0], turn: 2 })
    emit(ctx, session, session.append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(start).not.toHaveBeenCalled()
  })

  it('ignores a late stop verdict after the inspected Task has ended', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = Promise.withResolvers<Awaited<SubagentRun['result']>>()
    const dispose = vi.fn(async () => {})
    const { ctx, agent, session, followup, start } = await setup({ review: () => ({
      ...reviewRun(), result: pending.promise, dispose,
    }) })
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: followup.mock.calls[0]![0], turn: 2 })
    await vi.advanceTimersByTimeAsync(3_600_000)
    emit(ctx, session, session.append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
    expect(start.mock.calls[0]?.[1].signal?.aborted).toBe(true)
    pending.resolve({ stopReason: 'completed', output: [], structured: { action: 'stop', reason: 'Loop', evidence: 'Repeated output' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')?.data).toMatchObject({ status: 'completed' })
  })

  it('drains an active health child when its plugin is disposed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dispose = vi.fn(async () => {})
    const { ctx, agent, session, followup, start } = await setup({ review: request => ({
      ...reviewRun(), dispose,
      result: new Promise((resolve) => {
        request.signal?.addEventListener('abort', () => { resolve({ stopReason: 'aborted', output: [] }) }, { once: true })
      }),
    }) })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: followup.mock.calls[0]![0], turn: 2 })
    await vi.advanceTimersByTimeAsync(3_600_000)
    await ctx.fiber.dispose()
    expect(start.mock.calls[0]?.[1].signal?.aborted).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(start).toHaveBeenCalledOnce()
  })

  it('keeps the Task running when its health child times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dispose = vi.fn(async () => {})
    const { ctx, agent, session, followup, start } = await setup({ review: request => ({
      ...reviewRun(), dispose,
      result: new Promise((resolve) => {
        request.signal?.addEventListener('abort', () => { resolve({ stopReason: 'aborted', output: [] }) }, { once: true })
      }),
    }) })
    const cancel = vi.fn()
    Object.assign(agent, { cancel })
    appendRoundArtifacts(session)
    ctx.sessionRequirements.runTask(agent, { roundId: 'ROUND-01' as never, taskId: 'TASK-A' as never })
    emitAgentEvent(ctx, agent, 'agent/inbox/claimed', { message: followup.mock.calls[0]![0], turn: 2 })
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(start.mock.calls[0]?.[1].signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(start.mock.calls[0]?.[1].signal?.aborted).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    expect(session.events.findLast(event => event.type === 'requirement/task-execution')?.data).toMatchObject({ status: 'processing' })
  })

  it('does not automatically review an ordinary non-Task turn', async () => {
    const { ctx, session, start } = await setup()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '解释当前实现。' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    emit(ctx, session, session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))

    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })

    expect(start).not.toHaveBeenCalled()
    expect(session.events.some(event => event.type === 'requirement/review')).toBe(false)
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
