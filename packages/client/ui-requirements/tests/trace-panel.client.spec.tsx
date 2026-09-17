// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

it('uses compact sphere labels and keeps selection separate from disclosure', () => {
  setup()
  const document = screen.getByRole('button', { name: '查看第 1 轮文档：饮料编年史' })
  expect(within(document).getByText('D1')).toBeTruthy()
  expect(within(document).getByText('饮料编年史')).toBeTruthy()
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
  expect(within(screen.getByRole('button', { name: '查看任务：实现交互' })).getByText('T1')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /查看代码修改/ })).toBeNull()
  expect(screen.getByRole('region', { name: '图谱节点详情' }).textContent).toContain('品类筛选')
})

it('truncates long node summaries while retaining the full accessible title', () => {
  const graph = fixture()
  const title = '这是一个非常冗长的需求文档标题'
  setup({ ...graph, documents: [{ ...graph.documents[0]!, title }] })
  const document = screen.getByRole('button', { name: `查看第 1 轮文档：${title}` })
  expect(within(document).getByText('这是一个非常冗长的需…')).toBeTruthy()
  expect(document.textContent).toBe('D1这是一个非常冗长的需…')
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
  fireEvent.click(screen.getByRole('button', { name: '收起全部' }))
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
  fireEvent.click(screen.getByRole('button', { name: '定位 Notebook 文档' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: [] })
  expand('饮料编年史')
  fireEvent.click(screen.getByRole('button', { name: /需求 1：品类筛选/ }))
  fireEvent.click(screen.getByRole('button', { name: '定位 Notebook 需求' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: [], requirementTitle: '品类筛选' })
  expand('品类筛选')
  fireEvent.click(screen.getByRole('button', { name: '查看任务：实现交互' }))
  fireEvent.click(screen.getByRole('button', { name: '定位 Notebook 任务' }))
  expect(props.onSelect).toHaveBeenLastCalledWith({ roundId, taskIds: ['t1'] })
  expand('实现交互')
  fireEvent.click(screen.getByRole('button', { name: '查看代码修改：src/page.html' }))
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '打开文件' }))
  expect(props.onOpenFile).toHaveBeenCalledWith('src/page.html')
  props.onOpenFile.mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '打开文件' }))
  expect(screen.getByRole('alert')).toBeTruthy()
})

it('filters rounds and searches across the filter without inventing assignments for orphan Tasks', () => {
  const graph = fixture()
  const second = { ...graph.documents[0]!, key: 'd2', roundId: 'round2' as never, round: 2, title: '第二轮' }
  const task = { ...graph.tasks[0]!, key: 'orphan', roundId: second.roundId, task: { ...graph.tasks[0]!.task, id: 'orphan' as never, title: '独立任务' } }
  setup({ ...graph, documents: [...graph.documents, second], tasks: [...graph.tasks, task] })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'round2' } })
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
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'round2' } })
  fireEvent.click(screen.getByRole('button', { name: '收起 第二轮' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect(screen.getByRole('button', { name: '查看任务：实现交互' })).toBeTruthy()
})
