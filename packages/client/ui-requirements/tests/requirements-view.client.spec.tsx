// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RequirementGraphProjection } from '@deepseek-ai/dsh-session-requirements/client'
import { RequirementsView } from '../src/client/RequirementsView.tsx'
import type {
  RequirementClarificationNode,
  RequirementDocumentNode,
  RequirementNoteNode,
  RequirementReviewNode,
  RequirementRoundNode,
  RequirementTaskExecutionNode,
  RequirementTaskListNode,
  RequirementValidationNode,
  RequirementsSnapshot,
} from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

const roundId = 'ROUND-01' as never
const taskId = 'TASK-01' as never
const secondTaskId = 'TASK-02' as never
const sessionId = 'SESSION-01' as never
const workspaceId = 'WORKSPACE-01' as never

function graphProjection(title = 'Notebook 需求节点'): RequirementGraphProjection {
  return {
    rounds: [{
      roundId,
      round: 1,
      summary: '实现 Notebook 需求流',
      documentRevision: 1,
      nodes: [{ requirementId: '1', title, acceptanceRefs: ['1.1'], taskIds: [taskId], status: 'pending' }],
      relations: [],
    }],
  }
}

function sessionList(projection: RequirementGraphProjection = graphProjection()): SessionListState {
  return {
    ids: [sessionId],
    byId: {
      [sessionId]: {
        id: sessionId,
        displayTitle: 'Notebook 需求流',
        running: false,
        blank: false,
        updatedAt: 1,
        projectionValues: { requirementGraph: projection },
      },
    },
    current: sessionId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function workspaceSnapshot(sessionIds = [sessionId]): WorkspaceSnapshot {
  return {
    items: [{
      workspaceId,
      path: '/tmp/intentflow',
      title: 'IntentFlow',
      sessionIds,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

function base<T>(kind: string, data: T, seq: number): { key: string; kind: string; id: string; target: 'requirements'; anchorSeq: number; time: number; data: T } {
  return { key: `${kind}:${seq}`, kind, id: String(seq), target: 'requirements', anchorSeq: seq, time: seq * 10, data }
}

function snapshot(): RequirementsSnapshot {
  const round: RequirementRoundNode = base('requirements-round', {
    version: 1,
    revision: 1,
    roundId,
    round: 1,
    sourceMessageId: 'message-1' as never,
    language: 'zh',
    input: '实现一个 Notebook 需求流。',
    status: 'executing',
    turn: 1,
  }, 1) as RequirementRoundNode
  const clarification: RequirementClarificationNode = base('requirements-clarification', {
    version: 1,
    revision: 1,
    roundId,
    attempt: 1,
    status: 'answered',
    questions: [{ id: 'scope', question: '覆盖哪个范围？' }],
    answers: [{ id: 'scope', selected: ['当前页面'] }],
  }, 2) as RequirementClarificationNode
  const document: RequirementDocumentNode = base('requirements-document', {
    version: 1,
    revision: 1,
    roundId,
    turn: 1,
    summary: '实现 Notebook 需求流',
    markdown: '# 需求文档\n\n## 简介\n\n实现 Notebook。\n\n## 需求\n\n### 需求 1：Notebook\n\n**用户故事：** 作为用户，我希望使用 Notebook。\n\n#### 验收标准\n\n1. 系统应当显示任务。',
    valid: true,
    issues: [],
  }, 3) as RequirementDocumentNode
  const tasks: RequirementTaskListNode = base('requirements-task-list', {
    version: 1,
    revision: 1,
    roundId,
    documentRevision: 1,
    tasks: [
      { id: taskId, order: 0, kind: 'implementation', title: '建立 Notebook', statement: '渲染需求、Task 和验证单元格。\n\n_关联需求：1.1_', requirementRefs: ['1.1'], status: 'pending' },
      { id: secondTaskId, order: 1, kind: 'final-test', title: '验证 Notebook', statement: '检查 Notebook 的完整用户路径。\n\n_关联需求：1.1_', requirementRefs: ['1.1'], status: 'pending' },
    ],
  }, 4) as RequirementTaskListNode
  const validation: RequirementValidationNode = base('requirements-validation', {
    version: 1,
    revision: 1,
    roundId,
    turn: 1,
    reviewedThroughSeq: 4,
    status: 'pending',
    summary: { zh: '等待任务完成后验证。', en: 'Waiting for task completion.' },
    regressions: [],
    failedTaskIds: [],
  }, 5) as RequirementValidationNode
  return {
    reviews: [], userVersions: [], executions: [], rounds: [round], clarifications: [clarification], documents: [document],
    taskLists: [tasks], taskExecutions: [], runAlls: [], notes: [], validations: [validation],
  }
}

function props(
  overrides: Partial<Parameters<typeof RequirementsView>[0]> = {},
  value: RequirementsSnapshot = snapshot(),
): Parameters<typeof RequirementsView>[0] {
  const useRequirements = <Selected,>(selector: (current: RequirementsSnapshot) => Selected): Selected => selector(value)
  const sessions = sessionList()
  const workspaces = workspaceSnapshot()
  const action = <T,>(result: T): Promise<{ readonly ok: true; readonly value: T }> => Promise.resolve({ ok: true, value: result })
  return {
    sessionId,
    useSessions: <Selected,>(selector: (current: SessionListState) => Selected): Selected => selector(sessions),
    useWorkspaces: <Selected,>(selector: (current: WorkspaceSnapshot) => Selected): Selected => selector(workspaces),
    useRequirements,
    startRound: () => action({ roundId, round: 1, eventSeq: 1 }),
    editDocument: vi.fn(() => action({ roundId, documentRevision: 2, eventSeq: 6 })),
    generateTasks: vi.fn(() => action({ roundId, documentRevision: 1, eventSeq: 6 })),
    runTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    runAll: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    stopRunAll: vi.fn(() => action({ roundId, eventSeq: 6 })),
    addTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    editTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    moveTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    withdrawTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    addNote: vi.fn(() => action({ roundId, noteId: 'NOTE-01', eventSeq: 6 })),
    editNote: vi.fn(() => action({ roundId, noteId: 'NOTE-01', eventSeq: 7 })),
    requestReview: () => Promise.resolve(undefined),
    openSession: vi.fn(),
    initialLanguage: 'zh',
    t,
    viewRequest: null,
    openView: vi.fn(),
    completeViewRequest: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof RequirementsView>[0]
}

function selectTask(title = '建立 Notebook'): HTMLElement {
  const cell = screen.getByRole('textbox', { name: `任务内容 ${title}` }).closest('article')
  if (cell === null) throw new Error(`task Notebook cell ${title} is missing`)
  fireEvent.click(cell)
  return cell
}

function reviewSnapshot(): RequirementsSnapshot {
  const value = snapshot()
  const review: RequirementReviewNode = base('requirements-review', {
    version: 2,
    status: 'completed',
    turn: 2,
    reviewedThroughSeq: 8,
    reviewerSessionId: 'reviewer-1' as never,
    requirements: [{
      id: 'R1',
      title: { zh: 'Notebook 需求流', en: 'Notebook requirement flow' },
      statement: { zh: '按顺序显示需求执行。', en: 'Show requirement execution in order.' },
      lifecycle: 'active',
      change: 'added',
      sources: [{ seq: 1, kind: 'user', summary: { zh: '用户原始需求。', en: 'Raw user request.' } }],
      code: [{
        path: 'index.html',
        relation: 'implements',
        evidence: { zh: '实现页面结构。', en: 'Implements the page structure.' },
      }],
      audit: {
        status: 'verified',
        summary: { zh: '路径已验证。', en: 'The path is verified.' },
        gaps: [{ zh: '无自动截图基线。', en: 'No automated screenshot baseline.' }],
      },
    }],
  }, 8) as RequirementReviewNode
  return { ...value, reviews: [review] }
}

describe('RequirementsView Notebook', () => {
  it('owns Notebook scrolling while the shared composer overlays the view', () => {
    const { container } = render(<RequirementsView {...props()} />)
    expect(container.querySelector('[data-conversation-composer-overlay]')).toBeTruthy()
    expect(container.querySelector('[data-notebook-scroll]')).toBeTruthy()
  })

  it('renders the requirement-to-validation order with top-only add controls', () => {
    const { container } = render(<RequirementsView {...props()} />)

    const cells = [...container.querySelectorAll<HTMLElement>('[data-cell]')]
    expect(cells.map(cell => cell.dataset.cell)).toEqual(['clarification-record', 'document', 'task', 'task', 'validation'])
    expect(screen.getAllByRole('button', { name: '代码' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '文本' })).toHaveLength(1)
    expect(container.querySelector('[data-notebook-scroll]')).toBeTruthy()
    expect(container.querySelector('[data-composer-input]')).toBeNull()
    expect(screen.getByRole('group', { name: 'Notebook 缩放' })).toBeTruthy()
    expect(screen.getByText('TASK1')).toBeTruthy()
    expect(screen.getByText('TASK2')).toBeTruthy()
    expect(screen.queryByText('1.1')).toBeNull()
  })

  it('runs only the selected task and opens details from the More menu', async () => {
    const runTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 6 } }))
    render(<RequirementsView {...props({ runTask })} />)

    const cell = selectTask()
    expect(cell.dataset.selected).toBe('true')
    fireEvent.click(within(cell).getByRole('button', { name: '运行任务 建立 Notebook' }))
    await waitFor(() => { expect(runTask).toHaveBeenCalledWith({ roundId, taskId }) })
    await waitFor(() => { expect(within(cell).getByRole('button', { name: '运行任务 建立 Notebook' })).toBeTruthy() })

    fireEvent.click(within(cell).getByRole('button', { name: '更多单元格操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看详情与证据' }))
    expect(screen.getByRole('complementary', { name: 'Notebook 详情' })).toBeTruthy()
    expect(screen.getByText('TASK-01')).toBeTruthy()
  })

  it('renders complete task output as Markdown outside the editable cell', () => {
    const value = snapshot()
    const execution: RequirementTaskExecutionNode = base('requirements-task-execution', {
      version: 1,
      revision: 1,
      roundId,
      taskId,
      messageId: 'message-output' as never,
      status: 'completed',
      turn: 2,
      output: '# 实现完成\n\n- **页面结构**通过\n- `index.html` 已生成',
    }, 6) as RequirementTaskExecutionNode
    render(<RequirementsView {...props({}, { ...value, taskExecutions: [execution] })} />)

    const input = screen.getByRole('textbox', { name: '任务内容 建立 Notebook' })
    const cell = input.closest('article')
    const output = screen.getByRole('region', { name: '任务输出 建立 Notebook' })
    expect(cell).toBeTruthy()
    expect(output.closest('article')).toBeNull()
    expect(cell?.parentElement?.firstElementChild).toBe(cell)
    expect(cell?.nextElementSibling).toBe(output)
    const collapse = within(output).getByRole('button', { name: '收起任务输出 建立 Notebook' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    expect(within(output).getByRole('heading', { name: '实现完成' })).toBeTruthy()
    expect(within(output).getByText('页面结构', { selector: 'strong' })).toBeTruthy()
    expect(within(output).getByText('index.html', { selector: 'code' })).toBeTruthy()
    fireEvent.click(collapse)
    expect(within(output).queryByRole('heading', { name: '实现完成' })).toBeNull()
    const expand = within(output).getByRole('button', { name: '展开任务输出 建立 Notebook' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(expand)
    expect(within(output).getByRole('heading', { name: '实现完成' })).toBeTruthy()
  })

  it('autosaves the title and indented statement without Save or Cancel controls', async () => {
    const editTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 7 } }))
    render(<RequirementsView {...props({ editTask })} />)

    const cell = selectTask()
    const content = within(cell).getByRole('textbox', { name: '任务内容 建立 Notebook' }) as HTMLTextAreaElement
    expect(content.value).toBe('建立 Notebook\n  渲染需求、Task 和验证单元格。\n  \n  _关联需求：1.1_')
    expect(within(cell).queryByRole('textbox', { name: '任务标题' })).toBeNull()
    expect(within(cell).queryByRole('textbox', { name: '任务说明' })).toBeNull()

    fireEvent.change(content, { target: { value: '更新 Notebook\n  保留统一单元格编辑。\n  正文继续缩进。' } })
    expect(within(cell).queryByRole('button', { name: '保存' })).toBeNull()
    expect(within(cell).queryByRole('button', { name: '取消' })).toBeNull()
    await waitFor(() => { expect(editTask).toHaveBeenCalledWith({
      roundId,
      taskId,
      title: '更新 Notebook',
      statement: '保留统一单元格编辑。\n正文继续缩进。',
    }) })
  })

  it('retains failed autosaves and refuses to execute stale content', async () => {
    const editTask = vi.fn(() => Promise.resolve({ ok: false as const, error: 'connection lost' }))
    const injected = props({ editTask })
    render(<RequirementsView {...injected} />)
    const cell = selectTask()
    const content = within(cell).getByRole('textbox', { name: '任务内容 建立 Notebook' }) as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: '临时标题\n  临时正文' } })
    await waitFor(() => { expect(within(cell).getByRole('alert').textContent).toContain('自动保存失败') })
    selectTask('验证 Notebook')
    expect(content.value).toBe('临时标题\n  临时正文')
    fireEvent.click(within(cell).getByRole('button', { name: '运行任务 建立 Notebook' }))
    await waitFor(() => { expect(editTask).toHaveBeenCalledTimes(2) })
    expect(injected.runTask).not.toHaveBeenCalled()
    expect(content.value).toBe('临时标题\n  临时正文')
  })

  it('inserts a Markdown note, autosaves source, and projects only its latest revision', async () => {
    const addNote = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, noteId: 'NOTE-01' as never, eventSeq: 6 } }))
    const injected = props({ addNote })
    const { rerender } = render(<RequirementsView {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: '文本' }))
    await waitFor(() => { expect(addNote).toHaveBeenCalledWith({ roundId, kind: 'text', content: '', dispatch: false }) })
    const note = base('requirements-note', { version: 1, roundId, noteId: 'NOTE-01' as never,
      kind: 'text', content: '', dispatched: false,
    }, 6) as RequirementNoteNode
    const source = '# 验收备注\n\n- **检查**导航\n- `index.html`\n\n```js\nconst ready = true\n```'
    const actions = { addNote, editNote: injected.editNote, runTask: injected.runTask }
    rerender(<RequirementsView {...props(actions, { ...snapshot(), notes: [note] })} />)
    const input = screen.getByRole('textbox', { name: 'Markdown 备注内容' })
    expect(document.activeElement).toBe(input)
    const cell = input.closest('article')!
    expect(within(cell).getByText('MD')).toBeTruthy()
    expect(within(cell).queryByRole('button', { name: '保存' })).toBeNull()
    expect(within(cell).queryByRole('button', { name: /运行/ })).toBeNull()
    fireEvent.change(input, { target: { value: source } })
    await waitFor(() => { expect(injected.editNote).toHaveBeenCalledWith({ roundId, noteId: 'NOTE-01', content: source }) })
    fireEvent.click(within(cell).getByRole('button', { name: '预览备注' }))
    expect(within(cell).getByRole('heading', { name: '验收备注' })).toBeTruthy()
    expect(within(cell).getByText('检查', { selector: 'strong' })).toBeTruthy()
    expect(within(cell).getByText('index.html', { selector: 'code' })).toBeTruthy()
    expect(within(cell).getAllByRole('listitem')).toHaveLength(2)
    expect(injected.runTask).not.toHaveBeenCalled()
    const updated = { ...note, key: 'note:7', anchorSeq: 7, data: { ...note.data, content: source } }
    rerender(<RequirementsView {...props(actions, { ...snapshot(), notes: [note, updated] })} />)
    expect(screen.getAllByText('Markdown 备注')).toHaveLength(1)
    fireEvent.click(within(cell).getByRole('button', { name: '编辑备注' }))
    expect(within(cell).getByRole<HTMLTextAreaElement>('textbox').value).toBe(source)
  })

  it('creates a durable empty code cell, grows it with input, and runs a title-only edit', async () => {
    const addedTaskId = 'TASK-03' as never
    const addTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId: addedTaskId, eventSeq: 6 } }))
    const injected = props({ addTask, editTask: vi.fn(() => Promise.resolve({ ok: true as const,
      value: { roundId, taskId: addedTaskId, eventSeq: 7 },
    })) })
    const { rerender } = render(<RequirementsView {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: '代码' }))
    await waitFor(() => { expect(addTask).toHaveBeenCalledWith({ roundId, title: '', statement: '' }) })
    const value = snapshot()
    const tasks = value.taskLists[0]!
    rerender(<RequirementsView {...props({ addTask, editTask: injected.editTask, runTask: injected.runTask }, { ...value, taskLists: [
      { ...tasks, anchorSeq: 6, data: { ...tasks.data, revision: 2, tasks: [tasks.data.tasks[0]!,
        { id: addedTaskId, order: 1, kind: 'implementation', title: '', statement: '', requirementRefs: [], status: 'pending' },
        { ...tasks.data.tasks[1]!, order: 2 },
      ] } },
    ] })} />)
    const content = screen.getByRole('textbox', { name: '任务内容 新任务' }) as HTMLTextAreaElement
    const cell = content.closest('article')!
    expect(content).toBe(document.activeElement)
    expect(within(cell).getByText('TASK2')).toBeTruthy()
    expect(within(cell).queryByRole('button', { name: '保存' })).toBeNull()
    expect(within(cell).queryByRole('button', { name: '取消' })).toBeNull()
    expect(within(cell).getByRole('button', { name: '运行任务 新任务' }).hasAttribute('disabled')).toBe(true)
    expect(content.style.height).toBe('30px')
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 96 })
    fireEvent.change(content, { target: { value: '创建 HTML\n  第一行\n  第二行\n  第三行' } })
    expect(content.style.height).toBe('96px')
    await waitFor(() => { expect(injected.editTask).toHaveBeenCalledWith({
      roundId,
      taskId: addedTaskId,
      title: '创建 HTML',
      statement: '第一行\n第二行\n第三行',
    }) })
    fireEvent.change(content, { target: { value: '创建 HTML' } })
    fireEvent.click(within(cell).getByRole('button', { name: '运行任务 新任务' }))
    await waitFor(() => { expect(injected.runTask).toHaveBeenCalledWith({ roundId, taskId: addedTaskId }) })
    expect(injected.editTask).toHaveBeenLastCalledWith({ roundId, taskId: addedTaskId, title: '创建 HTML', statement: '' })
  })

  it.each(['one', 'all'] as const)('waits for the latest queued edit before running %s', async (mode) => {
    type Outcome = Awaited<ReturnType<Parameters<typeof RequirementsView>[0]['editTask']>>
    const completions: ((outcome: Outcome) => void)[] = []
    const editTask = vi.fn(() => new Promise<Outcome>((resolve) => { completions.push(resolve) }))
    const injected = props({ editTask })
    render(<RequirementsView {...injected} />)
    const cell = selectTask()
    const content = within(cell).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: '第一版' } })
    await waitFor(() => { expect(editTask).toHaveBeenCalledTimes(1) })
    fireEvent.change(content, { target: { value: '第二版' } })
    fireEvent.change(content, { target: { value: '最终版\n  完整细节' } })
    fireEvent.click(mode === 'one'
      ? within(cell).getByRole('button', { name: '运行任务 建立 Notebook' })
      : screen.getByRole('button', { name: '全部运行' }))
    expect(content.readOnly).toBe(true)
    expect(injected.runTask).not.toHaveBeenCalled()
    expect(injected.runAll).not.toHaveBeenCalled()
    await act(async () => { completions[0]!({ ok: true, value: { roundId, taskId, eventSeq: 6 } }) })
    expect(editTask).toHaveBeenCalledTimes(2)
    expect(editTask).toHaveBeenLastCalledWith({ roundId, taskId, title: '最终版', statement: '完整细节' })
    expect(injected.runTask).not.toHaveBeenCalled()
    expect(injected.runAll).not.toHaveBeenCalled()
    await act(async () => { completions[1]!({ ok: true, value: { roundId, taskId, eventSeq: 7 } }) })
    expect(mode === 'one' ? injected.runTask : injected.runAll).toHaveBeenCalledOnce()
    expect(content.value).toBe('最终版\n  完整细节')
  })

  it('autosaves clearing a task and disables its run button', async () => {
    const injected = props()
    render(<RequirementsView {...injected} />)
    const cell = selectTask()
    fireEvent.change(within(cell).getByRole('textbox'), { target: { value: '' } })
    await waitFor(() => { expect(injected.editTask).toHaveBeenCalledWith({ roundId, taskId, title: '', statement: '' }) })
    expect(within(cell).getByRole('button', { name: '运行任务 建立 Notebook' }).hasAttribute('disabled')).toBe(true)
    expect(within(cell).getByRole<HTMLTextAreaElement>('textbox').value).toBe('')
  })

  it('keeps the insertion toolbar above the Notebook without a direct language switch', async () => {
    const runAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 6 } }))
    const requestReview = vi.fn(() => Promise.resolve(undefined))
    const { container } = render(<RequirementsView {...props({ runAll, requestReview })} />)
    const toolbar = screen.getByRole('toolbar', { name: '需求视图工具栏' })
    const notebook = container.querySelector('[data-notebook-scroll]')
    expect(toolbar.getAttribute('data-sticky-toolbar')).toBe('true')
    expect(toolbar.parentElement).toBe(notebook?.parentElement?.parentElement)
    expect(screen.queryByRole('group', { name: '需求内容语言' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全部运行' }))
    await waitFor(() => { expect(runAll).toHaveBeenCalledWith({ roundId }) })

    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    expect(screen.getByRole('menuitem', { name: '全部收起' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '全部展开' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '重新审核' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '使用中文内容' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '使用英文内容' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '全部收起' }))
    expect(screen.queryByText('需求文档')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '全部展开' }))
    expect(screen.getAllByText('需求文档').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '使用英文内容' }))
    expect(screen.getByText('Waiting for task completion.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重新审核' }))
    await waitFor(() => { expect(requestReview).toHaveBeenCalledOnce() })

    fireEvent.click(screen.getByRole('button', { name: '缩小 Notebook' }))
    expect(screen.getByText('95%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '放大 Notebook' }))
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('keeps Final Test last while supporting edit, comment, withdraw, and Agent assistance actions', async () => {
    const moveTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 6 } }))
    const editTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 7 } }))
    const withdrawTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 8 } }))
    const addNote = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, noteId: 'NOTE-01' as never, eventSeq: 9 } }))
    const openView = vi.fn()
    render(<RequirementsView {...props({ moveTask, editTask, withdrawTask, addNote, openView })} />)

    let cell = selectTask()
    expect(within(cell).getByRole('button', { name: '选择下一个任务' }).hasAttribute('disabled')).toBe(true)
    cell = selectTask('验证 Notebook')
    expect(within(cell).getByRole('button', { name: '选择上一个任务' }).hasAttribute('disabled')).toBe(true)
    expect(moveTask).not.toHaveBeenCalled()
    await waitFor(() => { expect(within(cell).getByRole('button', { name: '编辑任务' }).hasAttribute('disabled')).toBe(false) })
    cell = selectTask()
    fireEvent.change(within(cell).getByRole('textbox', { name: '任务内容 建立 Notebook' }), {
      target: { value: '更新 Notebook\n  渲染需求、Plan、Task 和验证单元格。' },
    })
    await waitFor(() => { expect(editTask).toHaveBeenCalledWith({
      roundId,
      taskId,
      title: '更新 Notebook',
      statement: '渲染需求、Plan、Task 和验证单元格。',
    }) })

    await waitFor(() => { expect(screen.queryByRole('button', { name: '保存' })).toBeNull() })
    cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '添加批注' }))
    fireEvent.change(screen.getByRole('textbox', { name: '输入文本或批注…' }), { target: { value: '先核对交互' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(addNote).toHaveBeenCalledWith({ roundId, kind: 'comment', content: '先核对交互', dispatch: false })

    await waitFor(() => { expect(screen.queryByRole('textbox', { name: '输入文本或批注…' })).toBeNull() })
    cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '请求 Agent 解释或优化此任务' }))
    expect(addNote).toHaveBeenLastCalledWith(expect.objectContaining({ roundId, kind: 'comment', dispatch: true }))
    await waitFor(() => { expect(openView).toHaveBeenCalledWith('chat', 'TASK-01') })

    cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '更多单元格操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回任务' }))
    await waitFor(() => { expect(withdrawTask).toHaveBeenCalledWith({ roundId, taskId }) })
  })

  it('renders pending, active, turn, failed, completed, and withdrawn execution marks', () => {
    const value = snapshot()
    const taskList: RequirementTaskListNode = base('requirements-task-list', {
      version: 1,
      revision: 2,
      roundId,
      documentRevision: 1,
      tasks: [
        { id: 'PENDING' as never, order: 0, kind: 'implementation', title: '等待任务', statement: 'pending', requirementRefs: ['1.1'], status: 'pending' },
        { id: 'ACTIVE' as never, order: 1, kind: 'implementation', title: '运行任务', statement: 'active', requirementRefs: ['1.1'], status: 'in_progress' },
        { id: 'TURN' as never, order: 2, kind: 'implementation', title: '轮次任务', statement: 'turn', requirementRefs: ['1.1'], status: 'in_progress' },
        { id: 'FAILED' as never, order: 3, kind: 'implementation', title: '失败任务', statement: 'failed', requirementRefs: ['1.1'], status: 'failed' },
        { id: 'DONE' as never, order: 4, kind: 'implementation', title: '完成任务', statement: 'done', requirementRefs: ['1.1'], status: 'completed' },
        { id: 'GONE' as never, order: 5, kind: 'implementation', title: '撤回任务', statement: 'withdrawn', requirementRefs: ['1.1'], status: 'withdrawn' },
        { id: 'FINAL' as never, order: 6, kind: 'final-test', title: '最终测试', statement: 'final', requirementRefs: ['1.1'], status: 'pending' },
      ],
    }, 9) as RequirementTaskListNode
    const active: RequirementTaskExecutionNode = base('requirements-task-execution', {
      version: 1, revision: 1, roundId, taskId: 'ACTIVE' as never, messageId: 'active-message' as never, status: 'submitted',
    }, 10) as RequirementTaskExecutionNode
    const turn: RequirementTaskExecutionNode = base('requirements-task-execution', {
      version: 1, revision: 1, roundId, taskId: 'TURN' as never, messageId: 'turn-message' as never, status: 'processing', turn: 11,
    }, 11) as RequirementTaskExecutionNode
    const { container } = render(<RequirementsView {...props({}, { ...value, taskLists: [taskList], taskExecutions: [active, turn] })} />)
    const taskText = [...container.querySelectorAll<HTMLElement>('[data-cell="task"]')].map(cell => cell.textContent)
    expect(taskText).toEqual(expect.arrayContaining([
      expect.stringContaining('[ ]'),
      expect.stringContaining('[*]'),
      expect.stringContaining('[11]'),
      expect.stringContaining('[!]'),
      expect.stringContaining('[✓]'),
      expect.stringContaining('[×]'),
    ]))
  })

  it('marks only reviewer-confirmed regressions red and keeps failures amber', () => {
    const value = snapshot()
    const taskList: RequirementTaskListNode = base('requirements-task-list', {
      ...value.taskLists[0]!.data,
      revision: 2,
      tasks: [
        { id: taskId, order: 0, kind: 'implementation', title: '回归任务', statement: 'regression', requirementRefs: ['1.1'], status: 'completed' },
        { id: secondTaskId, order: 1, kind: 'final-test', title: '失败任务', statement: 'failure', requirementRefs: ['1.1'], status: 'failed' },
      ],
    }, 7) as RequirementTaskListNode
    const validation: RequirementValidationNode = base('requirements-validation', {
      ...value.validations[0]!.data,
      revision: 2,
      status: 'completed',
      regressions: [{ requirementId: 'R-old', taskId, reason: { zh: '意外删除旧功能。', en: 'Removed an old feature.' } }],
      failedTaskIds: [secondTaskId],
    }, 8) as RequirementValidationNode
    const { container } = render(<RequirementsView {...props({}, { ...value, taskLists: [taskList], validations: [validation] })} />)
    expect(container.querySelector('[data-cell="task"][data-status="regression"]')).toBeTruthy()
    expect(container.querySelector('[data-cell="task"][data-status="failed"]')).toBeTruthy()
    expect(container.querySelector('[data-cell="validation"][data-status="regression"]')).toBeTruthy()
  })

  it('shows review evidence and opens the Workspace requirement graph on demand', () => {
    const { container } = render(<RequirementsView {...props({}, reviewSnapshot())} />)
    let cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '更多单元格操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看详情与证据' }))
    expect(screen.getByText(/用户原始需求。/u)).toBeTruthy()
    expect(screen.getByText((_content, element) => element?.tagName === 'CODE' && element.textContent === 'index.html')).toBeTruthy()
    expect(screen.getByText('无自动截图基线。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))

    cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '更多单元格操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看审核历史' }))
    expect(screen.getByText('Agent 第 2 轮审核')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))

    fireEvent.click(screen.getByRole('button', { name: '打开或关闭需求知识图谱' }))
    expect(screen.queryByRole('complementary', { name: 'Workspace 需求知识图谱' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开需求知识图谱' }))
    const graph = screen.getByRole('complementary', { name: 'Workspace 需求知识图谱' })
    expect(within(graph).getByText('IntentFlow')).toBeTruthy()
    expect(within(graph).getByText('当前 Session')).toBeTruthy()
    const node = within(graph).getByRole('button', { name: /需求 1：Notebook 需求节点/u })
    expect(node.dataset.status).toBe('pending')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    fireEvent.click(node)
    expect(container.querySelector('[data-task-id="TASK-01"]')?.getAttribute('data-selected')).toBe('true')
  })

  it('opens a different Session when its Workspace graph node is selected', () => {
    const otherSessionId = 'SESSION-02' as never
    const otherRoundId = 'ROUND-02' as never
    const sessions = sessionList()
    const withOther: SessionListState = {
      ...sessions,
      ids: [sessionId, otherSessionId],
      byId: {
        ...sessions.byId,
        [otherSessionId]: {
          id: otherSessionId,
          displayTitle: '第二个需求会话',
          running: false,
          blank: false,
          updatedAt: 2,
          projectionValues: {
            requirementGraph: {
              rounds: [{
                roundId: otherRoundId,
                round: 1,
                summary: '跨会话需求',
                documentRevision: 1,
                nodes: [{
                  requirementId: '1', title: '跨会话节点', acceptanceRefs: ['1.1'], taskIds: [], status: 'pending',
                }],
                relations: [],
              }],
            },
          },
        },
      },
    }
    const workspaces = workspaceSnapshot([sessionId, otherSessionId])
    const openSession = vi.fn()
    render(<RequirementsView {...props({
      openSession,
      useSessions: <Selected,>(selector: (current: SessionListState) => Selected): Selected => selector(withOther),
      useWorkspaces: <Selected,>(selector: (current: WorkspaceSnapshot) => Selected): Selected => selector(workspaces),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: /需求 1：跨会话节点/u }))
    expect(openSession).toHaveBeenCalledWith(otherSessionId)
  })
})
