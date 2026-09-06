// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RequirementsView } from '../src/client/RequirementsView.tsx'
import type {
  RequirementMarkdownNode,
  RequirementNoteNode,
  RequirementPlanNode,
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
  const markdown: RequirementMarkdownNode = base('requirements-markdown', {
    version: 1,
    revision: 1,
    roundId,
    sourceMessageId: 'message-1' as never,
    language: 'zh',
    markdown: '# 用户需求\n\n实现一个 Notebook 需求流。',
  }, 2) as RequirementMarkdownNode
  const plan: RequirementPlanNode = base('requirements-plan', {
    version: 1,
    revision: 2,
    roundId,
    turn: 1,
    status: 'approved',
    markdown: '1. 建立需求 Markdown\n2. 拆分并执行任务',
  }, 3) as RequirementPlanNode
  const tasks: RequirementTaskListNode = base('requirements-task-list', {
    version: 1,
    revision: 1,
    roundId,
    planSeq: 3,
    tasks: [
      { id: taskId, order: 0, title: '建立 Notebook', statement: '渲染需求、Plan、Task 和验证单元格。', status: 'pending' },
      { id: secondTaskId, order: 1, title: '验证 Notebook', statement: '检查 Notebook 的完整用户路径。', status: 'pending' },
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
    reviews: [], userVersions: [], executions: [], rounds: [round], markdowns: [markdown], plans: [plan],
    taskLists: [tasks], taskExecutions: [], notes: [], validations: [validation],
  }
}

function props(
  overrides: Partial<Parameters<typeof RequirementsView>[0]> = {},
  value: RequirementsSnapshot = snapshot(),
): Parameters<typeof RequirementsView>[0] {
  const useRequirements = <Selected,>(selector: (current: RequirementsSnapshot) => Selected): Selected => selector(value)
  const action = <T,>(result: T): Promise<{ readonly ok: true; readonly value: T }> => Promise.resolve({ ok: true, value: result })
  return {
    useRequirements,
    startRound: () => action({ roundId, round: 1, eventSeq: 1 }),
    runTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    runAll: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    addTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    editTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    moveTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    withdrawTask: vi.fn(() => action({ roundId, taskId, eventSeq: 6 })),
    addNote: vi.fn(() => action({ roundId, noteId: 'NOTE-01', eventSeq: 6 })),
    editNote: vi.fn(() => action({ roundId, noteId: 'NOTE-01', eventSeq: 7 })),
    requestReview: () => Promise.resolve(undefined),
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
  it('renders the requirement-to-validation order with top-only add controls', () => {
    const { container } = render(<RequirementsView {...props()} />)

    const cells = [...container.querySelectorAll<HTMLElement>('[data-cell]')]
    expect(cells.map(cell => cell.dataset.cell)).toEqual(['markdown', 'plan', 'task', 'task', 'validation'])
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
    expect(content.value).toBe('建立 Notebook\n  渲染需求、Plan、Task 和验证单元格。')
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
      { ...tasks, anchorSeq: 6, data: { ...tasks.data, revision: 2, tasks: [...tasks.data.tasks,
        { id: addedTaskId, order: 2, title: '', statement: '', status: 'pending' },
      ] } },
    ] })} />)
    const content = screen.getByRole('textbox', { name: '任务内容 新任务' }) as HTMLTextAreaElement
    const cell = content.closest('article')!
    expect(content).toBe(document.activeElement)
    expect(within(cell).getByText('TASK3')).toBeTruthy()
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
    expect(toolbar.parentElement).toBe(notebook?.parentElement)
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
    expect(screen.queryByText('需求 Markdown')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '全部展开' }))
    expect(screen.getByText('需求 Markdown')).toBeTruthy()

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

  it('supports move, edit, comment, withdraw, and Agent assistance actions', async () => {
    const moveTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 6 } }))
    const editTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 7 } }))
    const withdrawTask = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, taskId, eventSeq: 8 } }))
    const addNote = vi.fn(() => Promise.resolve({ ok: true as const, value: { roundId, noteId: 'NOTE-01' as never, eventSeq: 9 } }))
    const openView = vi.fn()
    render(<RequirementsView {...props({ moveTask, editTask, withdrawTask, addNote, openView })} />)

    let cell = selectTask()
    fireEvent.click(within(cell).getByRole('button', { name: '选择下一个任务' }))
    expect(moveTask).toHaveBeenCalledWith({ roundId, taskId, direction: 'down' })
    await waitFor(() => { expect(within(cell).getByRole('button', { name: '选择下一个任务' }).hasAttribute('disabled')).toBe(false) })
    cell = selectTask('验证 Notebook')
    fireEvent.click(within(cell).getByRole('button', { name: '选择上一个任务' }))
    expect(moveTask).toHaveBeenCalledWith({ roundId, taskId: secondTaskId, direction: 'up' })
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
      tasks: [
        { id: 'PENDING' as never, order: 0, title: '等待任务', statement: 'pending', status: 'pending' },
        { id: 'ACTIVE' as never, order: 1, title: '运行任务', statement: 'active', status: 'in_progress' },
        { id: 'TURN' as never, order: 2, title: '轮次任务', statement: 'turn', status: 'in_progress' },
        { id: 'FAILED' as never, order: 3, title: '失败任务', statement: 'failed', status: 'failed' },
        { id: 'DONE' as never, order: 4, title: '完成任务', statement: 'done', status: 'completed' },
        { id: 'GONE' as never, order: 5, title: '撤回任务', statement: 'withdrawn', status: 'withdrawn' },
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
        { id: taskId, order: 0, title: '回归任务', statement: 'regression', status: 'completed' },
        { id: secondTaskId, order: 1, title: '失败任务', statement: 'failure', status: 'failed' },
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

  it('shows review sources, files, gaps, history, and a requirement-code relation graph on demand', () => {
    render(<RequirementsView {...props({}, reviewSnapshot())} />)
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

    fireEvent.click(screen.getByRole('button', { name: '命令' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看需求与代码关系' }))
    expect(screen.getByRole('complementary', { name: 'Notebook 详情' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '需求与代码关系图' })).toBeTruthy()
    expect(screen.getByText('R1')).toBeTruthy()
  })
})
