import { expect, it, vi } from 'vitest'
import { createRequirementsComposer } from '../src/client/requirements-composer.ts'

it('routes each right-Chat intent to the selected Session and current authoring language', async () => {
  const sessionId = 'SESSION-01' as never
  let active: 'zh' | 'en' = 'zh'
  const remote = {
    startRound: vi.fn(async () => ({ ok: true })),
    appendRequirement: vi.fn(async () => ({ ok: true })),
    startTaskRound: vi.fn(async () => ({ ok: false })),
  }
  const composer = createRequirementsComposer(remote, () => active)

  expect(await composer.submit(sessionId, '初始需求')).toBe(true)
  expect(remote.startRound).toHaveBeenCalledExactlyOnceWith(sessionId, {
    input: '初始需求', language: 'zh',
  })

  active = 'en'
  expect(await composer.appendRequirement(sessionId, 'Add export')).toBe(true)
  expect(remote.appendRequirement).toHaveBeenCalledExactlyOnceWith(sessionId, {
    input: 'Add export', language: 'en',
  })

  expect(await composer.startTaskRound(sessionId, 'Fix the sidebar')).toBe(false)
  expect(remote.startTaskRound).toHaveBeenCalledExactlyOnceWith(sessionId, {
    input: 'Fix the sidebar', language: 'en',
  })
})
