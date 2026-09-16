import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/requirement-task-result', import.meta.url))
const mode = webSnapshotMode()

describe('human-facing task delivery report', () => {
  it('runs failed implementation Tasks directly and performs one final comprehensive review', async () => {
    const scaffold = await launchWebScaffold(mode === 'record' ? {} : {
      replayFixture: join(directory, 'session.jsonl'),
      replayChildFixtures: [join(directory, 'session.3.jsonl')], compareReplaySession: false,
    })
    const start = scaffold.ctx.subagents.start.bind(scaffold.ctx.subagents)
    let childIndex = 0
    const spy = vi.spyOn(scaffold.ctx.subagents, 'start').mockImplementation(async (provider, request) => {
      const childFile = join(directory, `session.${++childIndex + 2}.jsonl`)
      const run = await start(provider, request)
      return { ...run, dispose: async () => {
        try {
          if (mode === 'record') await recordFixture(scaffold, run.id, childFile)
        } finally { await run.dispose() }
      } }
    })
    try {
      if (mode === 'record') await mkdir(directory, { recursive: true })
      const response = await scaffold.hostFetch('/api/session/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'task-result-create', method: 'session/create', payload: { args: { request: { cwd: scaffold.workspaceCwd } } } }),
      })
      const created = await response.json() as { result: { ok: boolean; value: { sessionId: string } } }
      expect(created.result.ok).toBe(true)
      const agent = scaffold.ctx.agents.get(SessionId(created.result.value.sessionId))
      if (agent === undefined) throw new Error('parent Agent was not created')
      const session = agent.session
      const roundId = 'ROUND-01' as never
      const taskId = 'TASK-A' as never
      session.append('requirement/round', { version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'result-source' as never,
        language: 'zh', input: '交付一句中文欢迎文案，不创建文件或界面。', status: 'tasks-ready' })
      session.append('requirement/document', { version: 1, revision: 1, roundId, turn: 1, summary: '交付欢迎文案', valid: true, issues: [],
        markdown: '# 需求文档\n\n## 简介\n\n交付文案。\n\n## 需求\n\n### 需求 1：欢迎文案\n\n**用户故事：** 作为用户，我希望获得欢迎文案。\n\n#### 验收标准\n\n1. 系统应交付“欢迎体验”，并说明仅交付文案、未实现界面。' })
      session.append('requirement/task-list', { version: 1, revision: 1, roundId, documentRevision: 1, tasks: [
        { id: taskId, order: 0, kind: 'implementation', title: '交付欢迎文案', summary: '获得一段欢迎文案。', status: 'failed', requirementRefs: ['1.1'],
          statement: '直接交付中文文案“欢迎体验”，说明仅交付文案、未实现界面。无需使用工具、创建文件或检查仓库。\n- [ ] 1.1 交付文案并说明范围。\n\n_关联需求：1.1_' },
        { id: 'TASK-FINAL' as never, order: 1, kind: 'final-test', title: '核对文案', summary: '核对交付文案。', status: 'failed', requirementRefs: ['1.1'], statement: '- [ ] 2.1 核对文案。\n\n_关联需求：1.1_' },
      ] })
      scaffold.ctx.sessionRequirements.runAll(agent, { roundId })
      await vi.waitFor(() => {
        expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({
          data: { status: expect.stringMatching(/^(?:completed|failed)$/u) as unknown },
        })
      }, { timeout: 240_000 })
      expect(session.events.findLast(event => event.type === 'requirement/run-all')).toMatchObject({ data: { status: 'completed' } })
      expect(session.events.findLast(event => event.type === 'requirement/validation')).toMatchObject({ data: { status: 'completed' } })
      const latest = session.events.findLast(event => event.type === 'requirement/task-execution' && event.data.taskId === taskId)
      const output = latest?.type === 'requirement/task-execution' ? latest.data.output : undefined
      expect(output).toContain('欢迎体验')
      expect(output?.match(/^## .+$/gmu)).toEqual(['## 交付结果', '## 说明'])
      expect(output).not.toContain('```')
      expect(spy).toHaveBeenCalledOnce()
      if (mode === 'record') await recordFixture(scaffold, agent.id, join(directory, 'session.jsonl'))
    } finally { spy.mockRestore(); await scaffold.close() }
  }, 300_000)
})
