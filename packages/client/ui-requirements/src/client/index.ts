/** Browser requirements plugin: tab, event projection, and review command. */

import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  RequirementRoundStartRequest,
  RequirementRunAllRequest,
  RequirementTaskAddRequest,
  RequirementTaskEditRequest,
  RequirementTaskMoveRequest,
  RequirementTaskWithdrawRequest,
  RequirementTaskRunRequest,
} from '@deepseek-ai/dsh-session-requirements/client'
import { EMPTY_REQUIREMENTS_SNAPSHOT, registerRequirementsAssembly } from './assembly.ts'
import type { RequirementsSnapshot } from './contract.ts'
import { en, NS, zh, type RequirementsKey } from './locales.ts'
import { RequirementsView, type RequirementsViewInjected } from './RequirementsView.tsx'

export type { RequirementsSnapshot, UseRequirements } from './contract.ts'
export type { RequirementsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Requirement evolution and independent review copy. */
    requirements: RequirementsKey
  }
}

/** Required services for the view slot, Session event assembly, commands, and locale. */
export const inject = ['slots', 'remote', 'remote.commands', 'remote.sessionRequirements', 'uiConversation', 'locale']

/** Register the requirements tab and its Session-scoped data source. */
export function apply(ctx: Context): void {
  const sources = new Map<SessionId, ObservableSnapshot<RequirementsSnapshot>>()
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
      const target = ctx.uiConversation.binding(sessionId).target('requirements')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_REQUIREMENTS_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      sources.set(sessionId, source)
    }
    return source
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-requirements: dictionaries')
  registerRequirementsAssembly(ctx)
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'requirements',
    order: 20,
    locale: NS,
    label: () => t('view.requirements'),
    inject: (sessionId: SessionId): RequirementsViewInjected => ({
      hooks: { requirements: sourceFor(sessionId) },
      initialLanguage: ctx.locale.getLocale().active === 'zh' ? 'zh' : 'en',
      startRound: async (request: RequirementRoundStartRequest) => {
        const result = await ctx.remote.sessionRequirements.startRound(sessionId, request)
        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
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
