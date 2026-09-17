/** Browser requirements plugin: tab, event projection, and review command. */

import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from 'dsh-better-sidebar'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarState } from 'dsh-better-sidebar/client/service'
import type {
  RequirementDocumentEditRequest,
  RequirementRoundStartRequest,
  RequirementRunAllRequest,
  RequirementRunAllStopRequest,
  RequirementTaskGenerateRequest,
  RequirementTaskAddRequest,
  RequirementTaskEditRequest,
  RequirementTaskMoveRequest,
  RequirementTaskWithdrawRequest,
  RequirementTaskRunRequest,
  RequirementNotebookProjection,
} from '@deepseek-ai/dsh-session-requirements/client'
import { EMPTY_REQUIREMENTS_SNAPSHOT, notebookSnapshot, registerRequirementsAssembly } from './assembly.ts'
import type { RequirementsSnapshot } from './contract.ts'
import { en, NS, zh, type RequirementsKey } from './locales.ts'
import { registerRequirementGraphSidebar } from './RequirementGraphSidebar.tsx'
import { RequirementsView, type RequirementsViewInjected } from './RequirementsView.tsx'
import type { TraceNavigation } from './knowledge-graph.ts'

export type { RequirementsSnapshot, UseRequirements } from './contract.ts'
export type { RequirementsKey } from './locales.ts'

function splitHasDeliveryUrl(node: SidebarState['splits'], url: string): boolean {
  if (node.kind === 'leaf') return node.tabs.some(tab => tab.type === 'browser' && tab.path === url)
  return node.children.some(child => splitHasDeliveryUrl(child, url))
}

function stateHasDeliveryUrl(state: SidebarState | undefined, url: string): boolean {
  return state !== undefined && (
    splitHasDeliveryUrl(state.splits, url)
    || splitHasDeliveryUrl(state.bottomSplits, url)
    || state.floats.some(item => item.tab.type === 'browser' && item.tab.path === url)
  )
}

function activateRequirementsView(label: string): void {
  if (typeof document === 'undefined') return
  const tab = [...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')]
    .find(candidate => candidate.textContent.trim() === label)
  tab?.click()
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Requirement evolution and independent review copy. */
    requirements: RequirementsKey
  }
}

/** Required services for the view slot, Session event assembly, commands, and locale. */
export const inject = ['slots', 'remote', 'remote.commands', 'remote.sessionRequirements', 'sessions', 'uiConversation', 'locale', 'betterSidebar']

