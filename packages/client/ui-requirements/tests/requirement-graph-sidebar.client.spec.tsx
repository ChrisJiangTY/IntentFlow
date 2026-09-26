// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  BetterSidebarService,
  SidebarSnapshot,
  SidebarState,
  TabComponentProps,
  TabDescriptor,
} from 'dsh-better-sidebar/client/service'
import { EMPTY_REQUIREMENTS_SNAPSHOT } from '../src/client/assembly.ts'
import type { RequirementsSnapshot } from '../src/client/contract.ts'
import {
  registerRequirementGraphSidebar,
  REQUIREMENT_GRAPH_TAB_ID,
} from '../src/client/RequirementGraphSidebar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const firstSessionId = 'SESSION-01' as SessionId
const secondSessionId = 'SESSION-02' as SessionId

class TestSource<T> implements ObservableSnapshot<T> {
  readonly listeners = new Set<() => void>()
  unsubscribeCount = 0

  constructor(private value: T) {}

  getSnapshot(): T { return this.value }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      if (this.listeners.delete(listener)) this.unsubscribeCount += 1
    }
  }

  emit(value: T = this.value): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }
}

function sessionList(sessionId: SessionId, title: string): SessionListState {
  const roundId = `ROUND-${sessionId}` as never
  return {
    ids: [sessionId],
    byId: {
      [sessionId]: {
        id: sessionId,
        displayTitle: title,
        running: false,
        blank: false,
        updatedAt: 1,
        projectionValues: {
          requirementGraph: {
            rounds: [{
              roundId,
              round: 1,
              summary: title,
              documentRevision: 1,
              nodes: [{
                requirementId: '1',
                title: `${title}需求`,
                acceptanceRefs: ['1.1'],
                taskIds: [],
                status: 'pending',
              }],
              relations: [],
            }],
          },
        },
      },
    },
    current: sessionId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function sidebarState(graphOpen: boolean, panelOpen = true): SidebarState {
  const tab = {
    id: REQUIREMENT_GRAPH_TAB_ID,
    type: REQUIREMENT_GRAPH_TAB_ID,
    title: '需求图谱',
  }
  return {
    panelOpen,
    splits: graphOpen
      ? {
        kind: 'split',
        id: 'split:right',
        dir: 'row',
        sizes: [.5, .5],
        children: [
          { kind: 'leaf', id: 'pane:first', tabs: [], active: null },
          {
            kind: 'split',
            id: 'split:nested',
            dir: 'col',
            sizes: [1],
            children: [{ kind: 'leaf', id: 'pane:graph', tabs: [tab], active: tab.id }],
          },
        ],
      }
      : { kind: 'leaf', id: 'pane:right', tabs: [], active: null },
    bottomSplits: { kind: 'leaf', id: 'pane:bottom', tabs: [], active: null },
    floats: [],
  } as unknown as SidebarState
}

interface FakeSidebar {
  readonly service: BetterSidebarService
  readonly opens: {
    readonly seed: { readonly type: string }
    readonly scope: { readonly sessionId: string } | undefined
  }[]
  readonly updates: { readonly tabId: string; readonly patch: { readonly meta?: unknown } }[]
  descriptor(): TabDescriptor
  setSession(sessionId: SessionId, graphOpen?: boolean, panelOpen?: boolean): void
  setPanelOpen(open: boolean): void
  panelOpen(): boolean
  listenerCount(): number
  registrationDisposed(): boolean
}

function fakeSidebar(sessionId: SessionId, graphOpen = true, panelOpen = true): FakeSidebar {
  let registered: TabDescriptor | undefined
  let removed = false
  let snapshot = {
    sessionId,
    state: sidebarState(graphOpen, panelOpen),
    prefs: {},
  } as unknown as SidebarSnapshot
  const listeners = new Set<() => void>()
  const opens: FakeSidebar['opens'] = []
  const updates: FakeSidebar['updates'] = []
  const service = {
    registerTab: (descriptor: TabDescriptor) => {
      registered = descriptor
      return () => { removed = true; registered = undefined }
    },
    getSnapshot: () => snapshot,
    subscribeState: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    openTab: (seed: { type: string }, scope?: { sessionId: string }) => {
      opens.push({ seed, scope })
      graphOpen = true
      snapshot = { ...snapshot, state: sidebarState(graphOpen, panelOpen) }
      for (const listener of [...listeners]) listener()
    },
    updateTab: (tabId: string, patch: { meta?: unknown }) => {
      updates.push({ tabId, patch })
      for (const listener of [...listeners]) listener()
    },
  } as unknown as BetterSidebarService
  return {
    service,
    opens,
    updates,
    descriptor: () => {
      if (registered === undefined) throw new Error('requirement graph tab is not registered')
      return registered
    },
    setSession: (nextSessionId, nextGraphOpen = true, nextPanelOpen = true) => {
      graphOpen = nextGraphOpen
      panelOpen = nextPanelOpen
      snapshot = {
        ...snapshot,
        sessionId: nextSessionId,
        state: sidebarState(graphOpen, panelOpen),
      }
      for (const listener of [...listeners]) listener()
    },
    setPanelOpen: (open) => {
      panelOpen = open
      snapshot = { ...snapshot, state: sidebarState(graphOpen, panelOpen) }
      for (const listener of [...listeners]) listener()
    },
    panelOpen: () => panelOpen,
    listenerCount: () => listeners.size,
    registrationDisposed: () => removed,
  }
}

function tabProps(sessionId: SessionId): TabComponentProps {
  return {
    ctx: {} as TabComponentProps['ctx'],
    store: {} as TabComponentProps['store'],
    scope: { sessionId },
    tab: {
      id: REQUIREMENT_GRAPH_TAB_ID,
      type: REQUIREMENT_GRAPH_TAB_ID,
      title: '需求图谱',
    },
    visible: true,
  }
}

it('opens the graph by default for the current Session and keeps it in the visible options', () => {
  const sidebar = fakeSidebar(firstSessionId, false)
  const sessions = new TestSource(sessionList(firstSessionId, '第一会话'))
  const requirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const onSelect = vi.fn()
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor: () => requirements,
    t,
    onSelect,
    onOpenFile: vi.fn(() => true),
  })

  const descriptor = sidebar.descriptor()
  expect(descriptor.id).toBe(REQUIREMENT_GRAPH_TAB_ID)
  expect(descriptor.single).toBe(true)
  expect(descriptor.hidden).not.toBe(true)
  expect(descriptor.order).toBe(15)
  expect(typeof descriptor.icon).toBe('function')
  expect(sidebar.opens).toEqual([{
    seed: { type: REQUIREMENT_GRAPH_TAB_ID },
    scope: { sessionId: firstSessionId },
  }])

  render(<>{descriptor.component(tabProps(firstSessionId))}</>)
  expect(screen.getByRole('button', { name: '查看第 1 轮文档：第一会话' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开 第一会话' }))
  const node = screen.getByRole('button', { name: /需求 1：第一会话需求/u })
  fireEvent.click(node)
  fireEvent.click(screen.getByRole('button', { name: '定位需求工作区' }))
  expect(onSelect).toHaveBeenCalledWith(firstSessionId, expect.objectContaining({ requirementTitle: '第一会话需求' }))
  dispose()
})

it('uses revision-only tab metadata and does not feed unchanged snapshots back into updates', () => {
  const sidebar = fakeSidebar(firstSessionId)
  const sessions = new TestSource(sessionList(firstSessionId, '第一会话'))
  const requirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor: () => requirements,
    t,
    onSelect: vi.fn(),
    onOpenFile: vi.fn(() => true),
  })

  expect(sidebar.updates).toEqual([{
    tabId: REQUIREMENT_GRAPH_TAB_ID,
    patch: { meta: { revision: 1 } },
  }])
  expect(sidebar.opens).toHaveLength(1)
  sessions.emit()
  requirements.emit()
  expect(sidebar.updates).toHaveLength(1)
  expect(sidebar.opens).toHaveLength(1)

  requirements.emit({ ...EMPTY_REQUIREMENTS_SNAPSHOT })
  expect(sidebar.updates).toEqual([
    expect.objectContaining({ patch: { meta: { revision: 1 } } }),
    expect.objectContaining({ patch: { meta: { revision: 2 } } }),
  ])
  expect(sidebar.updates.every(update => Object.keys(update.patch).join() === 'meta')).toBe(true)
  dispose()
})

it('prepares the graph without opening a closed sidebar or refocusing on later state changes', () => {
  const sidebar = fakeSidebar(firstSessionId, false, false)
  const sessions = new TestSource(sessionList(firstSessionId, '第一会话'))
  const requirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor: () => requirements,
    t,
    onSelect: vi.fn(),
    onOpenFile: vi.fn(() => true),
  })

  expect(sidebar.opens).toEqual([{
    seed: { type: REQUIREMENT_GRAPH_TAB_ID },
    scope: { sessionId: firstSessionId },
  }])
  expect(sidebar.panelOpen()).toBe(false)
  sidebar.setPanelOpen(true)
  expect(sidebar.opens).toHaveLength(1)
  requirements.emit({ ...EMPTY_REQUIREMENTS_SNAPSHOT })
  expect(sidebar.opens).toHaveLength(1)
  dispose()
})

