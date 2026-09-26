// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RequirementGraphPanel } from '../src/client/RequirementGraphPanel.tsx'
import type { SessionRequirementGraph } from '../src/client/knowledge-graph.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => { HTMLElement.prototype.scrollTo = vi.fn() })
const t = makeTranslate(zh, commonZh)
const roundId = 'round' as never

function fixture(): SessionRequirementGraph {
  return {
    sessionId: 'session' as never, title: '本次对话',
    documents: [{ key: 'd1', roundId, round: 1, title: '饮料编年史', revision: 1, markdown: '包含品类筛选与搜索' }],
    requirements: ['品类筛选', '关键词搜索'].map((title, index) => ({ key: `r${index + 1}`, roundId, round: 1, requirementId: String(index + 1), title, acceptanceRefs: [`${index + 1}.1`], status: 'in-progress', taskIds: ['t1' as never] })),
    tasks: [{ key: 't1', roundId, task: { id: 't1' as never, title: '实现交互', summary: '可访问筛选', statement: '使用事件委托', kind: 'implementation', order: 0, status: 'completed', requirementRefs: ['1.1', '2.1'] } }],
    files: [{ key: 'f1', path: 'src/page.html', changes: [{ seq: 5, turn: 2, path: 'src/page.html', oldText: null, newText: '<script>unsafe()</script>', taskKey: 't1' }] }],
    edges: [{ source: 'd1', target: 'r1' }, { source: 'd1', target: 'r2' }, { source: 'r1', target: 't1' }, { source: 'r2', target: 't1' }, { source: 't1', target: 'f1' }],
  }
}

function setup(graph = fixture()) {
  const props = { graph, onSelect: vi.fn(), onOpenFile: vi.fn(() => true), t }
  return { ...render(<RequirementGraphPanel {...props} />), props }
}

function expand(title: string): void { fireEvent.click(screen.getByRole('button', { name: `展开 ${title}` })) }
function search(query: string): void { fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } }) }

it('expands every layer in the selected round, including unassigned tasks', () => {
  const graph = fixture()
  const second = { ...graph.documents[0]!, key: 'd2', roundId: 'round2' as never, round: 2, title: '第二轮' }
  const orphan = { ...graph.tasks[0]!, key: 'orphan', task: { ...graph.tasks[0]!.task, title: '独立任务' } }
  setup({ ...graph, documents: [...graph.documents, second], tasks: [...graph.tasks, orphan] })
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: roundId } })
  fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '查看任务：独立任务' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /查看第 2 轮文档/ })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
  expect(screen.getByRole('button', { name: /查看第 2 轮文档/ })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: '查看任务：实现交互' })).toHaveLength(1)
})

it('starts with the latest requirement document selected and splits graph and document evenly', () => {
  const graph = fixture()
  const latest = { ...graph.documents[0]!, key: 'd2', roundId: 'round2' as never, round: 2, title: '第二轮', markdown: '# 需求文档\n\n最新需求正文：**支持手写**。\n\n- 离线打开\n- 保存笔迹' }
  setup({ ...graph, documents: [...graph.documents, latest] })

  expect(screen.getByRole('button', { name: '查看第 2 轮文档：第二轮' }).getAttribute('aria-pressed')).toBe('true')
  const detail = screen.getByRole('region', { name: '图谱节点详情' })
  expect(detail.textContent).toContain('最新需求正文')
  expect(within(detail).getByRole('heading', { name: '需求文档', level: 1 })).toBeTruthy()
  expect(within(detail).getByText('支持手写').tagName).toBe('STRONG')
  expect(within(detail).getAllByRole('listitem')).toHaveLength(2)
  expect(detail.textContent).not.toContain('# 需求文档')
  expect(detail.textContent).not.toContain('包含品类筛选与搜索')
  expect(screen.getByRole('separator', { name: '调整图谱详情高度' }).getAttribute('aria-valuenow')).toBe('50')
})

