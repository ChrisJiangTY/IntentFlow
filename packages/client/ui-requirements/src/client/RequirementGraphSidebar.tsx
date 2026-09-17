/** Better Sidebar adapter for the Session-local requirement graph. */

import { IconLinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BetterSidebarService,
  SidebarState,
  TabComponentProps,
} from 'dsh-better-sidebar/client/service'
import type { RequirementsSnapshot } from './contract.ts'
import { RequirementGraphPanel } from './RequirementGraphPanel.tsx'
import {
  sessionRequirementGraph,
  type SessionRequirementGraph,
  type TraceNavigation,
} from './knowledge-graph.ts'
import type { NS } from './locales.ts'

/** Stable Better Sidebar tab type and single-instance tab id. */
export const REQUIREMENT_GRAPH_TAB_ID = 'intentflow:requirement-graph'

/** Dependencies owned by the requirements plugin's apply lifetime. */
export interface RequirementGraphSidebarOptions {
  /** Better Sidebar registry and active-Session state service. */
  readonly sidebar: BetterSidebarService
  /** Global Session-list projection used by the graph join. */
  readonly sessions: ObservableSnapshot<SessionListState>
  /** Resolve the current Session's durable requirements Notebook projection. */
  readonly sourceFor: (sessionId: SessionId) => ObservableSnapshot<RequirementsSnapshot> | undefined
  /** Requirements namespace translator. */
  readonly t: TranslateNS<typeof NS>
  /** Locate a selected requirement or Task in the owning Session's Notebook. */
  readonly onSelect: (sessionId: SessionId, node: TraceNavigation) => void
  /** Open the current file through the sidebar's Session-scoped file viewer. */
  readonly onOpenFile: (sessionId: SessionId, path: string) => boolean
}

type SidebarSplit = SidebarState['splits']

function splitHasTab(node: SidebarSplit, tabId: string): boolean {
  if (node.kind === 'leaf') return node.tabs.some(tab => tab.id === tabId)
  return node.children.some(child => splitHasTab(child, tabId))
}

function stateHasTab(state: SidebarState | undefined, tabId: string): boolean {
  return state !== undefined && (
    splitHasTab(state.splits, tabId)
    || splitHasTab(state.bottomSplits, tabId)
    || state.floats.some(item => item.tab.id === tabId)
  )
}

function emptyGraph(sessions: SessionListState, sessionId: SessionId): SessionRequirementGraph {
  return {
    sessionId,
    title: sessions.byId[sessionId]?.displayTitle ?? '',
    documents: [],
    requirements: [],
    tasks: [],
    files: [],
    edges: [],
  }
}

/**
 * Register the requirement graph as one Better Sidebar `+` option, make it the default tab for each
 * activated Session, and keep that Session's data live. The type-only default open prepares or focuses
 * the graph without expanding a closed sidebar. Later content opens remain focused.
 * Full graph data stays in apply-owned memory; `tab.meta` carries only a revision used to invalidate the
 * sidebar's memoized tab cell.
 * @param options - Sidebar service, graph sources, localization, and Notebook navigation callback.
 * @returns an idempotent disposer that removes the tab and every source subscription.
 */
export function registerRequirementGraphSidebar(options: RequirementGraphSidebarOptions): () => void {
  const { sidebar, sessions, sourceFor, t, onSelect, onOpenFile } = options
  const graphs = new Map<SessionId, SessionRequirementGraph>()
  let activeSessionId: SessionId | undefined
  let activeSource: ObservableSnapshot<RequirementsSnapshot> | undefined
  let previousSessions: SessionListState | undefined
  let previousRequirements: RequirementsSnapshot | undefined
  let revision = 0
  let disposed = false
  let unsubscribeSidebar = (): void => {}
  let unsubscribeSessions = (): void => {}
  let unsubscribeRequirements = (): void => {}

  const publish = (): void => {
    if (disposed || activeSessionId === undefined || activeSource === undefined) return
    const nextSessions = sessions.getSnapshot()
    const nextRequirements = activeSource.getSnapshot()
    if (nextSessions === previousSessions && nextRequirements === previousRequirements) return
    previousSessions = nextSessions
    previousRequirements = nextRequirements
    graphs.set(
      activeSessionId,
      sessionRequirementGraph(nextSessions, nextRequirements, activeSessionId),
    )
    if (!stateHasTab(sidebar.getSnapshot().state, REQUIREMENT_GRAPH_TAB_ID)) return
    revision += 1
    sidebar.updateTab(REQUIREMENT_GRAPH_TAB_ID, { meta: { revision } })
  }

  const bindCurrentSession = (): void => {
    if (disposed) return
    const rawSessionId = sidebar.getSnapshot().sessionId
    // better-sidebar exposes the same durable identity as an unbranded string.
    const nextSessionId = rawSessionId === undefined ? undefined : SessionId(rawSessionId)
    const sessionChanged = nextSessionId !== activeSessionId
    if (sessionChanged) {
      unsubscribeRequirements()
      unsubscribeRequirements = (): void => {}
      activeSessionId = nextSessionId
      activeSource = undefined
      previousSessions = undefined
      previousRequirements = undefined
    }
    if (nextSessionId === undefined) return

    if (sessionChanged) {
      // `openTab` may synchronously notify `subscribeState`. Store the new
      // Session identity first so re-entry binds data without reopening.
      sidebar.openTab({ type: REQUIREMENT_GRAPH_TAB_ID }, { sessionId: nextSessionId })
    }

    if (activeSource === undefined) {
      activeSource = sourceFor(nextSessionId)
      if (activeSource === undefined) return
      unsubscribeRequirements = activeSource.subscribe(publish)
    }
    publish()
  }

  const removeTab = sidebar.registerTab({
    id: REQUIREMENT_GRAPH_TAB_ID,
    title: () => t('graph.title'),
    icon: size => <IconLinkOutline14 size={size} />,
    order: 15,
    single: true,
    component: ({ scope }: TabComponentProps) => {
      const sessionId = SessionId(scope.sessionId)
      const graph = graphs.get(sessionId) ?? emptyGraph(sessions.getSnapshot(), sessionId)
      return (
        <RequirementGraphPanel
          key={sessionId}
          graph={graph}
          onSelect={(node) => { onSelect(sessionId, node) }}
          onOpenFile={path => onOpenFile(sessionId, path)}
          t={t}
        />
      )
    },
  })

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribeSidebar()
    unsubscribeSessions()
    unsubscribeRequirements()
    removeTab()
    graphs.clear()
  }

  try {
    unsubscribeSidebar = sidebar.subscribeState(bindCurrentSession)
    unsubscribeSessions = sessions.subscribe(bindCurrentSession)
    bindCurrentSession()
  } catch (error) {
    dispose()
    throw error
  }
  return dispose
}