it('rebinds the current Session source and removes every subscription on dispose', () => {
  const sidebar = fakeSidebar(firstSessionId)
  const firstSessions = sessionList(firstSessionId, '第一会话')
  const secondSessions = sessionList(secondSessionId, '第二会话')
  const sessions = new TestSource<SessionListState>({
    ...firstSessions,
    ids: [firstSessionId, secondSessionId],
    byId: { ...firstSessions.byId, ...secondSessions.byId },
  })
  const firstRequirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const secondRequirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const sourceFor = vi.fn((id: SessionId) => id === firstSessionId ? firstRequirements : secondRequirements)
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor,
    t,
    onSelect: vi.fn(),
    onOpenFile: vi.fn(() => true),
  })

  expect(firstRequirements.listeners.size).toBe(1)
  sidebar.setSession(secondSessionId)
  expect(firstRequirements.listeners.size).toBe(0)
  expect(firstRequirements.unsubscribeCount).toBe(1)
  expect(secondRequirements.listeners.size).toBe(1)
  expect(sourceFor.mock.calls.map(([id]) => id)).toEqual([firstSessionId, secondSessionId])
  expect(sidebar.opens).toEqual([
    { seed: { type: REQUIREMENT_GRAPH_TAB_ID }, scope: { sessionId: firstSessionId } },
    { seed: { type: REQUIREMENT_GRAPH_TAB_ID }, scope: { sessionId: secondSessionId } },
  ])

  const beforeDispose = sidebar.updates.length
  dispose()
  dispose()
  expect(sidebar.listenerCount()).toBe(0)
  expect(sessions.listeners.size).toBe(0)
  expect(secondRequirements.listeners.size).toBe(0)
  expect(sidebar.registrationDisposed()).toBe(true)
  secondRequirements.emit({ ...EMPTY_REQUIREMENTS_SNAPSHOT })
  sessions.emit({ ...sessions.getSnapshot() })
  expect(sidebar.updates).toHaveLength(beforeDispose)
})

