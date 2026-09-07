import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import * as RequirementsInvariant from '../src/invariant.ts'
import type { RequirementTask } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const markdown = '# 需求文档\n\n## 简介\n\n页面。\n\n## 需求\n\n### 需求 1：页面\n\n**用户故事：** 用户查看页面。\n\n#### 验收标准\n\n1. 系统应当显示页面。'

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(RequirementsInvariant)
  const session = ctx.sessions.create(SessionId('task-draft-invariant'))
  const roundId = 'ROUND-01' as never
  session.append('requirement/round', {
    version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'message-1' as never,
    language: 'zh', input: '创建页面。', status: 'tasks-ready',
  })
  session.append('requirement/document', {
    version: 1, revision: 1, roundId, turn: 1, summary: '创建页面', markdown, valid: true, issues: [],
  })
  return { session, roundId }
}

function task(
  id: string,
  order: number,
  status: RequirementTask['status'],
  title = '创建页面',
): RequirementTask {
  return {
    id: id as never,
    order,
    kind: 'implementation',
    title,
    statement: title === '' ? '' : '- [ ] 1.1 创建页面\n\n_关联需求：1.1_',
    requirementRefs: title === '' ? [] : ['1.1'],
    status,
  }
}

function finalTask(order: number): RequirementTask {
  return {
    id: 'FINAL' as never,
    order,
    kind: 'final-test',
    title: '最终测试',
    statement: '- [ ] 2.1 验证页面\n\n_关联需求：1.1_',
    requirementRefs: ['1.1'],
    status: 'pending',
  }
}

describe('requirement document pipeline invariant', () => {
  it('accepts drafts while requiring one last Final Test', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1,
      tasks: [task('A', 0, 'pending', ''), task('B', 1, 'withdrawn', ''), task('C', 2, 'reviewing'), finalTask(3)],
    })).not.toThrow()
  })

  it.each<RequirementTask['status']>(['in_progress', 'reviewing', 'completed', 'failed'])('rejects an empty %s task', async (status) => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1,
      tasks: [task('A', 0, status, ''), finalTask(1)],
    })).toThrow('empty executable task')
  })

  it('rejects a missing, duplicate, or displaced Final Test', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1, tasks: [task('A', 0, 'pending')],
    })).toThrow('Final Test')
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1, tasks: [finalTask(0), task('A', 1, 'pending')],
    })).toThrow('Final Test')
  })

  it('rejects duplicate task identities', async () => {
    const { session, roundId } = await setup()
    const first = task('A', 0, 'pending')
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1,
      tasks: [first, { ...first, order: 1 }, finalTask(2)],
    })).toThrow('duplicate task id')
  })

  it('rejects discontinuous task order', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, documentRevision: 1,
      tasks: [task('A', 1, 'pending'), finalTask(2)],
    })).toThrow('invalid task order')
  })

  it('requires exactly one settled answer for every clarification question', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/clarification', {
      version: 1, revision: 1, roundId, attempt: 1, status: 'answered',
      questions: [
        { id: 'scope', question: '覆盖哪个范围？' },
        { id: 'mode', question: '采用哪种模式？' },
      ],
      answers: [{ id: 'scope', selected: ['当前页面'] }],
    })).toThrow('invalid answers')
  })

  it('accepts invalid document drafts only when they carry diagnostics', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/document', {
      version: 1, revision: 2, roundId, turn: 1, summary: '待修订', markdown: '# 需求文档',
      valid: false, issues: ['缺少需求。'],
    })).not.toThrow()
    expect(() => session.append('requirement/document', {
      version: 1, revision: 3, roundId, turn: 1, summary: '错误状态', markdown,
      valid: true, issues: ['不应同时存在。'],
    })).toThrow('invalid payload')
  })

  it('accepts empty Markdown notes and rejects edits to dispatched notes', async () => {
    const { session, roundId } = await setup()
    const note = { version: 1 as const, roundId, noteId: 'NOTE-01' as never, kind: 'text' as const, content: '', dispatched: false }
    expect(() => {
      session.append('requirement/note', note)
      session.append('requirement/note', { ...note, content: '# Updated' })
    }).not.toThrow()
    const dispatched = {
      version: 1 as const, roundId, noteId: 'NOTE-02' as never, kind: 'comment' as const,
      content: '解释任务', dispatched: true, messageId: 'message-note' as never,
    }
    session.append('requirement/note', dispatched)
    expect(() => session.append('requirement/note', { ...dispatched, content: 'Changed' })).toThrow('non-editable note')
  })
})
