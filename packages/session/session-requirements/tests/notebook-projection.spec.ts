/** Notebook reconstruction preserves cells and execution attempts outside the Chat window. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { requirementNotebookProjectionDefinition as definition } from '../src/notebook-projection.ts'

function recordedEvents(): SessionEvent[] {
  return readFileSync(new URL('../../../../snapshots/web/requirement-task-result/session.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map((line, seq) => {
      const row = JSON.parse(line) as SessionEvent
      return { type: row.type, data: row.data, seq, time: seq } as SessionEvent
    })
}

describe('durable Notebook projection', () => {
  it('reconstructs all cells and delivery outputs from an existing recorded Session', () => {
    let state = definition.init()
    for (const event of recordedEvents()) state = definition.apply(state, event)
    const restored = definition.stateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(definition.wire.view(restored)).toEqual(state)
    expect(restored.entries.filter(event => event.type === 'requirement/document')).toHaveLength(1)
    expect(restored.entries.filter(event => event.type === 'requirement/task-list')).toHaveLength(1)
    expect(restored.entries.filter(event => event.type === 'requirement/task-execution' && event.data.output?.includes('欢迎体验'))).toHaveLength(2)
    expect(restored.entries.find(event => event.type === 'requirement/validation')).toMatchObject({ data: { status: 'completed' } })
    for (let seq = 10_000; seq < 10_500; seq++) {
      state = definition.apply(state, { type: 'assistant/message', seq, time: seq, data: {} } as SessionEvent)
    }
    expect(state).toEqual(restored)
  })

  it('preserves old document tasks and output while new revisions and attempts arrive', () => {
    let state = definition.init()
    for (const event of recordedEvents()) state = definition.apply(state, event)
    const document = state.entries.find(event => event.type === 'requirement/document')!
    const list = state.entries.find(event => event.type === 'requirement/task-list')!
    const execution = state.entries.find(event => event.type === 'requirement/task-execution')!
    if (document.type !== 'requirement/document' || list.type !== 'requirement/task-list' || execution.type !== 'requirement/task-execution') throw new Error('recording lacks Notebook cells')
    state = definition.apply(state, { ...document, seq: 10_000, data: { ...document.data, revision: 2, markdown: 'Changed document' } })
    state = definition.apply(state, { ...list, seq: 10_001, data: { ...list.data, revision: 20, documentRevision: 2, tasks: [] } })
    state = definition.apply(state, { ...execution, seq: 10_002, data: {
      version: 1, roundId: execution.data.roundId, taskId: execution.data.taskId,
      messageId: 'retry' as never, revision: 20, status: 'submitted',
    } })
    expect(state.entries).toContain(document)
    expect(state.entries).toContain(list)
    expect(state.entries).toContain(execution)
    expect(state.entries.filter(event => event.type === 'requirement/task-execution')).toHaveLength(3)
    expect(definition.stateSchema.safeParse(JSON.parse(JSON.stringify(state))).success).toBe(true)
  })

  it('rejects malformed persisted cells instead of publishing an incomplete Notebook', () => {
    expect(definition.stateSchema.safeParse({ entries: [{ type: 'requirement/task-list', seq: 0, time: 0, data: { tasks: [] } }] }).success).toBe(false)
  })
})
