// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { MarkdownNoteCell } from '../src/client/MarkdownNoteCell.tsx'
import type {} from '../src/client/index.ts'
import type { RequirementNoteNode } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)
const note: RequirementNoteNode = {
  key: 'note:1', kind: 'requirements-note', id: '1', target: 'requirements', anchorSeq: 1, time: 1,
  data: { version: 1, roundId: 'ROUND-01' as never, noteId: 'NOTE-01' as never, kind: 'text', content: '# 备注', dispatched: false },
}
type Save = Parameters<typeof MarkdownNoteCell>[0]['editNote']
const saved: Awaited<ReturnType<Save>> = { ok: true, value: { roundId: note.data.roundId, noteId: note.data.noteId, eventSeq: 3 } }

describe('Markdown note cell', () => {
  it('serializes saves and retains the latest Markdown while a save is pending', async () => {
    let complete: (value: Awaited<ReturnType<Save>>) => void = () => { throw new Error('save has not started') }
    const editNote = vi.fn<Save>().mockImplementationOnce(() => new Promise((resolve) => { complete = resolve })).mockResolvedValue(saved)
    render(<MarkdownNoteCell note={note} autoFocus editNote={editNote} t={t} />)
    const input = screen.getByRole('textbox', { name: 'Markdown 备注内容' })
    fireEvent.change(input, { target: { value: '# 第一版' } })
    await waitFor(() => { expect(editNote).toHaveBeenCalledTimes(1) })
    const content = '# 最终版\n\n保留换行。  \n第二行。\n'
    fireEvent.change(input, { target: { value: '# 中间版' } })
    fireEvent.change(input, { target: { value: content } })
    fireEvent.blur(input)
    expect(screen.getByRole('heading', { name: '最终版' })).toBeTruthy()
    await act(async () => { complete(saved) })
    expect(editNote).toHaveBeenCalledTimes(2)
    expect(editNote).toHaveBeenLastCalledWith({ roundId: note.data.roundId, noteId: note.data.noteId, content })
    fireEvent.click(screen.getByRole('button', { name: '编辑备注' }))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe(content)
  })

  it('keeps failed Markdown edits available for retry and can persist an empty note', async () => {
    const editNote = vi.fn<Save>().mockResolvedValueOnce({ ok: false, error: 'offline' }).mockResolvedValue(saved)
    render(<MarkdownNoteCell note={note} autoFocus editNote={editNote} t={t} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# 保留输入' } })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('offline') })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('# 保留输入')
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    await waitFor(() => { expect(editNote).toHaveBeenLastCalledWith({ roundId: note.data.roundId, noteId: note.data.noteId, content: '' }) })
    fireEvent.click(screen.getByRole('button', { name: '预览备注' }))
    expect(screen.getByRole('button', { name: '用 Markdown 写备注…' })).toBeTruthy()
  })

  it('uses shared GFM rendering without rendering raw HTML', () => {
    const content = '# 备注\n\n| 项目 | 结果 |\n| --- | --- |\n| 页面 | **通过** |\n\n<script>alert(1)</script>'
    const { container } = render(
      <MarkdownNoteCell note={{ ...note, data: { ...note.data, content } }} autoFocus={false} editNote={vi.fn<Save>()} t={t} />,
    )
    expect(screen.getByRole('heading', { name: '备注' })).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('通过', { selector: 'strong' })).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
  })
})
