import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/requirement-append', import.meta.url))
const mode = webSnapshotMode()
const addedInput = '请在已有欢迎文案需求中增加一条验收标准：文案旁显示可复制按钮，点击后复制文案。'

describe('requirement append', () => {
  it('revises the current requirement document in the same Session', async () => {
    const scaffold = await launchWebScaffold(mode === 'record' ? {} : {
      replayFixture: join(directory, 'session.jsonl'),
      compareReplaySession: false,
    })
    try {
      if (mode === 'record') await mkdir(directory, { recursive: true })
      else await assertFixtureInventory(directory, ['revision.expected.md', 'session.jsonl'])
      const response = await scaffold.hostFetch('/api/session/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'requirement-append-create', method: 'session/create',
          payload: { args: { request: { cwd: scaffold.workspaceCwd } } } }),
      })
      const created = await response.json() as { result: { ok: boolean; value: { sessionId: string } } }
      expect(created.result.ok).toBe(true)
      const agent = scaffold.ctx.agents.get(SessionId(created.result.value.sessionId))
      if (agent === undefined) throw new Error('parent Agent was not created')
      const session = agent.session
      const roundId = 'ROUND-01' as never
      session.append('requirement/round', {
        version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'append-original' as never,
        language: 'zh', input: '交付一条欢迎文案。', status: 'tasks-ready',
      })
      session.append('requirement/document', {
        version: 1, revision: 1, roundId, turn: 1, summary: '交付欢迎文案', valid: true, issues: [],
        markdown: '# 需求文档\n\n## 简介\n\n交付欢迎文案。\n\n## 需求\n\n### 需求 1：欢迎文案\n\n**用户故事：** 作为用户，我希望看到欢迎文案，以便确认页面已打开。\n\n#### 验收标准\n\n1. 页面打开时显示“欢迎体验”。',
      })
      const settled = scaffold.whenTurnSettled()
      const appended = scaffold.ctx.sessionRequirements.appendRequirement(agent, { input: addedInput, language: 'zh' })
      expect(appended.roundId).toBe(roundId)
      await settled
      const documents = session.events.filter((event): event is SessionEvent<'requirement/document'> =>
        event.type === 'requirement/document' && event.data.roundId === roundId)
      expect(documents.map(event => event.data.revision)).toEqual([1, 2])
      expect(documents[0]?.data.markdown).toContain('欢迎体验')
      expect(documents[1]?.data.markdown).toContain('复制')
      expect(session.events.some(event => event.type === 'user/message'
        && event.data.content.some(block => block.type === 'text' && block.text.includes(addedInput)))).toBe(true)
      if (mode !== 'record') {
        await compareOrRefreshGolden(join(directory, 'revision.expected.md'), JSON.stringify({
          rounds: session.events.flatMap(event => event.type === 'requirement/round'
            ? [{ revision: event.data.revision, status: event.data.status, input: event.data.input }] : []),
          documents: documents.map(event => ({ revision: event.data.revision, markdown: event.data.markdown })),
        }, null, 2), mode)
      }
      if (mode === 'record') await recordFixture(scaffold, agent.id, join(directory, 'session.jsonl'))
    } finally { await scaffold.close() }
  }, 300_000)
})
