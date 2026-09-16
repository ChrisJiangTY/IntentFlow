import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { RequirementTask } from '@deepseek-ai/dsh-session-requirements'
import { launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/requirement-task-text', import.meta.url))
const mode = webSnapshotMode()

describe('requirement task translation and human-directed revision', () => {
  it('translates exact execution text, then rewrites it from human direction through the shipped composition', async () => {
    const scaffold = await launchWebScaffold(mode === 'record' ? {} : {
      replayFixture: join(directory, 'session.jsonl'),
      replayChildFixtures: [join(directory, 'session.1.jsonl')], compareReplaySession: false,
    })
    const start = scaffold.ctx.subagents.start.bind(scaffold.ctx.subagents)
    let child = 0
    const spy = vi.spyOn(scaffold.ctx.subagents, 'start').mockImplementation(async (provider, request) => {
      const run = await start(provider, request)
      const path = join(directory, child++ === 0 ? 'session.jsonl' : 'session.1.jsonl')
      return { ...run, dispose: async () => {
        try {
          if (mode === 'record') { await mkdir(directory, { recursive: true }); await recordFixture(scaffold, run.id, path) }
        } finally { await run.dispose() }
      } }
    })
    try {
      const response = await scaffold.hostFetch('/api/session/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'task-text-create', method: 'session/create', payload: { args: { request: { cwd: scaffold.workspaceCwd } } } }),
      })
      const created = await response.json() as { result: { ok: boolean; value: { sessionId: string } } }
      expect(created.result.ok).toBe(true)
      const agent = scaffold.ctx.agents.get(SessionId(created.result.value.sessionId))
      if (agent === undefined) throw new Error('parent Agent was not created')
      const session = agent.session
      const roundId = 'ROUND-01' as never
      const original: RequirementTask = {
        id: 'TASK-A' as never, order: 0, kind: 'implementation', title: '导出搜索结果', summary: '把搜索结果导出为表格。',
        statement: '**目标**：导出搜索结果。\n- [ ] 1.1 生成CSV文件，保留标题行，验证文件可打开。\n\n_关联需求：1.1_', requirementRefs: ['1.1'], status: 'pending',
      }
      session.append('requirement/round', { version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'task-source' as never, language: 'zh', input: '导出搜索结果。', status: 'tasks-ready' })
      session.append('requirement/document', { version: 1, revision: 1, roundId, turn: 1, summary: '导出搜索结果', valid: true, issues: [],
        markdown: '# 需求文档\n\n## 简介\n\n导出结果。\n\n## 需求\n\n### 需求 1：导出\n\n**用户故事：** 作为用户，我希望导出结果，以便查看。\n\n#### 验收标准\n\n1. 当用户导出时，系统应生成CSV文件。' })
      session.append('requirement/task-list', { version: 1, revision: 1, roundId, documentRevision: 1, tasks: [original,
        { ...original, id: 'TASK-FINAL' as never, order: 1, kind: 'final-test', title: '验证导出', statement: '- [ ] 2.1 验证导出结果\n\n_关联需求：1.1_' },
      ] })
      const translated = await scaffold.ctx.sessionRequirements.editTask(agent, { roundId, taskId: original.id,
        title: original.title, summary: original.summary, statement: original.statement, humanEdit: false })
      expect(translated.task?.statement).toBe(original.statement)
      expect(translated.task?.summary).toBeTruthy()
      const humanInstruction = '改为导出JSON，保留全部搜索结果；不要再生成CSV。'
      const rewritten = await scaffold.ctx.sessionRequirements.editTask(agent, { roundId, taskId: original.id,
        title: translated.task!.title, summary: humanInstruction, statement: translated.task!.statement, humanEdit: true })
      expect(rewritten.task?.summary).toBe(humanInstruction)
      expect(rewritten.task?.humanInstruction).toBe(humanInstruction)
      expect(rewritten.task?.statement).toMatch(/JSON/iu)
      expect(rewritten.task?.statement).not.toBe(original.statement)
      expect(rewritten.task?.status).toBe('pending')
      expect(child).toBe(2)
    } finally { spy.mockRestore(); await scaffold.close() }
  }, 180_000)
})
