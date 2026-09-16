// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RequirementGraphPanel } from '../src/client/RequirementGraphPanel.tsx'
import type { SessionRequirementGraph } from '../src/client/knowledge-graph.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('resizes the panel with the keyboard and bounds its width to the workspace', () => {
  const graph: SessionRequirementGraph = { sessionId: 'session' as never, title: '', requirements: [], tasks: [], files: [], edges: [] }
  render(<RequirementGraphPanel graph={graph} onClose={vi.fn()} onSelect={vi.fn()} t={makeTranslate(zh, commonZh)} />)
  const panel = screen.getByRole('complementary')
  vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect)
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ width: Number.parseFloat(panel.style.width) || 660 }) as DOMRect)
  const handle = screen.getByRole('separator', { name: '调整需求图谱宽度' })
  fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(panel.style.width).toBe('692px')
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(panel.style.width).toBe('660px')
  for (let i = 0; i < 30; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' })
  expect(panel.style.width).toBe('900px')
})

it('focuses shared-file ancestors and opens recorded snippets without rendering them as HTML', () => {
  const graph: SessionRequirementGraph = {
    sessionId: 'session' as never, title: '本次对话',
    requirements: [{ key: 'r1', roundId: 'round' as never, round: 1, requirementId: '1', title: '导航', acceptanceRefs: ['1.1'], status: 'in-progress', taskIds: ['t1' as never] }],
    tasks: [{ key: 't1', roundId: 'round' as never, task: { id: 't1' as never, title: '实现导航', summary: '可访问导航', statement: '', kind: 'implementation', order: 0, status: 'completed', requirementRefs: ['1.1'] } }],
    files: [{ key: 'f1', path: 'src/nav.tsx', changes: [{ seq: 5, turn: 2, path: 'src/nav.tsx', oldText: null, newText: '<script>unsafe()</script>', taskKey: 't1' }] }],
    edges: [{ source: 'r1', target: 't1' }, { source: 't1', target: 'f1' }],
  }
  const select = vi.fn()
  const { container } = render(<RequirementGraphPanel graph={graph} onClose={vi.fn()} onSelect={select} t={makeTranslate(zh, commonZh)} />)
  expect(screen.getByText('已完成')).toBeTruthy()
  expect(screen.queryByText('已验证')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看代码修改：src/nav.tsx' }))
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看任务：实现导航' }))
  fireEvent.click(screen.getByRole('button', { name: '定位 Notebook 任务' }))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ taskIds: ['t1'] }))
  fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
  expect(screen.queryByText('<script>unsafe()</script>')).toBeNull()
})
