import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { requirementChangesProjectionDefinition as projection } from '../src/change-projection.ts'

function call(name: string, args: unknown, turn = 2): SessionEvent {
  return { type: 'tool/call', seq: 1, time: 1, data: { turn, step: 1, callId: 'call' as never, name, arguments: JSON.stringify(args) } }
}

function result(meta?: unknown, isError = false, text = 'Updated file', turn = 2): SessionEvent {
  return { type: 'tool/result', seq: 2, time: 2, data: {
    turn, step: 1, meta,
    message: { id: 'message', role: 'user', source: { kind: 'tool', callId: 'call' },
      content: [{ type: 'tool-result', toolCallId: 'call', isError, content: [{ type: 'text', text }] }] },
  } } as SessionEvent
}

function fold(events: SessionEvent[]) {
  return events.reduce((state, event) => projection.apply(state, event), projection.init())
}

describe('recorded graph mutation evidence', () => {
  const diff = { path: 'a.ts', oldText: 'old', newText: 'new' }
  it('retains applied snippets with execution Turn and survives serialized replay', () => {
    const events = [call('edit', { file_path: 'a.ts' }), result({ diffs: [diff] })]
    const state = fold(events)
    expect(projection.wire.view(state).changes).toEqual([{ ...diff, turn: 2, seq: 2 }])
    expect(fold(JSON.parse(JSON.stringify(events)) as SessionEvent[])).toEqual(state)
    expect(projection.stateSchema.parse(state)).toEqual(state)
  })

  it('excludes reads, failed edits, unmatched results, wrong Turns, malformed metadata and no-ops', () => {
    for (const events of [
      [call('read', {}), result({ diffs: [diff] })],
      [call('edit', {}), result({ diffs: [diff] }, true)],
      [result({ diffs: [diff] })],
      [call('edit', {}), result({ diffs: [diff] }, false, '', 3)],
      [call('edit', {}), result({ diffs: [{ path: 4 }] })],
      [call('edit', {}), result({ diffs: [{ ...diff, newText: 'old' }] })],
      [call('write', { file_path: 'a.ts', content: 'same' }), result({ diffs: [] })],
      [call('str_replace_editor', { command: 'view', path: 'a.ts' }), result()],
    ]) expect(fold(events).changes).toEqual([])
  })

  it('records successful file creation and editor mutations without treating views as writes', () => {
    expect(fold([call('write', { file_path: 'new.ts', content: '' }), result({ diffs: [] }, false, '<content>\nCreated file\n</content>')]).changes)
      .toEqual([{ path: 'new.ts', oldText: null, newText: '', turn: 2, seq: 2 }])
    for (const args of [
      { command: 'create', path: 'a.ts', file_text: 'new' },
      { command: 'insert', path: 'a.ts', new_str: 'new' },
      { command: 'str_replace', path: 'a.ts', old_str: 'old', new_str: 'new' },
    ]) expect(fold([call('str_replace_editor', args), result()]).changes[0]?.newText).toBe('new')
  })
})