it('resets graph interaction state when the sidebar changes Session', () => {
  const sidebar = fakeSidebar(firstSessionId)
  const firstSessions = sessionList(firstSessionId, '第一会话')
  const secondSessions = sessionList(secondSessionId, '第二会话')
  const sessions = new TestSource<SessionListState>({
    ...firstSessions,
    ids: [firstSessionId, secondSessionId],
    byId: { ...firstSessions.byId, ...secondSessions.byId },
  })
  const requirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor: () => requirements,
    t,
    onSelect: vi.fn(),
    onOpenFile: vi.fn(() => true),
  })
  const descriptor = sidebar.descriptor()
  const view = render(<>{descriptor.component(tabProps(firstSessionId))}</>)
  fireEvent.click(screen.getByRole('button', { name: '放大图谱' }))
  expect(view.container.querySelector('[data-has-selection] > svg')?.parentElement?.style.transform).toBe('scale(1.15)')
  fireEvent.click(screen.getByRole('button', { name: '切换图谱布局' }))
  expect(screen.getByRole('button', { name: '切换图谱布局' }).getAttribute('aria-pressed')).toBe('true')

  sidebar.setSession(secondSessionId)
  view.rerender(<>{descriptor.component(tabProps(secondSessionId))}</>)
  expect(screen.getByRole('button', { name: '查看第 1 轮文档：第二会话' })).toBeTruthy()
  expect(view.container.querySelector('[data-has-selection] > svg')?.parentElement?.style.transform).toBe('scale(1)')
  expect(screen.getByRole('button', { name: '切换图谱布局' }).getAttribute('aria-pressed')).toBe('false')

  sidebar.setSession(firstSessionId)
  view.rerender(<>{descriptor.component(tabProps(firstSessionId))}</>)
  expect(screen.getByRole('button', { name: '查看第 1 轮文档：第一会话' })).toBeTruthy()
  expect(sidebar.opens.map(({ scope }) => scope?.sessionId)).toEqual([
    firstSessionId,
    secondSessionId,
    firstSessionId,
  ])
  dispose()
})

it('waits for the current Session binding without failing client startup', () => {
  const sidebar = fakeSidebar(firstSessionId)
  const sessions = new TestSource(sessionList(firstSessionId, '第一会话'))
  const requirements = new TestSource<RequirementsSnapshot>(EMPTY_REQUIREMENTS_SNAPSHOT)
  let bound = false
  const sourceFor = vi.fn(() => bound ? requirements : undefined)
  const dispose = registerRequirementGraphSidebar({
    sidebar: sidebar.service,
    sessions,
    sourceFor,
    t,
    onSelect: vi.fn(),
    onOpenFile: vi.fn(() => true),
  })

  expect(sidebar.updates).toHaveLength(0)
  expect(requirements.listeners.size).toBe(0)
  bound = true
  sessions.emit({ ...sessions.getSnapshot() })
  expect(requirements.listeners.size).toBe(1)
  expect(sidebar.updates).toEqual([{
    tabId: REQUIREMENT_GRAPH_TAB_ID,
    patch: { meta: { revision: 1 } },
  }])
  dispose()
})