it('keeps planes fixed and wraps dense nodes in ascending row-major order', () => {
  const graph = fixture()
  const { container, props, rerender } = setup(graph)
  const geometry = () => [...container.querySelectorAll('g[data-layer] > path:first-child')].map(path => path.getAttribute('d'))
  const initial = geometry()
  expect(initial).toHaveLength(4)
  const canvas = container.querySelector('[data-has-selection] > svg')!.parentElement!
  const transform = canvas.style.transform
  expand('饮料编年史'); expand('品类筛选'); expand('实现交互')
  expect(geometry()).toEqual(initial)
  fireEvent.click(screen.getByRole('button', { name: '查看代码修改：src/page.html' }))
  expect(screen.queryByRole('button', { name: '内容' })).toBeNull()
  expect(geometry()).toEqual(initial)
  expect(canvas.style.transform).toBe(transform)
  const tasks = Array.from({ length: 15 }, (_, index) => ({ ...graph.tasks[0]!, key: `dense${index}` }))
  rerender(<RequirementGraphPanel {...props} graph={{ ...graph, tasks: [...graph.tasks, ...tasks],
    edges: [...graph.edges, ...tasks.map(task => ({ source: 'r1', target: task.key }))] }} />)
  expect(geometry()).toEqual(initial)
  expect(Number.parseFloat(canvas.style.width)).toBe(588)
  const taskNodes = [...container.querySelectorAll<HTMLElement>('article[data-layer="task"]')]
  expect(taskNodes).toHaveLength(16)
  expect(taskNodes.every(node => node.style.width === '92px' && node.style.height === '72px')).toBe(true)
  expect(new Set(taskNodes.map(node => node.style.top)).size).toBe(2)
  const nodeScale = .65
  for (const [index, node] of taskNodes.entries()) {
    expect(Number(node.style.scale)).toBe(nodeScale)
    if (index % 8 !== 0) expect(Number.parseFloat(node.style.left)).toBeGreaterThan(Number.parseFloat(taskNodes[index - 1]!.style.left))
    if (index >= 8) expect(Number.parseFloat(node.style.top)).toBeGreaterThan(Number.parseFloat(taskNodes[index - 8]!.style.top))
    const x = Number.parseFloat(node.style.left) + 46 * nodeScale
    const y = Number.parseFloat(node.style.top) + 26 * nodeScale - (6 + 2 * 116)
    expect(y).toBeGreaterThanOrEqual(24)
    expect(y).toBeLessThanOrEqual(92)
    expect(x).toBeGreaterThan(112 - y + 15)
    expect(x).toBeLessThan(580 - y - 15)
  }
  expect(taskNodes.map(node => node.querySelector('button')!.textContent)).toEqual(Array.from({ length: 16 }, (_, index) => String(index + 1)))
  expect(canvas.style.transform).toBe(transform)
  fireEvent.click(screen.getByRole('button', { name: '收起 饮料编年史' }))
  expect(geometry()).toEqual(initial)
})

it('scales with sidebar width but not inspector height', () => {
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  try {
    const { container } = setup()
    const canvas = container.querySelector('[data-has-selection] > svg')!.parentElement!
    const viewport = canvas.parentElement!.parentElement!
    let width = 588
    let height = 472
    Object.defineProperties(viewport, {
      clientWidth: { get: () => width }, clientHeight: { get: () => height },
    })
    act(() => { resize() })
    expect(canvas.style.transform).toBe('scale(1)')
    width = 882
    act(() => { resize() })
    expect(canvas.style.transform).toBe('scale(1.5)')
    height = 200
    act(() => { resize() })
    expect(canvas.style.transform).toBe('scale(1.5)')
    width = 294
    act(() => { resize() })
    expect(canvas.style.transform).toBe('scale(0.5)')
  } finally {
    cleanup()
    vi.unstubAllGlobals()
  }
})

