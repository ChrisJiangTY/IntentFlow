// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'IntentFlow')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle="IntentFlow" />)
    expect(document.title).toBe('IntentFlow')
    mounted.rerender(<DocumentTitle title="First title" productTitle="IntentFlow" />)
    expect(document.title).toBe('First title — IntentFlow')
    mounted.rerender(<DocumentTitle title="Revised title" productTitle="IntentFlow" />)
    expect(document.title).toBe('Revised title — IntentFlow')
    mounted.rerender(<DocumentTitle productTitle="IntentFlow" />)
    expect(document.title).toBe('IntentFlow')
    mounted.unmount()
    expect(document.title).toBe('IntentFlow')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', '')
    delete process.env.DSH_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" productTitle="IntentFlow Local Build" />)
    expect(document.title).toBe('First title — IntentFlow Local Build')
    mounted.unmount()
    expect(document.title).toBe('IntentFlow Local Build')
  })
})
