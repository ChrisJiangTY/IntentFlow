/** Replayable file mutation evidence for the Session requirement graph. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { RequirementChangesProjection } from './types.ts'

const diffSchema = z.object({ path: z.string().min(1), oldText: z.string().nullable(), newText: z.string() })
const callSchema = z.object({
  callId: z.string(), turn: z.number(), name: z.string(), arguments: z.string(),
})
const changeSchema = diffSchema.extend({ seq: z.number(), turn: z.number() })
const viewSchema = z.object({ changes: z.array(changeSchema) })
const stateSchema = viewSchema.extend({ pending: z.array(callSchema) })
type ChangeState = z.infer<typeof stateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    requirementChanges: ChangeState
  }
}

function callDiff(call: z.infer<typeof callSchema>): z.infer<typeof diffSchema> | undefined {
  let value: unknown
  try { value = JSON.parse(call.arguments) } catch { return undefined /* Malformed tool JSON records no mutation. */ }
  const args = z.object({
    file_path: z.string().optional(), content: z.string().optional(), path: z.string().optional(),
    command: z.string().optional(), file_text: z.string().optional(), old_str: z.string().optional(), new_str: z.string().optional(),
  }).safeParse(value)
  if (!args.success) return undefined
  const data = args.data
  if (call.name === 'write' && data.file_path && data.content !== undefined) {
    return { path: data.file_path, oldText: null, newText: data.content }
  }
  if (call.name !== 'str_replace_editor' || !data.path) return undefined
  if (data.command === 'create' && data.file_text !== undefined) return { path: data.path, oldText: null, newText: data.file_text }
  if (data.command === 'str_replace' && data.old_str !== undefined && data.old_str !== (data.new_str ?? '')) {
    return { path: data.path, oldText: data.old_str, newText: data.new_str ?? '' }
  }
  if (data.command === 'insert' && data.new_str) return { path: data.path, oldText: null, newText: data.new_str }
  return undefined
}

/** Successful edit metadata and supported mutation calls; reads and failed calls never contribute. */
export const requirementChangesProjectionDefinition = {
  key: 'requirementChanges',
  stateVersion: 1,
  stateSchema,
  init: (): ChangeState => ({ changes: [], pending: [] }),
  apply: (state, event) => {
    if (event.type === 'tool/call') {
      if (!['write', 'edit', 'str_replace_editor'].includes(event.data.name)) return state
      return { ...state, pending: [...state.pending, event.data] }
    }
    if (event.type === 'turn/end') return { ...state, pending: state.pending.filter(call => call.turn !== event.data.turn) }
    if (event.type !== 'tool/result') return state
    const result = event.data.message.content[0]
    const call = state.pending.find(item => item.callId === result.toolCallId && item.turn === event.data.turn)
    if (call === undefined) return state
    const pending = state.pending.filter(item => item !== call)
    if (result.isError || event.data.error) return { ...state, pending }
    const meta = z.object({ diffs: z.array(diffSchema) }).safeParse(event.data.meta)
    let diffs = meta.success ? meta.data.diffs.filter(diff => diff.oldText !== diff.newText) : []
    // A write with empty diff metadata can also be a no-op overwrite. Only its explicit create result permits fallback.
    const created = result.content.some(block => block.type === 'text' && /<content>\s*Created file\s*<\/content>/u.test(block.text))
    if (diffs.length === 0 && (call.name === 'str_replace_editor' || (call.name === 'write' && created))) {
      const diff = callDiff(call)
      if (diff !== undefined) diffs = [diff]
    }
    return { pending, changes: [...state.changes, ...diffs.map(diff => ({ ...diff, seq: event.seq, turn: event.data.turn }))] }
  },
  wire: { viewSchema, view: (state): RequirementChangesProjection => ({ changes: state.changes }) },
} satisfies ProjectionDefinition<'requirementChanges', ChangeState>