it('toggles layered and radial layouts without losing the current graph exploration state', () => {
  const { container } = setup()
  const layoutToggle = screen.getByRole('button', { name: '切换图谱布局' })
  expect(layoutToggle.getAttribute('aria-pressed')).toBe('false')
  expect(layoutToggle.title).toBe('当前：分层 · 曲线；点击切换至径向 · 同心环')
  expect(screen.queryByRole('combobox', { name: '切换图谱布局' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: roundId } })
  fireEvent.click(screen.getByRole('button', { name: '全部展开' }))
  const codeNode = screen.getByRole('button', { name: '查看代码修改：src/page.html' })
  fireEvent.click(codeNode)
  search('page')
  fireEvent.keyDown(screen.getByRole('separator', { name: '调整图谱详情高度' }), { key: 'ArrowUp' })
  fireEvent.click(screen.getByRole('button', { name: '放大图谱' }))
  const layeredTransform = container.querySelector<HTMLElement>('[data-has-selection][data-layout-mode="layered"]')?.style.transform
  const nodeKeys = () => [...container.querySelectorAll<HTMLElement>('[data-node-key]')].map(node => node.dataset.nodeKey)
  const expectedKeys = nodeKeys()
  const paths = new Set<string>()
  const variants = { radial: 'ring', layered: 'plane' } as const
  for (const [mode, variant] of Object.entries(variants)) {
    fireEvent.click(layoutToggle)
    expect(layoutToggle.getAttribute('aria-pressed')).toBe(String(mode === 'radial'))
    const canvas = container.querySelector<HTMLElement>(`[data-has-selection][data-layout-mode="${mode}"]`)
    expect(canvas).toBeTruthy()
    expect(container.querySelectorAll(`g[data-region-variant="${variant}"]`)).toHaveLength(4)
    expect(nodeKeys()).toEqual(expectedKeys)
    expect(container.querySelectorAll('svg path[marker-end]')).toHaveLength(5)
    paths.add(container.querySelector('svg path[marker-end]')?.getAttribute('d') ?? '')
    expect(codeNode.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('src/page.html')
    const searchInput = screen.getByRole('searchbox') as unknown as { readonly value: string }
    const roundSelect = screen.getByRole('combobox', { name: '按轮次筛选' }) as unknown as { readonly value: string }
    expect(searchInput.value).toBe('page')
    expect(roundSelect.value).toBe(roundId)
    expect(screen.getByRole('separator', { name: '调整图谱详情高度' }).getAttribute('aria-valuenow')).toBe('55')
  }
  expect(paths.size).toBe(2)
  expect(container.querySelector<HTMLElement>('[data-has-selection][data-layout-mode="layered"]')?.style.transform).toBe(layeredTransform)
})

it('uses numbered Figma spheres and keeps selection separate from disclosure', () => {
  setup()
  const document = screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' })
  expect(document.textContent).toBe('1')
  expect(document.title).toBe('饮料编年史')
  fireEvent.click(document)
  expect(screen.queryByRole('button', { name: /第 1 轮，需求/ })).toBeNull()
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('版本 1')
  expand('饮料编年史')
  expect(screen.getAllByRole('button', { name: /第 1 轮，需求/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull()
  const requirement = screen.getByRole('button', { name: /需求 1：品类筛选/ })
  expect(within(requirement).queryByText('待终验')).toBeNull()
  fireEvent.click(requirement)
  expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull()
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('待终验')
  expand('品类筛选')
  expect(screen.getByRole('button', { name: '查看任务：实现交互' }).textContent).toBe('1')
  expect(screen.queryByRole('button', { name: /查看代码修改/ })).toBeNull()
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('品类筛选')
})

it('keeps long titles in tooltips and details instead of crowding the graph', () => {
  const graph = fixture()
  const title = '这是一个非常冗长的需求文档标题'
  setup({ ...graph, documents: [{ ...graph.documents[0]!, title }] })
  const document = screen.getByRole('button', { name: `查看第 1 轮文档：${title}` })
  expect(document.title).toBe(title)
  expect(document.textContent).toBe('1')
  fireEvent.click(document)
  expect(within(screen.getByRole('region', { name: '图谱节点详情' })).getByText(title)).toBeTruthy()
})

it('starts with document roots and expands only one layer per arrow', () => {
  setup()
  expect(screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /第 1 轮，需求/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull()
  expand('饮料编年史')
  expect(screen.getAllByRole('button', { name: /第 1 轮，需求/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull()
  expand('品类筛选')
  expect(screen.getByRole('button', { name: '查看任务：实现交互' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /查看代码修改/ })).toBeNull()
  expand('实现交互')
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起 饮料编年史' }))
  expect(screen.queryByRole('button', { name: /第 1 轮，需求/ })).toBeNull()
})

it('retains one shared Task and its file until the last expanded parent closes', () => {
  setup()
  expand('饮料编年史'); expand('品类筛选'); expand('关键词搜索'); expand('实现交互')
  expect(screen.getAllByRole('button', { name: '查看任务：实现交互' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '收起 品类筛选' }))
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起 关键词搜索' }))
  expect(screen.queryByRole('button', { name: /查看任务/ })).toBeNull()
  expand('品类筛选')
  expect(screen.queryByRole('button', { name: /查看代码修改/ })).toBeNull()
})

it('searches hidden files and reveals every parent path without losing expansion when search clears', () => {
  setup()
  search('src/page')
  fireEvent.click(within(screen.getByRole('region', { name: '图谱搜索结果' })).getByRole('button', { name: /src\/page.html/ }))
  expect(screen.getByRole('button', { name: '收起 品类筛选' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '收起 关键词搜索' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  search('不存在的文件')
  expect(screen.getByRole('status').textContent).toContain('0 个节点')
})

it('keeps live additions collapsed and shows final-review status without claiming verification', () => {
  const graph = fixture()
  const { props, rerender } = setup({ ...graph, files: [], edges: graph.edges.filter(edge => edge.target !== 'f1') })
  expand('饮料编年史'); expand('品类筛选')
  fireEvent.click(screen.getByRole('button', { name: /需求 1：品类筛选/ }))
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('待终验')
  rerender(<RequirementGraphPanel {...props} graph={graph} />)
  expect(screen.queryByRole('button', { name: /查看代码修改/ })).toBeNull()
  expand('实现交互')
  expect(screen.getByRole('button', { name: '查看代码修改：src/page.html' })).toBeTruthy()
  expect(screen.queryByText('已验证')).toBeNull()
  rerender(<RequirementGraphPanel {...props} graph={{ ...graph, requirements: graph.requirements.map(node => ({ ...node, status: 'verified' })) }} />)
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('已验证')
})

it('opens recorded snippets safely and navigates documents, requirements, Tasks, and files', () => {
  const { props, container } = setup()
  fireEvent.click(screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' }))
  fireEvent.click(screen.getByRole('button', { name: '定位需求工作区' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: [] })
  expand('饮料编年史')
  fireEvent.click(screen.getByRole('button', { name: /需求 1：品类筛选/ }))
  fireEvent.click(screen.getByRole('button', { name: '定位需求工作区' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: [], requirementTitle: '品类筛选' })
  expand('品类筛选')
  fireEvent.click(screen.getByRole('button', { name: '查看任务：实现交互' }))
  fireEvent.click(screen.getByRole('button', { name: '定位需求工作区' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: ['t1'] })
  expand('实现交互')
  fireEvent.click(screen.getByRole('button', { name: '查看代码修改：src/page.html' }))
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '打开文件' }))
  expect(props.onOpenFile).toHaveBeenCalledWith('src/page.html')
  props.onOpenFile.mockReturnValue(false)
  fireEvent.click(screen.getByRole('link', { name: '打开文件' }))
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '定位需求工作区' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: ['t1'] })
})

it('keeps content visible and offers only the compact Notebook action', () => {
  setup()
  expect(screen.queryByText(/点击节点查看详情/)).toBeNull()
  expect(screen.queryByRole('button', { name: '适应画面' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' }))
  const detail = screen.getByRole('region', { name: '图谱节点详情' })
  expect(within(detail).getAllByRole('button').map(button => button.textContent)).toEqual(['定位需求工作区'])
  expect(within(detail).getByText('包含品类筛选与搜索')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '内容' })).toBeNull()
})

it('resizes the reserved detail area with bounded keyboard controls without changing planes', () => {
  const { container } = setup()
  const divider = screen.getByRole('separator', { name: '调整图谱详情高度' })
  const geometry = [...container.querySelectorAll('g[data-layer] > path:first-child')].map(node => node.getAttribute('d'))
  expect(divider.getAttribute('aria-valuenow')).toBe('50')
  fireEvent.keyDown(divider, { key: 'ArrowUp' })
  expect(divider.getAttribute('aria-valuenow')).toBe('55')
  fireEvent.keyDown(divider, { key: 'End' })
  fireEvent.keyDown(divider, { key: 'ArrowUp' })
  expect(divider.getAttribute('aria-valuenow')).toBe('60')
  fireEvent.keyDown(divider, { key: 'Home' })
  fireEvent.keyDown(divider, { key: 'ArrowDown' })
  expect(divider.getAttribute('aria-valuenow')).toBe('15')
  expect([...container.querySelectorAll('g[data-layer] > path:first-child')].map(node => node.getAttribute('d'))).toEqual(geometry)
})

it('shows only the selected requirement section, excluding sibling requirements', () => {
  const graph = fixture()
  setup({ ...graph, documents: [{ ...graph.documents[0]!, markdown: '### 需求 1：品类筛选\n\n**用户故事：** 快速找到饮料。\n\n#### 验收标准\n\n1. 支持筛选。\n\n### 需求 2：关键词搜索\n\n仅属于搜索的正文。' }] })
  expand('饮料编年史')
  fireEvent.click(screen.getByRole('button', { name: /需求 1：品类筛选/ }))
  const detail = screen.getByRole('region', { name: '图谱节点详情' })
  expect(detail.textContent).toContain('快速找到饮料')
  expect(within(detail).getByText('用户故事：').tagName).toBe('STRONG')
  expect(detail.textContent).not.toContain('**')
  expect(detail.textContent).toContain('支持筛选')
  expect(detail.textContent).not.toContain('仅属于搜索的正文')
})

it('filters rounds and searches across the filter without inventing assignments for orphan Tasks', () => {
  const graph = fixture()
  const second = { ...graph.documents[0]!, key: 'd2', roundId: 'round2' as never, round: 2, title: '第二轮' }
  const task = { ...graph.tasks[0]!, key: 'orphan', roundId: second.roundId, task: { ...graph.tasks[0]!.task, id: 'orphan' as never, title: '独立任务' } }
  setup({ ...graph, documents: [...graph.documents, second], tasks: [...graph.tasks, task] })
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: 'round2' } })
  expect(screen.queryByRole('button', { name: '查看第 1 轮文档：饮料编年史' })).toBeNull()
  search('独立任务')
  fireEvent.click(within(screen.getByRole('region', { name: '图谱搜索结果' })).getByRole('button'))
  expect(screen.getByRole('button', { name: '查看任务：独立任务' })).toBeTruthy()
  expect(screen.getByText('此任务尚无已记录的需求关联。')).toBeTruthy()
  expect(screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' })).toBeTruthy()
})

it('preserves other rounds expansion when collapsing a filtered branch', () => {
  const graph = fixture()
  const document = { ...graph.documents[0]!, key: 'd2', roundId: 'round2' as never, round: 2, title: '第二轮' }
  const requirement = { ...graph.requirements[0]!, key: 'r3', roundId: document.roundId, round: 2 }
  setup({ ...graph, documents: [...graph.documents, document], requirements: [...graph.requirements, requirement], edges: [...graph.edges, { source: 'd2', target: 'r3' }] })
  expand('饮料编年史'); expand('品类筛选'); expand('第二轮')
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: 'round2' } })
  fireEvent.click(screen.getByRole('button', { name: '收起 第二轮' }))
  fireEvent.change(screen.getByRole('combobox', { name: '按轮次筛选' }), { target: { value: '' } })
  expect(screen.getByRole('button', { name: '查看任务：实现交互' })).toBeTruthy()
})
