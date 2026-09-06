/** Editable Markdown annotations rendered by the shared DSH Markdown primitive. */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconEditOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { RequirementNoteNode } from './contract.ts'
import type { RequirementsViewInjected } from './RequirementsView.tsx'
import { AutoGrowTextarea } from './AutoGrowTextarea.tsx'
import css from './RequirementsView.module.css'

interface MarkdownNoteCellProps extends PropsLocale<typeof NS>, Pick<RequirementsViewInjected, 'editNote'> {
  readonly note: RequirementNoteNode
  readonly autoFocus: boolean
}

/**
 * Edit and autosave a passive note; preview uses the chat Markdown renderer.
 * @param props - Durable note, session-bound save action, focus intent, and localized copy.
 * @returns one non-executable Markdown cell.
 */
export function MarkdownNoteCell({ note, autoFocus, editNote, t }: MarkdownNoteCellProps) {
  const [editing, setEditing] = useState(autoFocus)
  const [revision, redraw] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const draft = useRef({ content: note.data.content, saved: note.data.content, savedSeq: note.anchorSeq })
  const pending = useRef<Promise<void> | undefined>()
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  useLayoutEffect(() => {
    if (autoFocus) setEditing(true)
  }, [autoFocus])
  useLayoutEffect(() => {
    if (pending.current === undefined && draft.current.content === draft.current.saved
      && note.anchorSeq >= draft.current.savedSeq && note.data.content !== draft.current.saved) {
      draft.current = { content: note.data.content, saved: note.data.content, savedSeq: note.anchorSeq }
      redraw(value => value + 1)
    }
  }, [note, revision])

  const persist = (): Promise<void> => {
    if (pending.current !== undefined) return pending.current
    pending.current = Promise.resolve().then(async () => {
      setError(undefined)
      try {
        while (draft.current.content !== draft.current.saved) {
          const content = draft.current.content
          const result = await editNote({ roundId: note.data.roundId, noteId: note.data.noteId, content })
          if (!result.ok) throw new Error(result.error)
          draft.current.saved = content
          draft.current.savedSeq = result.value.eventSeq
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }).finally(() => {
      pending.current = undefined
      redraw(value => value + 1)
    })
    return pending.current
  }

  return (
    <article className={css.noteCell} data-cell="text" data-note-id={note.data.noteId}>
      <span className={css.noteIcon}>{t('cell.markdownType')}</span>
      <div className={css.noteBody}>
        <div className={css.noteHeading}>
          <strong>{t('cell.markdownNote')}</strong>
          <button type="button" aria-label={t(editing ? 'cell.previewNote' : 'cell.editNote')} onClick={() => { setEditing(value => !value) }}>
            <IconEditOutline16 size={13} />{t(editing ? 'cell.previewNote' : 'cell.editNote')}
          </button>
        </div>
        {editing ? (
          <AutoGrowTextarea
            autoFocus
            className={css.taskSource}
            aria-label={t('cell.noteContent')}
            placeholder={t('cell.markdownPlaceholder')}
            value={draft.current.content}
            onValueChange={(content) => {
              draft.current.content = content
              redraw(value => value + 1)
              void persist()
            }}
            onBlur={(event) => {
              if (!event.currentTarget.closest('article')?.contains(event.relatedTarget)) setEditing(false)
            }}
          />
        ) : draft.current.content.trim() === '' ? (
          <button className={css.emptyNote} type="button" onClick={() => { setEditing(true) }}>{t('cell.markdownPlaceholder')}</button>
        ) : <MarkdownText text={draft.current.content} labels={labels} />}
        {error !== undefined && <div className={css.taskError} role="alert">
          {t('cell.noteSaveFailed')} · {error}
          <button type="button" onClick={() => { void persist() }}>{t('cell.retrySave')}</button>
        </div>}
      </div>
    </article>
  )
}
