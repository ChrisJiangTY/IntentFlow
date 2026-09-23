/** Requirements Notebook view: clarification, documents, tasks, review gates, and validation. */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconEllipsisOutline16,
  IconPlayOutline16,
  IconRefreshOutline14,
  IconSearchOutline16,
  IconSparkle16,
  IconTrashOutline16,
  MarkdownText,
  type MarkdownFileMentions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementDocumentActionResult,
  RequirementDocumentEditRequest,
  RequirementNoteRequest,
  RequirementNoteEditRequest,
  RequirementNoteResult,
  RequirementRoundId,
  RequirementRoundStartRequest,
  RequirementRoundStartResult,
  RequirementRunAllRequest,
  RequirementRunAllResult,
  RequirementRunAllStopRequest,
  RequirementRunAllStopResult,
  RequirementTaskAddRequest,
  RequirementTaskGenerateRequest,
  RequirementTaskEditRequest,
  RequirementTaskId,
  RequirementTaskMoveRequest,
  RequirementTaskMutationResult,
  RequirementTaskRunRequest,
  RequirementTaskRunResult,
  RequirementTaskWithdrawRequest,
} from '@deepseek-ai/dsh-session-requirements/client'
import type { NS } from './locales.ts'
import type {
  RequirementNoteNode,
  RequirementRoundNode,
  RequirementTaskExecutionNode,
  RequirementTaskListNode,
  RequirementsSnapshot,
} from './contract.ts'
import { requirementText, type RequirementContentLanguage } from './language.ts'
import type { RequirementsKey } from './locales.ts'
import css from './RequirementsView.module.css'
import { AutoGrowTextarea } from './AutoGrowTextarea.tsx'
import { MarkdownNoteCell } from './MarkdownNoteCell.tsx'
import { taskResult } from './task-result.ts'
import type { TraceNavigation } from './knowledge-graph.ts'

/** Result returned after one structured Notebook action. */
export type RequirementActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

/** Session-bound actions supplied by the browser plugin. */
export interface RequirementsViewInjected {
  /** Requirement Notebook snapshot source bound to the selected Session. */
  readonly hooks: { readonly requirements: ObservableSnapshot<RequirementsSnapshot> }
  /** Start a raw requirement round and let the Agent clarify or submit its document. */
  startRound: (request: RequirementRoundStartRequest) => Promise<RequirementActionOutcome<RequirementRoundStartResult>>
  /** Persist one optimistic requirement-document edit. */
  editDocument: (request: RequirementDocumentEditRequest) => Promise<RequirementActionOutcome<RequirementDocumentActionResult>>
  /** Generate executable task blocks from one document revision. */
  generateTasks: (request: RequirementTaskGenerateRequest) => Promise<RequirementActionOutcome<RequirementDocumentActionResult>>
  /** Run one task cell. */
  runTask: (request: RequirementTaskRunRequest) => Promise<RequirementActionOutcome<RequirementTaskRunResult>>
  /** Cancel the selected task execution or review. */
  stopTask: (request: RequirementTaskRunRequest) => Promise<RequirementActionOutcome<RequirementTaskRunResult>>
  /** Run pending task cells in order. */
  runAll: (request: RequirementRunAllRequest) => Promise<RequirementActionOutcome<RequirementRunAllResult>>
  /** Stop Run All after its current task and review settle. */
  stopRunAll: (request: RequirementRunAllStopRequest) => Promise<RequirementActionOutcome<RequirementRunAllStopResult>>
  /** Insert a durable task, including an empty pending cell. */
  addTask: (request: RequirementTaskAddRequest) => Promise<RequirementActionOutcome<RequirementTaskMutationResult>>
  /** Edit one task and return it to the pending state. */
  editTask: (request: RequirementTaskEditRequest) => Promise<RequirementActionOutcome<RequirementTaskMutationResult>>
  /** Move one future task in execution order. */
  moveTask: (request: RequirementTaskMoveRequest) => Promise<RequirementActionOutcome<RequirementTaskMutationResult>>
  /** Withdraw one task before execution. */
  withdrawTask: (request: RequirementTaskWithdrawRequest) => Promise<RequirementActionOutcome<RequirementTaskMutationResult>>
  /** Persist one text or comment cell, with explicit Agent dispatch intent. */
  addNote: (request: RequirementNoteRequest) => Promise<RequirementActionOutcome<RequirementNoteResult>>
  /** Persist Markdown note edits without dispatching an Agent turn. */
  editNote: (request: RequirementNoteEditRequest) => Promise<RequirementActionOutcome<RequirementNoteResult>>
  /** Dispatch an explicit independent review. */
  requestReview: () => Promise<string | undefined>
  /** Try to open an external Task delivery inside the Session sidebar browser. */
  openDeliveryUrl: (url: string) => boolean
  /** Open a local HTML delivery in the Session sidebar's file preview. */
  openDeliveryFile: (path: string) => boolean
  /** Bind sidebar graph navigation to this mounted Notebook. */
  bindGraphReveal: (listener: (node: TraceNavigation) => void) => () => void
  /** Initial content language derived from the active product locale. */
  readonly initialLanguage: RequirementContentLanguage
}

interface SelectedCell {
  readonly roundId: RequirementRoundId
  readonly taskId?: RequirementTaskId
}

interface TaskDraft {
  readonly roundId: RequirementRoundId
  readonly taskId: RequirementTaskId
  source: string
  summary: string
  savedSource: string
  savedSummary: string
  savedSeq: number
  pending?: Promise<string | undefined>
  error?: string
}

interface DocumentDraft {
  readonly roundId: RequirementRoundId
  readonly revision: number
  source: string
  error?: string
}

type InspectorMode = 'details' | 'history'

const TASK_STATEMENT_INDENT = '  '
const collapsedRoundsBySession = new Map<string, Set<string>>()
const EMPTY_COLLAPSED_ROUNDS: ReadonlySet<string> = new Set()

function taskSource(title: string, statement: string): string {
  if (statement === '') return title
  return [title, ...statement.split('\n').map(line => `${TASK_STATEMENT_INDENT}${line}`)].join('\n')
}

function taskParts(source: string): { readonly title: string; readonly statement: string } {
  const [title = '', ...statementLines] = source.replaceAll('\r\n', '\n').split('\n')
  return {
    title: title.trim(),
    statement: statementLines
      .map(line => line.startsWith(TASK_STATEMENT_INDENT) ? line.slice(TASK_STATEMENT_INDENT.length) : line)
      .join('\n')
      .trim(),
  }
}

