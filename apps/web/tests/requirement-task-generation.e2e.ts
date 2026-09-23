import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/requirement-task-generation', import.meta.url))
const mode = webSnapshotMode()

describe('requirement task generation', () => {
  it('translates implementation Tasks concurrently and commits them without a Final Test', async () => {
    const childFixtures = mode === 'record' ? [] : [join(directory, 'session.1.jsonl')]
    const scaffold = await launchWebScaffold(mode === 'record' ? {} : {
      replayFixture: join(directory, 'session.jsonl'), replayChildFixtures: childFixtures,
      compareReplaySession: false,
    })
    const start = scaffold.ctx.subagents.start.bind(scaffold.ctx.subagents)
    let started = 0
    let active = 0
    let peakActive = 0
    const childResults: string[] = []
    const spy = vi.spyOn(scaffold.ctx.subagents, 'start').mockImplementation(async (provider, request) => {
      const index = ++started
      const run = await start(provider, request)
      active++
      peakActive = Math.max(peakActive, active)
      return { ...run, result: run.result.then((result) => {
        childResults[index - 1] = `${result.stopReason}: ${JSON.stringify(result.structured ?? result.diagnostic ?? '')}`
        return result
      }), dispose: async () => {
        try {
          if (mode === 'record') await recordFixture(scaffold, run.id,
            join(directory, index === 1 ? 'session.jsonl' : `session.${index - 1}.jsonl`))
        } finally {
          try { await run.dispose() } finally { active-- }
        }
      } }
    })
    try {
      if (mode === 'record') await mkdir(directory, { recursive: true })
      const response = await scaffold.hostFetch('/api/session/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'task-generation-create', method: 'session/create',
          payload: { args: { request: { cwd: scaffold.workspaceCwd } } } }),
      })
      const created = await response.json() as { result: { ok: boolean; value: { sessionId: string } } }
      expect(created.result.ok).toBe(true)
      const agent = scaffold.ctx.agents.get(SessionId(created.result.value.sessionId))
      if (agent === undefined) throw new Error('parent Agent was not created')
      const session = agent.session
      const roundId = 'ROUND-01' as never
      session.append('requirement/round', {
        version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'generation-source' as never,
        language: 'zh', input: '先交付可见页面，再交付表单行为；每一步完成对应验证。', status: 'generating-tasks',
      })
      session.append('requirement/document', {
        version: 1, revision: 1, roundId, turn: 1, summary: '交付页面和表单', valid: true, issues: [],
        markdown: '# 需求文档\n\n## 简介\n\n先交付静态页面，再交付表单交互。\n\n## 需求\n\n### 需求 1：页面\n\n**用户故事：** 作为用户，我希望看到标题和表单，以便开始输入。\n\n#### 验收标准\n\n1. 当页面打开时，系统应显示中文标题和文本输入框。\n\n### 需求 2：表单交互\n\n**用户故事：** 作为用户，我希望提交输入，以便看到结果。\n\n#### 验收标准\n\n1. 当用户提交非空文字时，系统应在页面显示提交内容。',
      })
      const submission = await scaffold.ctx.tools.execute({
        callId: ToolCallId('task-generation-submit'), name: 'submit_requirement_tasks', agent,
        signal: new AbortController().signal,
        arguments: {
          tasks: [
            { kind: 'implementation', title: '搭建页面', markdown: '- [ ] 1.1 创建并验证网页标题和输入框', requirement_refs: ['1.1'] },
            { kind: 'implementation', title: '实现表单', markdown: '- [ ] 2.1 提交非空输入并验证显示内容', requirement_refs: ['2.1'] },
          ],
        },
      })
      expect(submission.isError, `${JSON.stringify(submission.content)}; ${childResults.join(' | ')}`).toBe(false)
      const list = session.events.findLast(event => event.type === 'requirement/task-list')
      if (list?.type !== 'requirement/task-list') throw new Error('task list was not committed')
      expect(list.data.tasks).toHaveLength(2)
      expect(list.data.tasks.map(task => task.kind)).toEqual(['implementation', 'implementation'])
      expect(list.data.tasks.map(task => task.order)).toEqual(list.data.tasks.map((_, index) => index))
      expect(list.data.tasks.every(task => task.statement.includes('- [ ]') && task.summary.length > 0)).toBe(true)
      expect(started).toBeGreaterThanOrEqual(list.data.tasks.length)
      expect(peakActive).toBeGreaterThan(1)
      expect(active).toBe(0)
    } finally { spy.mockRestore(); await scaffold.close() }
  }, 300_000)
})