/** Register the requirements tab and its Session-scoped data source. */
export function apply(ctx: Context): void {
  const sources = new Map<SessionId, ObservableSnapshot<RequirementsSnapshot>>()
  const graphRevealers = new Map<SessionId, (node: TraceNavigation) => void>()
  const pendingGraphReveals = new Map<SessionId, TraceNavigation>()
  const openSidebarFile = (sessionId: SessionId, file: string): boolean => {
    if (ctx.betterSidebar.getTab('editor') === undefined || !ctx.betterSidebar.isTabEnabled('editor')) return false
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    let path = file
    if (!/^(?:[\\/]|[a-z]:[\\/])/i.test(file)) {
      if (cwd === undefined || cwd === '') return false
      path = `${cwd.replace(/[\\/]+$/, '')}/${file}`
    }
    ctx.betterSidebar.openFile({ sessionId, ...(cwd === undefined ? {} : { cwd }) }, path)
    return true
  }
  ctx.provide('requirementsComposer', {
    submit: async (sessionId: SessionId, input: string): Promise<boolean> => {
      const result = await ctx.remote.sessionRequirements.startRound(sessionId, {
        input,
        language: ctx.locale.getLocale().active === 'zh' ? 'zh' : 'en',
      })
      return result.ok
    },
  })
  const sourceFor = (sessionId: SessionId): ObservableSnapshot<RequirementsSnapshot> => {
    let source = sources.get(sessionId)
    if (source === undefined) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`Notebook Session ${sessionId} has no binding`)
      const target = binding.session.projections.faceOf('requirementNotebook')
      let previous: RequirementNotebookProjection | undefined
      let snapshot = EMPTY_REQUIREMENTS_SNAPSHOT
      source = {
        getSnapshot: () => {
          const value = target.getSnapshot() as RequirementNotebookProjection | undefined
          if (value !== previous) {
            previous = value
            snapshot = notebookSnapshot(value)
          }
          return snapshot
        },
        subscribe: listener => target.subscribe(listener),
      }
      sources.set(sessionId, source)
    }
    return source
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-requirements: dictionaries')
  registerRequirementsAssembly(ctx)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const dispose = registerRequirementGraphSidebar({
      sidebar: ctx.betterSidebar,
      sessions: ctx.sessions.list,
      sourceFor: sessionId => ctx.sessions.binding(sessionId) === undefined ? undefined : sourceFor(sessionId),
      t,
      onOpenFile: openSidebarFile,
      onSelect: (sessionId, node) => {
        const reveal = graphRevealers.get(sessionId)
        if (reveal !== undefined) {
          pendingGraphReveals.delete(sessionId)
          reveal(node)
          return
        }
        pendingGraphReveals.set(sessionId, node)
        activateRequirementsView(t('view.requirements'))
      },
    })
    return () => {
      dispose()
      graphRevealers.clear()
      pendingGraphReveals.clear()
    }
  }, 'ui-requirements: requirement graph sidebar')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'requirements',
    order: 20,
    locale: NS,
    label: () => t('view.requirements'),
    inject: (sessionId: SessionId): RequirementsViewInjected => ({
      hooks: { requirements: sourceFor(sessionId) },
      openDeliveryFile: file => openSidebarFile(sessionId, file),
      openDeliveryUrl: (rawUrl) => {
        if (typeof document === 'undefined'
          || document.querySelector('[data-dsh-better-sidebar]') === null
          || ctx.betterSidebar.getTab('browser') === undefined
          || !ctx.betterSidebar.isTabEnabled('browser')) return false
        const url = new URL(rawUrl)
        ctx.betterSidebar.openTab({ type: 'browser', title: url.hostname, url: url.href }, { sessionId })
        const snapshot = ctx.betterSidebar.getSnapshot()
        return snapshot.sessionId === sessionId && stateHasDeliveryUrl(snapshot.state, url.href)
      },
      bindGraphReveal: (listener) => {
        graphRevealers.set(sessionId, listener)
        const pending = pendingGraphReveals.get(sessionId)
        if (pending !== undefined) {
          pendingGraphReveals.delete(sessionId)
          listener(pending)
        }
        return () => {
          if (graphRevealers.get(sessionId) === listener) graphRevealers.delete(sessionId)
        }
      },
      initialLanguage: ctx.locale.getLocale().active === 'zh' ? 'zh' : 'en',
      startRound: async (request: RequirementRoundStartRequest) => {
        const result = await ctx.remote.sessionRequirements.startRound(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      editDocument: async (request: RequirementDocumentEditRequest) => {
        const result = await ctx.remote.sessionRequirements.editDocument(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      generateTasks: async (request: RequirementTaskGenerateRequest) => {
        const result = await ctx.remote.sessionRequirements.generateTasks(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      stopTask: async (request: RequirementTaskRunRequest) => {
        const result = await ctx.remote.sessionRequirements.stopTask(sessionId, request)
        return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
      },
      runTask: async (request: RequirementTaskRunRequest) => {
        const result = await ctx.remote.sessionRequirements.runTask(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      runAll: async (request: RequirementRunAllRequest) => {
        const result = await ctx.remote.sessionRequirements.runAll(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      stopRunAll: async (request: RequirementRunAllStopRequest) => {
        const result = await ctx.remote.sessionRequirements.stopRunAll(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      addTask: async (request: RequirementTaskAddRequest) => {
        const result = await ctx.remote.sessionRequirements.addTask(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      editTask: async (request: RequirementTaskEditRequest) => {
        const result = await ctx.remote.sessionRequirements.editTask(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      moveTask: async (request: RequirementTaskMoveRequest) => {
        const result = await ctx.remote.sessionRequirements.moveTask(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      withdrawTask: async (request: RequirementTaskWithdrawRequest) => {
        const result = await ctx.remote.sessionRequirements.withdrawTask(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      addNote: async (request) => {
        const result = await ctx.remote.sessionRequirements.addNote(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      editNote: async (request) => {
        const result = await ctx.remote.sessionRequirements.editNote(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      },
      requestReview: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/requirements', [])
        if (!result.ok) return result.error.message
        if (result.value === undefined) return 'unknown command: /requirements'
        return result.value.result.kind === 'error' ? result.value.result.text : undefined
      },
    }),
  }, RequirementsView))
}
