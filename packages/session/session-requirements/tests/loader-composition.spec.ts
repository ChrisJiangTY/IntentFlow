/**
 * REAL-composition proof: a test-only cordis.yml boots the requirement
 * service through the Loader with stand-ins only for external capabilities,
 * then observes its durable round and model-visible analysis prompt.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import SessionRequirements from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function capabilityModule(name: string, service: string, value: unknown): unknown {
  return {
    name,
    apply(ctx: Context) {
      ctx.provide(service, value as never)
    },
  }
}

describe('real Loader composition', () => {
  it('mounts the shipped requirement service and queues ambiguity analysis without Plan mode', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-requirements-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: 'mock-agents'",
      "- name: 'mock-subagents'",
      "- name: 'mock-tools'",
      "- name: 'mock-user-questions'",
      "- name: '@deepseek-ai/dsh-session-requirements'",
      '  config:',
      "    reviewerProvider: 'spawn'",
      '    maxInputChars: 20000',
      '    reviewerTools:',
      "      - 'read'",
      '    maxClarificationRounds: 2',
      '    maxQuestionsPerRound: 5',
      '',
    ].join('\n'))

    const followup = vi.fn<(message: UserMessage) => void>()
    const session = Session.create(SessionId('requirements-composed'))
    const agent = { id: session.id, session, followup } as unknown as Agent
    const tools = new Map<string, ToolDefinition>()
    const modules = new Map<string, unknown>([
      ['mock-agents', capabilityModule('mock-agents', 'agents', { get: (id: SessionId) => id === agent.id ? agent : undefined })],
      ['mock-subagents', capabilityModule('mock-subagents', 'subagents', { start: vi.fn() })],
      ['mock-tools', capabilityModule('mock-tools', 'tools', {
        register: (tool: ToolDefinition) => {
          tools.set(tool.name, tool)
          return () => { tools.delete(tool.name) }
        },
      })],
      ['mock-user-questions', capabilityModule('mock-user-questions', 'userQuestions', { ask: vi.fn() })],
      ['@deepseek-ai/dsh-session-requirements', SessionRequirements],
    ])

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(context.sessionRequirements).toBeInstanceOf(SessionRequirements)

    context.sessionRequirements.startRound(agent, { input: '创建一个登录页面。', language: 'zh' })

    expect(session.events.findLast(event => event.type === 'requirement/round')).toMatchObject({
      data: { input: '创建一个登录页面。', status: 'analyzing' },
    })
    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'clarify_requirements', 'submit_requirements_document', 'submit_requirement_tasks',
    ]))
    const prompt = followup.mock.calls[0]?.[0]?.content[0]
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('判断是否存在必须由用户决定的关键歧义')
    expect(prompt?.type === 'text' ? prompt.text : '').toContain('不要进入 Plan 模式')
  })
})