function taskHumanSummary(title: string, summary: string | undefined, statement: string): string {
  const clean = (value: string) => value
    .replace(/[（(]\s*AC\b[^）)]*[）)]/giu, '')
    .replace(/\s+([。！？])/gu, '$1')
    .trim()
  const provided = clean(summary ?? '')
  if (provided !== '') return provided
  const detail = /^(?:\*\*目标\*\*|\*\*范围\*\*)[:：]\s*(\S.*)$/mu.exec(statement)?.[1]
    ?.replaceAll('`', '').replaceAll('**', '').trim()
  const firstSentence = detail === undefined ? undefined : /^.*?[。！？]/u.exec(detail)?.[0]
  const fallback = clean(firstSentence ?? (detail === undefined || detail === '' ? title : detail))
  return fallback.length <= 120 ? fallback : `${fallback.slice(0, 119)}…`
}

function latestBy<T>(nodes: readonly T[], keyOf: (node: T) => string): Map<string, T> {
  const result = new Map<string, T>()
  for (const node of nodes) result.set(keyOf(node), node)
  return result
}

function statusMark(
  task: RequirementTaskListNode['data']['tasks'][number],
  execution: RequirementTaskExecutionNode | undefined,
): string {
  if (task.status === 'withdrawn') return '×'
  if (task.status === 'failed') return '!'
  if (task.status === 'completed') return '✓'
  if (task.status === 'in_progress' || task.status === 'reviewing') {
    return execution?.data.turn === undefined ? '*' : String(execution.data.turn)
  }
  return ' '
}

function validationMark(status: 'pending' | 'processing' | 'completed' | 'failed', turn: number): string {
  if (status === 'processing') return '*'
  if (status === 'failed') return '!'
  if (status === 'completed') return String(turn)
  return ' '
}

function isTaskRunning(execution: RequirementTaskExecutionNode | undefined): boolean {
  return execution?.data.status === 'submitted'
    || execution?.data.status === 'processing'
    || execution?.data.status === 'reviewing'
}

function taskStatusKey(status: RequirementTaskListNode['data']['tasks'][number]['status']): RequirementsKey {
  switch (status) {
    case 'pending': return 'details.taskStatus.pending'
    case 'in_progress': return 'details.taskStatus.inProgress'
    case 'reviewing': return 'details.taskStatus.reviewing'
    case 'completed': return 'details.taskStatus.completed'
    case 'failed': return 'details.taskStatus.failed'
    case 'withdrawn': return 'details.taskStatus.withdrawn'
  }
}

/**
 * Render the Figma-aligned requirements Notebook inside the resident DSH shell.
 * The default conversation composer remains owned by ui-conversation below the view.
 * @param props - Conversation hooks, Notebook actions, and localized copy.
 * @returns the complete requirements Notebook view.
 */
