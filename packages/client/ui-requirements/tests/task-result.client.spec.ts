import { describe, expect, it } from 'vitest'
import { taskResult } from '../src/client/task-result.ts'

describe('Notebook task result sections', () => {
  it('preserves delivery links and notes while omitting progress and verification sections', () => {
    expect(taskResult('正在检索。\n\n## 交付文件\n\n- [页面](./result.html) — 可离线打开。\n\n## 可验证结果\n\n70 条，全部通过。\n\n## 说明\n\n只完成数据层。\n\n## 执行日志\n\npnpm test')).toEqual({
      deliverables: '- [页面](./result.html) — 可离线打开。', notes: '只完成数据层。',
    })
  })

  it('recognizes emphasized and Setext headings and preserves reference links', () => {
    const result = taskResult('**Deliverables**\n---\n\n[Report][report]\n\n## Notes\n\nPending review.\n\n[report]: https://example.com/report')
    expect(result.deliverables).toContain('[Report][report]')
    expect(result.deliverables).toContain('[report]: https://example.com/report')
    expect(result.notes).toContain('Pending review.')
  })

  it('does not treat headings inside code fences as result sections', () => {
    expect(taskResult('```md\n## 交付结果\n伪造产物\n```\n\n## 说明\n未交付。')).toEqual({ deliverables: '', notes: '未交付。' })
  })

  it('does not relabel unstructured execution logs as deliverables', () => {
    expect(taskResult('运行命令中……')).toEqual({ deliverables: '', notes: '' })
  })
})
