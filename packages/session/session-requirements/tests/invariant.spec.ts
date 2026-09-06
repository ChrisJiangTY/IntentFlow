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
    language: 'en', input: 'Build a notebook.', status: 'executing',
  })
  return { session, roundId }
}

describe('requirement task draft invariant', () => {
  it('accepts empty pending and withdrawn drafts and title-only executable tasks', async () => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId,
      tasks: [
        { id: 'A' as never, order: 0, title: '', statement: '', status: 'pending' },
        { id: 'B' as never, order: 1, title: '', statement: '', status: 'withdrawn' },
        { id: 'C' as never, order: 2, title: 'Create page', statement: '', status: 'in_progress' },
      ],
    })).not.toThrow()
  })

  it.each<RequirementTask['status']>(['in_progress', 'completed', 'failed'])('rejects an empty %s task', async (status) => {
    const { session, roundId } = await setup()
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId,
      tasks: [{ id: 'A' as never, order: 0, title: '', statement: '', status }],
    })).toThrow('empty executable task')
  })

  it('rejects duplicate draft identities', async () => {
    const { session, roundId } = await setup()
    const task: RequirementTask = { id: 'A' as never, order: 0, title: '', statement: '', status: 'pending' }
    expect(() => session.append('requirement/task-list', {
      version: 1, revision: 1, roundId, tasks: [task, { ...task, order: 1 }],
    })).toThrow('duplicate task id')
  })

  it('accepts empty Markdown notes and replacements under the same identity', async () => {
    const { session, roundId } = await setup()
    const note = { version: 1 as const, roundId, noteId: 'NOTE-01' as never, kind: 'text' as const, content: '', dispatched: false }
    expect(() => {
      session.append('requirement/note', note)
      session.append('requirement/note', { ...note, content: '# Updated' })
    }).not.toThrow()
  })

  it('rejects empty comments and changes to dispatched note content', async () => {
    const { session, roundId } = await setup()
    const note = { version: 1 as const, roundId, noteId: 'NOTE-01' as never, kind: 'comment' as const, content: '', dispatched: false }
    expect(() => session.append('requirement/note', note)).toThrow('invalid payload')
    const dispatched = { ...note, content: 'Explain the task', dispatched: true, messageId: 'message-note' as never }
    session.append('requirement/note', dispatched)
    expect(() => session.append('requirement/note', { ...dispatched, content: 'Changed' })).toThrow('non-editable note')
  })
})