export function RequirementsView({
  sessionId,
  useRequirements,
  editDocument,
  generateTasks,
  runTask,
  stopTask,
  runAll,
  stopRunAll,
  addTask,
  editTask,
  moveTask,
  withdrawTask,
  addNote,
  editNote,
  requestReview,
  openDeliveryUrl,
  openDeliveryFile,
  bindGraphReveal,
  openView,
  initialLanguage,
  t,
}: ConvViewProps & InjectFace<RequirementsViewInjected> & PropsLocale<typeof NS>) {
  const snapshot = useRequirements(value => value)
  const rootRef = useRef<HTMLDivElement>(null)
  const [language, setLanguage] = useState<RequirementContentLanguage>(initialLanguage)
  const sessionKey = String(sessionId)
  const [collapsedState, setCollapsedState] = useState(() => ({
    sessionKey,
    rounds: new Set(collapsedRoundsBySession.get(sessionKey) ?? []),
  }))
  const collapsed = collapsedState.sessionKey === sessionKey
    ? collapsedState.rounds
    : collapsedRoundsBySession.get(sessionKey) ?? EMPTY_COLLAPSED_ROUNDS
  const setCollapsed = (update: Set<string> | ((current: Set<string>) => Set<string>)): void => {
    const next = typeof update === 'function' ? update(new Set(collapsed)) : update
    const rounds = new Set(next)
    collapsedRoundsBySession.set(sessionKey, rounds)
    setCollapsedState({ sessionKey, rounds })
  }
  const initialScrollDone = useRef(false)
  const [collapsedOutputs, setCollapsedOutputs] = useState<Set<string>>(new Set())
  const [expandedTaskSpecs, setExpandedTaskSpecs] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<SelectedCell | undefined>()
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft | undefined>()
  const taskDrafts = useRef(new Map<RequirementTaskId, TaskDraft>())
  const [draftRevision, renderDrafts] = useState(0)
  const [newTaskId, setNewTaskId] = useState<RequirementTaskId | undefined>()
  const [newNote, setNewNote] = useState<RequirementNoteResult | undefined>()
  const [running, setRunning] = useState<string | undefined>()
  const [reviewing, setReviewing] = useState(false)
  const [inspector, setInspector] = useState<InspectorMode | undefined>()
  const [commandOpen, setCommandOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState<string | undefined>()
  const [zoom, setZoom] = useState(1)
  const [actionError, setActionError] = useState<string | undefined>()
  const [graphReveal, setGraphReveal] = useState<TraceNavigation | undefined>()
  const deliveryFiles = useMemo<MarkdownFileMentions>(() => ({
    resolve: (path) => {
      if (!/^[^\s<>`"'|?*]+\.html?$/i.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined
      return {
        label: t('cell.openHtml', { path }),
        title: path,
        open: () => {
          if (!openDeliveryFile(path)) setActionError(t('cell.htmlUnavailable'))
        },
      }
    },
  }), [openDeliveryFile, t])

  const rounds = useMemo(() => latestBy(snapshot.rounds, node => String(node.data.roundId)), [snapshot.rounds])
  const documents = useMemo(() => latestBy(snapshot.documents, node => String(node.data.roundId)), [snapshot.documents])
  const clarifications = useMemo(() => {
    const grouped = new Map<string, typeof snapshot.clarifications>()
    const latest = latestBy(snapshot.clarifications, node => `${node.data.roundId}:${node.data.attempt}`)
    for (const node of latest.values()) {
      const list = grouped.get(String(node.data.roundId)) ?? []
      grouped.set(String(node.data.roundId), [...list, node])
    }
    return grouped
  }, [snapshot.clarifications])
  const taskLists = useMemo(() => latestBy(snapshot.taskLists, node => String(node.data.roundId)), [snapshot.taskLists])
  const validations = useMemo(() => latestBy(snapshot.validations.filter(node =>
    node.anchorSeq >= (taskLists.get(String(node.data.roundId))?.anchorSeq ?? -1)),
  node => String(node.data.roundId)), [snapshot.validations, taskLists])
  const notes = useMemo(() => {
    const grouped = new Map<string, RequirementNoteNode[]>()
    for (const node of latestBy(snapshot.notes, note => `${note.data.roundId}:${note.data.noteId}`).values()) {
      const list = grouped.get(String(node.data.roundId)) ?? []
      list.push(node)
      grouped.set(String(node.data.roundId), list)
    }
    return grouped
  }, [snapshot.notes])
  const taskExecutions = useMemo(() => latestBy(
    snapshot.taskExecutions,
    node => `${node.data.roundId}:${node.data.taskId}`,
  ), [snapshot.taskExecutions])
  const runAlls = useMemo(() => latestBy(snapshot.runAlls, node => String(node.data.roundId)), [snapshot.runAlls])
  const orderedRounds = [...rounds.values()].sort((left, right) => left.data.round - right.data.round)
  const latestRound = orderedRounds.at(-1)
  const latestRoundDocument = latestRound === undefined ? undefined : documents.get(String(latestRound.data.roundId))
  const latestRoundTaskList = latestRoundDocument === undefined
    ? undefined
    : taskLists.get(String(latestRound?.data.roundId))
  const currentLatestTaskList = latestRoundTaskList?.data.documentRevision === latestRoundDocument?.data.revision
    ? latestRoundTaskList
    : undefined
  const latestRunAll = latestRound === undefined ? undefined : runAlls.get(String(latestRound.data.roundId))
  const activeRunAll = latestRunAll !== undefined
    && (latestRunAll.data.status === 'running' || latestRunAll.data.status === 'stopping')
    ? latestRunAll
    : undefined
  const selectedRound = selected === undefined ? undefined : rounds.get(String(selected.roundId))
  const selectedDocument = selected === undefined ? undefined : documents.get(String(selected.roundId))
  const projectedSelectedTaskList = selected === undefined ? undefined : taskLists.get(String(selected.roundId))
  const selectedTaskList = selectedDocument !== undefined
    && projectedSelectedTaskList?.data.documentRevision === selectedDocument.data.revision
    ? projectedSelectedTaskList
    : undefined
  const selectedTask = selected?.taskId === undefined || selectedTaskList === undefined
    ? undefined
    : selectedTaskList.data.tasks.find(task => task.id === selected.taskId)
  const selectedExecution = selected?.taskId === undefined
    ? undefined
    : taskExecutions.get(`${selected.roundId}:${selected.taskId}`)
  const selectedValidation = selected === undefined ? undefined : validations.get(String(selected.roundId))
  const completedReviews = snapshot.reviews.filter(node => node.data.status === 'completed')
  const latestReview = completedReviews.at(-1)
  const reviewedRequirements = latestReview?.data.status === 'completed' ? latestReview.data.requirements : []
  const markdownLabels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  useLayoutEffect(() => {
    if (initialScrollDone.current || latestRound === undefined) return
    const roundKey = String(latestRound.data.roundId)
    const roundElement = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-round-id]') ?? [])]
      .find(element => element.dataset.roundId === roundKey)
    if (roundElement === undefined) return
    const target = collapsed.has(roundKey)
      ? roundElement.querySelector<HTMLElement>('header')
      : [...roundElement.querySelectorAll<HTMLElement>('[data-cell]')].at(-1)
        ?? roundElement.querySelector<HTMLElement>('header')
    if (target === null) return
    initialScrollDone.current = true
    target.scrollIntoView({ block: 'end', behavior: 'instant' })
  }, [collapsed, latestRound?.data.roundId])

  useLayoutEffect(() => {
    for (const [taskId, draft] of taskDrafts.current) {
      const list = taskLists.get(String(draft.roundId))
      if (draft.pending !== undefined || draft.source !== draft.savedSource || draft.summary !== draft.savedSummary || list === undefined
        || list.anchorSeq < draft.savedSeq) continue
      const task = list.data.tasks.find(item => item.id === taskId)
      const saved = taskParts(draft.savedSource)
      if (task === undefined || task.title !== saved.title || task.summary !== draft.savedSummary || task.statement !== saved.statement) {
        taskDrafts.current.delete(taskId)
        renderDrafts(value => value + 1)
      }
    }
  }, [taskLists, draftRevision])

  const persistTask = (draft: TaskDraft): Promise<string | undefined> => {
    if (draft.pending !== undefined) return draft.pending
    draft.pending = Promise.resolve().then(async () => {
      try {
        delete draft.error
        while (draft.source !== draft.savedSource || draft.summary !== draft.savedSummary) {
          const source = draft.source
          const summary = draft.summary
          const humanEdit = summary !== draft.savedSummary
          const result = await editTask({ roundId: draft.roundId, taskId: draft.taskId, summary, humanEdit, ...taskParts(source) })
          if (!result.ok) throw new Error(result.error)
          const committed = result.value.task
          const savedSource = committed === undefined ? source : taskSource(committed.title, committed.statement)
          const savedSummary = committed?.summary ?? summary
          if (draft.source === source) draft.source = savedSource
          if (draft.summary === summary) draft.summary = savedSummary
          draft.savedSource = savedSource
          draft.savedSummary = savedSummary
          draft.savedSeq = result.value.eventSeq
        }
        return undefined
      } catch (reason) {
        draft.error = reason instanceof Error ? reason.message : String(reason)
        return draft.error
      }
    }).finally(() => {
      delete draft.pending
      renderDrafts(value => value + 1)
    })
    return draft.pending
  }

  const flushTasks = async (roundId: RequirementRoundId, taskId?: RequirementTaskId): Promise<string | undefined> => {
    const drafts = [...taskDrafts.current.values()].filter(draft => draft.roundId === roundId
      && (taskId === undefined || draft.taskId === taskId))
    const errors = await Promise.all(drafts.map(persistTask))
    return errors.find(error => error !== undefined)
  }

  const text = (value: Parameters<typeof requirementText>[0]): string => requirementText(value, language)

  const invoke = async <T,>(
    key: string,
    action: () => Promise<RequirementActionOutcome<T>>,
  ): Promise<T | undefined> => {
    setRunning(key)
    setActionError(undefined)
    try {
      const result = await action()
      if (!result.ok) {
        setActionError(result.error)
        return undefined
      }
      return result.value
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
      return undefined
    } finally {
      setRunning(undefined)
    }
  }

  const toggleRound = (roundId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(roundId)) next.delete(roundId)
      else next.add(roundId)
      return next
    })
  }

  const runOne = async (roundId: RequirementRoundId, taskId: RequirementTaskId): Promise<void> => {
    setSelected({ roundId, taskId })
    await invoke(String(taskId), async () => {
      const error = await flushTasks(roundId, taskId)
      return error === undefined ? runTask({ roundId, taskId }) : { ok: false, error }
    })
  }

  const runEverything = async (roundId: RequirementRoundId): Promise<void> => {
    await invoke(`all:${String(roundId)}`, async () => {
      const error = await flushTasks(roundId)
      return error === undefined ? runAll({ roundId }) : { ok: false, error }
    })
  }

  const stopEverything = async (roundId: RequirementRoundId): Promise<void> => {
    await invoke(`stop:${String(roundId)}`, () => stopRunAll({ roundId }))
  }

  const saveDocument = async (draft: DocumentDraft): Promise<void> => {
    const result = await invoke(`document:${String(draft.roundId)}`, () => editDocument({
      roundId: draft.roundId,
      revision: draft.revision,
      markdown: draft.source,
    }))
    if (result !== undefined) setDocumentDraft(undefined)
  }

  const createTasks = async (roundId: RequirementRoundId, documentRevision: number): Promise<void> => {
    await invoke(`generate:${String(roundId)}`, () => generateTasks({ roundId, documentRevision }))
  }

  const insertTask = async (roundId: RequirementRoundId): Promise<void> => {
    setCollapsed(current => new Set([...current].filter(id => id !== String(roundId))))
    const result = await invoke(`add-task:${String(roundId)}`, () => addTask({ roundId, title: '', summary: '', statement: '' }))
    if (result !== undefined) {
      setSelected({ roundId, taskId: result.taskId })
      setNewTaskId(result.taskId)
      setExpandedTaskSpecs(current => new Set([...current, `${roundId}:${result.taskId}`]))
    }
  }

  const insertMarkdownNote = async (roundId: RequirementRoundId): Promise<void> => {
    setCollapsed(current => new Set([...current].filter(id => id !== String(roundId))))
    const result = await invoke(`add-note:${String(roundId)}`, () => addNote({ roundId, kind: 'text', content: '', dispatch: false }))
    if (result !== undefined) setNewNote(result)
  }

  const review = async (): Promise<void> => {
    setReviewing(true)
    setActionError(undefined)
    try {
      setActionError(await requestReview())
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setReviewing(false)
    }
  }

  const changeTaskOrder = async (
    roundId: RequirementRoundId,
    taskId: RequirementTaskId,
    direction: 'up' | 'down',
  ): Promise<void> => {
    await invoke(`move-task:${String(taskId)}`, () => moveTask({ roundId, taskId, direction }))
  }

  const askAgentAboutTask = async (roundId: RequirementRoundId, taskId: RequirementTaskId, task: string): Promise<void> => {
    const result = await invoke(`assist-task:${String(taskId)}`, () => addNote({
      roundId,
      kind: 'comment',
      content: t('cell.assistPrompt', { taskId: String(taskId), task }),
      dispatch: true,
    }))
    if (result !== undefined) openView('chat', String(taskId))
  }

  const openInspector = (mode: InspectorMode, cell?: SelectedCell): void => {
    if (cell !== undefined) setSelected(cell)
    else if (selected === undefined && latestRound !== undefined) setSelected({ roundId: latestRound.data.roundId })
    setMoreOpen(undefined)
    setCommandOpen(false)
    setInspector(mode)
  }

  useLayoutEffect(() => bindGraphReveal(setGraphReveal), [bindGraphReveal])

  useLayoutEffect(() => {
    if (graphReveal === undefined) return
    const roundKey = String(graphReveal.roundId)
    const mappedTask = taskLists.get(roundKey)?.data.tasks.find(task => graphReveal.taskIds.includes(task.id))
    if (graphReveal.taskIds.length > 0 && mappedTask === undefined) return
    if (mappedTask === undefined && !documents.has(roundKey)) return
    setCollapsed(current => current.has(roundKey)
      ? new Set([...current].filter(id => id !== roundKey))
      : current)
    setSelected(mappedTask === undefined
      ? { roundId: graphReveal.roundId }
      : { roundId: graphReveal.roundId, taskId: mappedTask.id })
    queueMicrotask(() => {
      const roundElement = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-round-id]') ?? [])]
        .find(element => element.dataset.roundId === roundKey)
      const documentElement = roundElement?.querySelector<HTMLElement>('[data-cell="document"]')
      const requirementHeading = graphReveal.requirementTitle === undefined ? undefined
        : [...(documentElement?.querySelectorAll<HTMLElement>('h2, h3, h4') ?? [])].find(heading => heading.textContent.includes(graphReveal.requirementTitle ?? ''))
      const target = mappedTask === undefined
        ? requirementHeading ?? documentElement
        : [...(roundElement?.querySelectorAll<HTMLElement>('[data-task-id]') ?? [])]
          .find(element => element.dataset.taskId === String(mappedTask.id))
      if (target === undefined || target === null) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setGraphReveal(current => current === graphReveal ? undefined : current)
    })
  }, [documents, graphReveal, taskLists])

  const openDelivery = (event: ReactMouseEvent<HTMLElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (target === null) return
    const url = new URL(target.href, globalThis.location.href)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === globalThis.location.origin) return
    if (openDeliveryUrl(url.href)) event.preventDefault()
  }

  const selectTask = (
    roundId: RequirementRoundId,
    task: RequirementTaskListNode['data']['tasks'][number],
  ): void => {
    setSelected({ roundId, taskId: task.id })
    setMoreOpen(undefined)
  }

  const toggleTaskSpec = (roundId: RequirementRoundId, taskId: RequirementTaskId): void => {
    const key = `${roundId}:${taskId}`
    setExpandedTaskSpecs((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderCellToolbar = (roundId: RequirementRoundId, taskId: RequirementTaskId) => {
    const taskList = taskLists.get(String(roundId))
    const taskIndex = taskList?.data.tasks.findIndex(task => task.id === taskId) ?? -1
    const task = taskList?.data.tasks[taskIndex]
    const listBusy = taskList?.data.tasks.some(item => item.status === 'in_progress' || item.status === 'reviewing') ?? false
    const futureTask = task?.status === 'pending' || task?.status === 'failed'
    const canMove = futureTask && task.kind !== 'final-test' && !listBusy
    const nextTask = taskList?.data.tasks[taskIndex + 1]
    const menuKey = `${roundId}:${taskId}`
    const move = (direction: 'up' | 'down'): void => {
      void changeTaskOrder(roundId, taskId, direction)
    }
    return (
      <div className={css.cellToolbar} role="toolbar" aria-label={t('cell.toolbar')} onClick={(event) => { event.stopPropagation() }}>
        <button type="button" aria-label={t('cell.movePrevious')} disabled={!canMove || taskIndex <= 0 || taskList?.data.tasks[taskIndex - 1]?.status === 'completed'} onClick={() => { move('up') }}><IconChevronUpOutline14 size={13} /></button>
        <button type="button" aria-label={t('cell.moveNext')} disabled={!canMove || nextTask === undefined || nextTask.kind === 'final-test'} onClick={() => { move('down') }}><IconChevronDownOutline14 size={13} /></button>
        <span className={css.moreAnchor}>
          <button type="button" aria-label={t('cell.more')} aria-expanded={moreOpen === menuKey} onClick={() => { setMoreOpen(current => current === menuKey ? undefined : menuKey) }}><IconEllipsisOutline16 size={14} /></button>
          {moreOpen === menuKey && (
            <span className={css.cellMenu} role="menu">
              <button type="button" role="menuitem" onClick={() => { openInspector('details', { roundId, taskId }) }}>{t('more.details')}</button>
              <button type="button" role="menuitem" onClick={() => { openInspector('history', { roundId, taskId }) }}>{t('more.history')}</button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(undefined); void review() }}><IconRefreshOutline14 size={12} />{t('toolbar.review')}</button>
              {task?.status === 'pending' && task.kind !== 'final-test' && !listBusy && <button className={css.destructiveMenuItem} type="button" role="menuitem" onClick={() => {
                setMoreOpen(undefined)
                void invoke(`withdraw-task:${String(taskId)}`, async () => {
                  const error = await flushTasks(roundId, taskId)
                  return error === undefined ? withdrawTask({ roundId, taskId }) : { ok: false, error }
                })
              }}><IconTrashOutline16 size={12} />{t('details.withdraw')}</button>}
            </span>
          )}
        </span>
      </div>
    )
  }

  const renderTask = (
    round: RequirementRoundNode,
    task: RequirementTaskListNode['data']['tasks'][number],
    historical = false,
  ) => {
    const roundId = round.data.roundId
    const execution = task.status === 'pending' && task.humanInstruction !== undefined
      ? undefined : taskExecutions.get(`${roundId}:${task.id}`)
    const taskRegression = validations.get(String(roundId))?.data.regressions.some(item => item.taskId === task.id) ?? false
    const taskFailure = task.status === 'failed'
    const taskWithdrawn = task.status === 'withdrawn'
    const taskList = taskLists.get(String(roundId))
    const listBusy = taskList?.data.tasks.some(item => item.status === 'in_progress' || item.status === 'reviewing') ?? false
    const taskEditable = !historical && !listBusy && (task.status === 'pending' || task.status === 'failed')
    const priorTasksSettled = taskList?.data.tasks.every(item => item.order >= task.order
      || item.status === 'completed' || item.status === 'withdrawn') ?? false
    const runnable = !historical && (task.status === 'pending' || task.status === 'failed')
      && (task.kind !== 'final-test' || priorTasksSettled)
    const isSelected = selected?.roundId === roundId && selected.taskId === task.id
    const busy = running === String(task.id) || isTaskRunning(execution)
    const mark = statusMark(task, execution)
    const draft = taskDrafts.current.get(task.id)
    const source = draft?.source ?? taskSource(task.title, task.statement)
    const summary = draft?.summary ?? taskHumanSummary(task.title, task.summary, task.statement)
    const summaryEditable = !historical && !listBusy && task.status !== 'in_progress'
      && task.status !== 'reviewing' && task.status !== 'withdrawn'
    const label = task.title || t('cell.newTask')
    const outputKey = `${roundId}:${task.id}`
    const outputExpanded = !collapsedOutputs.has(outputKey)
    const specExpanded = expandedTaskSpecs.has(outputKey)
    const outputs = [...latestBy(snapshot.taskExecutions.filter(node => node.data.roundId === roundId
      && node.data.taskId === task.id && node.data.output !== undefined), node => String(node.data.messageId)).values()]
    const results = outputs.map(node => taskResult(node.data.output ?? ''))
    const taskReview = task.status === 'pending' ? undefined : snapshot.reviews.findLast(node => node.data.status === 'completed'
      && node.data.task?.taskId === task.id)
    return (
      <div className={css.taskCellGroup} data-task-group key={String(task.id)}>
        <article
          className={`${css.cell} ${isSelected ? css.selected : ''} ${taskRegression ? css.regression : ''} ${taskFailure ? css.taskFailure : ''} ${taskWithdrawn ? css.withdrawn : ''}`}
          data-cell="task"
          data-task-id={String(task.id)}
          data-selected={isSelected || undefined}
          data-status={taskRegression ? 'regression' : task.status}
          onClick={(event) => {
            selectTask(roundId, task)
            if (summaryEditable && !(event.target instanceof HTMLTextAreaElement)) {
              event.currentTarget.querySelector<HTMLTextAreaElement>('textarea')?.focus()
            }
          }}
        >
          <span className={css.executionMark} data-status={taskFailure ? 'failed' : task.status}>{`[${mark}]`}</span>
          <div className={css.cellGutter}>
            <button
              className={css.runButton}
              type="button"
              aria-label={t(busy ? 'cell.stop' : taskWithdrawn ? 'cell.withdrawn' : 'cell.run', { task: label })}
              aria-busy={busy}
              disabled={busy
                ? running !== undefined || historical
                : !runnable || taskWithdrawn || activeRunAll !== undefined || running !== undefined || source.trim() === ''}
              onClick={(event) => {
                event.stopPropagation()
                if (busy) void invoke(`stop-task:${task.id}`, () => stopTask({ roundId, taskId: task.id }))
                else void runOne(roundId, task.id)
              }}
            >
              {busy ? <span aria-hidden>■</span> : <IconPlayOutline16 size={13} />}
            </button>
          </div>
          <div className={css.cellBody}>
            <div className={css.taskReadView}>
              <div className={css.taskHeadingRow}>
                <span>{t('cell.taskIndex', { task: task.order + 1 })}</span>
                <strong>{label}</strong>
              </div>
              <AutoGrowTextarea
                aria-label={t('cell.taskSummary')}
                className={css.taskSummaryInput}
                placeholder={t('cell.taskSummaryPlaceholder')}
                readOnly={!summaryEditable}
                onFocus={() => { selectTask(roundId, task) }}
                onBlur={() => {
                  const current = taskDrafts.current.get(task.id)
                  if (current !== undefined) void persistTask(current)
                }}
                value={summary}
                onValueChange={(nextSummary) => {
                  const current = taskDrafts.current.get(task.id) ?? {
                    roundId, taskId: task.id, source, summary, savedSource: source, savedSummary: summary, savedSeq: 0,
                  }
                  current.summary = nextSummary
                  taskDrafts.current.set(task.id, current)
                  renderDrafts(value => value + 1)
                }}
              />
            </div>
            {draft?.error !== undefined && <div className={css.taskError} role="alert">{t('cell.autosaveFailed')} · {draft.error}</div>}
          </div>
          {draft?.pending !== undefined && <span role="status">{t('cell.updatingTask')}</span>}
          <span className={css.statusRail} aria-hidden />
          {historical && <span>{t('cell.previousTasks')}</span>}
          {isSelected && !historical && renderCellToolbar(roundId, task.id)}
          {isSelected && <button className={css.assistButton} type="button" aria-label={t('cell.assist')} onClick={(event) => { event.stopPropagation(); void askAgentAboutTask(roundId, task.id, task.statement) }}><IconSparkle16 size={15} /></button>}
        </article>
        <section className={css.taskAgentSpec} aria-label={t('cell.taskExecutionSpecRegion', { task: label })} data-task-agent-spec data-expanded={specExpanded || undefined}>
          <button
            className={css.taskAgentSpecToggle}
            type="button"
            aria-expanded={specExpanded}
            aria-label={t(specExpanded ? 'cell.collapseTaskExecutionSpec' : 'cell.expandTaskExecutionSpec', { task: label })}
            onClick={() => { toggleTaskSpec(roundId, task.id) }}
          >
            {specExpanded ? <IconChevronDownOutline14 size={13} /> : <IconChevronRightOutline14 size={13} />}
            <span>{t('cell.taskExecutionSpec')}</span>
          </button>
          {specExpanded && (
            <div className={css.taskAgentSpecBody}>
              {taskEditable
                ? <AutoGrowTextarea
                  autoFocus={newTaskId === task.id}
                  aria-label={t('cell.taskContent', { task: label })}
                  className={css.taskSource}
                  placeholder={t('cell.taskPlaceholder')}
                  readOnly={running !== undefined}
                  spellCheck={false}
                  value={source}
                  onValueChange={(nextSource) => {
                    const current = taskDrafts.current.get(task.id) ?? {
                      roundId, taskId: task.id, source, summary, savedSource: source, savedSummary: summary, savedSeq: 0,
                    }
                    current.source = nextSource
                    taskDrafts.current.set(task.id, current)
                    renderDrafts(value => value + 1)
                    void persistTask(current)
                  }}
                />
                : <div className={css.taskAgentSpecReadonly}><MarkdownText text={task.statement} labels={markdownLabels} /></div>}
            </div>
          )}
        </section>
        {(results.length > 0 || taskReview !== undefined || taskFailure || taskWithdrawn) && (
          <section className={css.cellOutput} aria-label={t('cell.output', { task: task.title })} data-cell-output data-collapsed={!outputExpanded || undefined} onClick={openDelivery}>
            <button
              className={css.outputToggle}
              type="button"
              aria-expanded={outputExpanded}
              aria-label={t(outputExpanded ? 'cell.collapseOutput' : 'cell.expandOutput', { task: task.title })}
              onClick={() => {
                setCollapsedOutputs((current) => {
                  const next = new Set(current)
                  if (next.has(outputKey)) next.delete(outputKey)
                  else next.add(outputKey)
                  return next
                })
              }}
            >
              {outputExpanded ? <IconChevronDownOutline14 size={13} /> : <IconChevronRightOutline14 size={13} />}
            </button>
            {outputExpanded && (
              <div className={css.outputContent}>
                <h3>{t('cell.deliverables')}</h3>
                {results.length === 0
                  ? <MarkdownText text={t('cell.noDeliverables')} labels={markdownLabels} />
                  : results.map((result, index) => <MarkdownText key={outputs[index]?.key} text={result.deliverables || t('cell.noDeliverables')} labels={markdownLabels} fileMentions={deliveryFiles} />)}
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  const renderRound = (round: RequirementRoundNode) => {
    const roundId = round.data.roundId
    const document = documents.get(String(roundId))
    const projectedTaskList = taskLists.get(String(roundId))
    const taskList = document !== undefined && projectedTaskList?.data.documentRevision === document.data.revision
      ? projectedTaskList
      : undefined
    const currentTaskIds = new Set(taskList?.data.tasks.map(task => task.id))
    const previousTaskLists = [...latestBy(snapshot.taskLists.filter(node => node.data.roundId === roundId),
      node => String(node.data.documentRevision)).values()]
    const previousTasks = [...latestBy(previousTaskLists.flatMap(node => node.data.tasks), task => String(task.id)).values()]
      .filter(task => !currentTaskIds.has(task.id))
    const clarification = clarifications.get(String(roundId)) ?? []
    const validation = validations.get(String(roundId))
    const roundNotes = (notes.get(String(roundId)) ?? []).filter(note => note.data.kind === 'text')
    const isCollapsed = collapsed.has(String(roundId))
    const roundRegression = (validation?.data.regressions.length ?? 0) > 0
    const activeDocumentDraft = documentDraft?.roundId === roundId ? documentDraft : undefined
    const documentLocked = snapshot.taskExecutions.some(node => node.data.roundId === roundId)
    const roundStatusKey = `round.status.${round.data.status}` as RequirementsKey
    const validationStatusKey = validation === undefined ? undefined : `validation.${validation.data.status}` as RequirementsKey
    return (
      <section className={css.round} data-round-id={String(roundId)} key={String(roundId)}>
        <header className={css.roundHeading}>
          <button className={css.roundToggle} type="button" aria-label={t(isCollapsed ? 'round.expand' : 'round.collapse')} onClick={() => { toggleRound(String(roundId)) }}>
            {isCollapsed ? <IconChevronDownOutline14 size={14} /> : <IconChevronUpOutline14 size={14} />}
          </button>
          <strong>{t('round.label', { round: round.data.round })}</strong>
          <span>{document?.data.summary ?? t('round.summary.pending')}</span>
          <span className={`${css.roundStatus} ${roundRegression ? css.regressionText : ''}`}>{t(roundStatusKey)}</span>
        </header>
        {!isCollapsed && (
          <div className={css.cells}>
            <details className={css.clarificationRecord} data-cell="clarification-record">
              <summary>{t('cell.clarificationRecord')}</summary>
              <div><strong>{t('cell.rawRequirement')}</strong><p>{round.data.input}</p></div>
              {clarification.map(node => (
                <section key={node.key}>
                  <strong>{t('cell.clarificationAttempt', { attempt: node.data.attempt })}</strong>
                  {node.data.questions.map((question) => {
                    const answer = node.data.answers?.find(item => item.id === question.id)
                    const answerText = [...(answer?.selected ?? []), answer?.custom].filter(value => value !== undefined && value !== '').join('；')
                    return <p key={question.id}><b>{question.question}</b>{answerText === '' ? ` · ${t('cell.awaitingAnswer')}` : ` · ${answerText}`}</p>
                  })}
                </section>
              ))}
            </details>
            {document !== undefined && (
              <article className={`${css.cell} ${!document.data.valid ? css.taskFailure : ''}`} data-cell="document" data-status={document.data.valid ? 'completed' : 'failed'}>
                <span className={css.executionMark} data-status={document.data.valid ? 'completed' : 'failed'}>{document.data.valid ? `[${document.data.turn}]` : '[!]'}</span>
                <div className={css.cellGutter}>
                  <button
                    className={css.runButton}
                    type="button"
                    aria-label={t('cell.generateTasks')}
                    aria-busy={round.data.status === 'generating-tasks'}
                    disabled={documentLocked || !document.data.valid || taskList !== undefined || round.data.status === 'generating-tasks' || running !== undefined}
                    onClick={() => { void createTasks(roundId, document.data.revision) }}
                  >
                    {round.data.status === 'generating-tasks' ? <span className={css.spinner} /> : <IconPlayOutline16 size={13} />}
                  </button>
                </div>
                <div className={css.cellBody}>
                  <div className={css.cellTitle}><span>{t('cell.documentType')}</span><strong>{t('cell.requirementDocument')}</strong>
                    {!documentLocked && activeDocumentDraft === undefined && <button className={css.inlineAction} type="button" onClick={() => { setDocumentDraft({ roundId, revision: document.data.revision, source: document.data.markdown }) }}>{t('cell.edit')}</button>}
                  </div>
                  {activeDocumentDraft === undefined
                    ? <div className={css.documentMarkdown}><MarkdownText text={document.data.markdown} labels={markdownLabels} /></div>
                    : <div className={css.documentEditor}>
                      <AutoGrowTextarea aria-label={t('cell.documentContent')} value={activeDocumentDraft.source} onValueChange={(source) => { setDocumentDraft(current => current === undefined ? current : { ...current, source }) }} />
                      <div className={css.editorActions}>
                        <button type="button" disabled={running !== undefined} onClick={() => { void saveDocument(activeDocumentDraft) }}>{t('cell.save')}</button>
                        <button type="button" onClick={() => { setDocumentDraft(undefined) }}>{t('cell.cancel')}</button>
                      </div>
                    </div>}
                  {!document.data.valid && (
                    <ul className={css.taskError}>{document.data.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
                  )}
                </div>
                <span className={css.statusRail} aria-hidden />
              </article>
            )}
            {previousTasks.map(task => renderTask(round, task, true))}
            {taskList?.data.tasks.map(task => renderTask(round, task))}
            {roundNotes.map(note => note.data.kind === 'text' && !note.data.dispatched ? (
              <MarkdownNoteCell
                key={String(note.data.noteId)}
                note={note}
                autoFocus={newNote?.roundId === roundId && newNote.noteId === note.data.noteId}
                editNote={editNote}
                t={t}
              />
            ) : (
              <article
                className={css.noteCell}
                data-cell={note.data.kind}
                data-dispatched={note.data.dispatched || undefined}
                key={note.key}
              >
                <span className={css.executionMark}>[ ]</span>
                <span className={css.noteIcon}>{t('cell.textIcon')}</span>
                <div><strong>{t('cell.text')}</strong><p>{note.data.content}</p></div>
              </article>
            ))}
            {validation !== undefined && (
              <article
                className={`${css.validationCell} ${validation.data.regressions.length > 0 ? css.regression : ''} ${validation.data.status === 'failed' ? css.taskFailure : ''}`}
                data-cell="validation"
                data-status={validation.data.regressions.length > 0 ? 'regression' : validation.data.status}
                onClick={() => { setSelected({ roundId }); setInspector('details') }}
              >
                <span className={css.executionMark} data-status={validation.data.status}>{`[${validationMark(validation.data.status, validation.data.turn)}]`}</span>
                <div className={css.validationIcon}><IconChecklistOutline14 size={14} /></div>
                <div className={css.cellBody}><div className={css.cellTitle}><span>✓</span><strong>{t('cell.validation')}</strong><span className={css.validationStatus}>{validationStatusKey === undefined ? '' : t(validationStatusKey)}</span></div><p>{text(validation.data.summary)}</p>
                  {validation.data.regressions.length > 0 && <ul>{validation.data.regressions.map(item => <li key={`${item.requirementId}:${item.taskId ?? ''}`}>{text(item.reason)}</li>)}</ul>}
                </div>
                <span className={css.statusRail} aria-hidden />
              </article>
            )}
          </div>
        )}
      </section>
    )
  }

  const inspectionRound = selectedRound ?? latestRound
  const inspectorTitle: RequirementsKey = inspector === 'history'
    ? 'details.historyTitle'
    : 'details.title'

  return (
    <div className={css.root} data-conversation-composer-overlay="" ref={rootRef}>
      <div className={css.toolbar} role="toolbar" aria-label={t('toolbar.aria')} data-sticky-toolbar="true">
        <div className={css.commandMenu}>
          <button className={css.commandButton} type="button" aria-expanded={commandOpen} onClick={() => { setCommandOpen(value => !value) }}><IconSearchOutline16 size={12} />{t('toolbar.command')}</button>
          {commandOpen && <div className={css.commandPopover} role="menu">
            <button type="button" role="menuitem" disabled={reviewing} onClick={() => { setCommandOpen(false); void review() }}><IconRefreshOutline14 size={12} />{t('toolbar.review')}</button>
            <button type="button" role="menuitem" onClick={() => { setCollapsed(new Set(orderedRounds.map(round => String(round.data.roundId)))); setCommandOpen(false) }}>{t('toolbar.collapseAll')}</button>
            <button type="button" role="menuitem" onClick={() => { setCollapsed(new Set()); setCommandOpen(false) }}>{t('toolbar.expandAll')}</button>
            <button type="button" role="menuitem" onClick={() => { setLanguage('zh'); setCommandOpen(false) }}>{t('command.useZh')}</button>
            <button type="button" role="menuitem" onClick={() => { setLanguage('en'); setCommandOpen(false) }}>{t('command.useEn')}</button>
          </div>}
        </div>
        <button className={css.toolbarButton} type="button" disabled={latestRound === undefined || currentLatestTaskList === undefined || activeRunAll !== undefined || running !== undefined} onClick={() => {
          if (latestRound === undefined) return
          void insertTask(latestRound.data.roundId)
        }}><span aria-hidden>＋</span>{t('toolbar.code')}</button>
        <button className={css.toolbarButton} type="button" disabled={latestRound === undefined || running !== undefined} onClick={() => {
          if (latestRound === undefined) return
          void insertMarkdownNote(latestRound.data.roundId)
        }}><span aria-hidden>＋</span>{t('toolbar.text')}</button>
        <span className={css.toolbarDivider} />
        {activeRunAll !== undefined
          ? <button className={css.runAllButton} type="button" disabled={activeRunAll.data.status === 'stopping' || running !== undefined} onClick={() => { void stopEverything(activeRunAll.data.roundId) }}>{t(activeRunAll.data.status === 'stopping' ? 'toolbar.stopping' : 'toolbar.stopRunAll')}</button>
          : <button className={css.runAllButton} type="button" disabled={latestRound === undefined || currentLatestTaskList === undefined || running !== undefined} onClick={() => { if (latestRound !== undefined) void runEverything(latestRound.data.roundId) }}><IconPlayOutline16 size={13} />{t('toolbar.runAll')}</button>}
      </div>
      {actionError !== undefined && <div className={css.actionError}>{t('toolbar.actionFailed')} · {actionError}</div>}
      <div className={css.workspaceBody}>
        {orderedRounds.length === 0
          ? (
            <div className={css.empty}>
              <div className={css.emptyMark}><IconSparkle16 size={18} /></div>
              <h2>{t('empty.title')}</h2>
              <p>{t('empty.detail')}</p>
            </div>
          )
          : (
            <main className={css.notebook} data-notebook-scroll style={{ '--notebook-scale': zoom } as CSSProperties}>
              <div className={css.notebookCanvas}>{orderedRounds.map(renderRound)}</div>
              <div className={css.notebookFooter}>
                <div className={css.zoomControls} role="group" aria-label={t('zoom.aria')}>
                  <button type="button" aria-label={t('zoom.out')} disabled={zoom <= 0.85} onClick={() => { setZoom(value => Math.max(.85, Number((value - .05).toFixed(2)))) }}>−</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button type="button" aria-label={t('zoom.in')} disabled={zoom >= 1.2} onClick={() => { setZoom(value => Math.min(1.2, Number((value + .05).toFixed(2)))) }}>＋</button>
                </div>
              </div>
            </main>
          )}
      </div>
      {inspector !== undefined && inspectionRound !== undefined && (
        <aside className={css.details} aria-label={t('details.aria')}>
          <div className={css.detailsHeader}><strong>{t(inspectorTitle)}</strong><button type="button" aria-label={t('details.close')} onClick={() => { setInspector(undefined) }}>×</button></div>
          <div className={css.detailsBody}>
            <p className={css.detailsRound}>{t('round.label', { round: inspectionRound.data.round })} {documents.get(String(inspectionRound.data.roundId))?.data.summary ?? t('round.summary.pending')}</p>
            {inspector === 'details' && (
              <>
                {selectedTask !== undefined ? (
                  <section>
                    <h3>{selectedTask.title}</h3>
                    <p>{taskHumanSummary(selectedTask.title, selectedTask.summary, selectedTask.statement)}</p>
                    <dl>
                      <dt>{t('details.status')}</dt><dd>{t(taskStatusKey(selectedTask.status))}</dd>
                      <dt>{t('details.taskId')}</dt><dd>{selectedTask.id}</dd>
                      {selectedExecution?.data.turn !== undefined && <><dt>{t('details.turn')}</dt><dd>{selectedExecution.data.turn}</dd></>}
                    </dl>
                    {selectedExecution?.data.output !== undefined && <pre>{selectedExecution.data.output}</pre>}
                  </section>
                ) : selectedValidation !== undefined ? (
                  <section>
                    <h3>{t('cell.validation')}</h3>
                    <p>{text(selectedValidation.data.summary)}</p>
                    {selectedValidation.data.regressions.length > 0 && <ul>{selectedValidation.data.regressions.map(item => <li key={`${item.requirementId}:${item.taskId ?? ''}`}>{text(item.reason)}</li>)}</ul>}
                  </section>
                ) : <p>{t('details.noSelection')}</p>}
                <section className={css.evidenceSection}>
                  <h3>{t('details.reviewEvidence')}</h3>
                  {reviewedRequirements.length === 0 ? <p>{t('details.noEvidence')}</p> : reviewedRequirements.map(requirement => (
                    <div className={css.evidenceCard} key={requirement.id}>
                      <strong>{requirement.id} · {text(requirement.title)}</strong>
                      <p>{text(requirement.audit.summary)}</p>
                      <dl><dt>{t('details.audit')}</dt><dd>{requirement.audit.status}</dd></dl>
                      {requirement.sources.length > 0 && <><h4>{t('details.sources')}</h4><ul>{requirement.sources.map(source => <li key={`${requirement.id}:${source.seq}`}>#{source.seq} · {source.kind} · {text(source.summary)}</li>)}</ul></>}
                      {requirement.code.length > 0 && <><h4>{t('details.files')}</h4><ul>{requirement.code.map(link => <li key={`${requirement.id}:${link.path}:${link.startLine ?? ''}`}><code>{link.path}</code> · {link.relation} · {text(link.evidence)}</li>)}</ul></>}
                      {requirement.audit.gaps.length > 0 && <><h4>{t('details.gaps')}</h4><ul>{requirement.audit.gaps.map((gap, index) => <li key={`${requirement.id}:gap:${index}`}>{text(gap)}</li>)}</ul></>}
                    </div>
                  ))}
                </section>
              </>
            )}
            {inspector === 'history' && (
              <section className={css.historyList}>
                {snapshot.reviews.length === 0 ? <p>{t('details.noHistory')}</p> : snapshot.reviews.map(reviewNode => (
                  <article key={reviewNode.key}>
                    <strong>{t('details.reviewTurn', { turn: reviewNode.data.turn })}</strong>
                    <span>{reviewNode.data.status === 'completed' ? t('details.reviewCompleted') : t('details.reviewFailed')}</span>
                    {reviewNode.data.status === 'completed'
                      ? <p>{t('details.requirementCount', { count: reviewNode.data.requirements.length })}</p>
                      : <p>{reviewNode.data.error.message}</p>}
                  </article>
                ))}
              </section>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
