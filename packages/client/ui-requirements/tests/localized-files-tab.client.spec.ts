import { describe, expect, it } from 'vitest'
import type { SidebarSnapshot, SidebarState, SidebarTab } from 'dsh-better-sidebar/client/service'
import { registerLocalizedFilesTab } from '../src/client/localized-files-tab.ts'
import { en, zh } from '../src/client/locales.ts'

type SidebarLabels = Parameters<typeof registerLocalizedFilesTab>[0]

function tab(id: string, type: string, title: string, path?: string): SidebarTab {
  return { id, type, title, ...(path === undefined ? {} : { path }) }
}

function stateWithTabs(): SidebarState {
  return {
    panelOpen: true,
    width: 400,
    splits: {
      kind: 'split', id: 'right', dir: 'row', sizes: [.5, .5],
      children: [
        { kind: 'leaf', id: 'home', active: 'home', tabs: [
          tab('home', 'editor', 'Files'),
          tab('renamed', 'editor', 'My files'),
          tab('path', 'editor', 'Files', '/work/Files'),
          tab('browser', 'browser', 'Files'),
        ] },
        { kind: 'leaf', id: 'second', active: 'second', tabs: [tab('second', 'editor', 'Files')] },
      ],
    },
    bottomSplits: { kind: 'leaf', id: 'bottom', active: 'bottom', tabs: [tab('bottom', 'editor', 'Files')] },
    floats: [{ id: 'floating', tab: tab('floating', 'editor', 'Files'), x: 12, y: 18, w: 320, h: 240 }],
  } as unknown as SidebarState
}

function replaceTabTitle(state: SidebarState, id: string, title: string): SidebarState {
  const visit = (node: SidebarState['splits']): SidebarState['splits'] => node.kind === 'leaf'
    ? { ...node, tabs: node.tabs.map(item => item.id === id ? { ...item, title } : item) }
    : { ...node, children: node.children.map(visit) }
  return {
    ...state,
    splits: visit(state.splits),
    bottomSplits: visit(state.bottomSplits),
    floats: state.floats.map(item => item.tab.id === id ? { ...item, tab: { ...item.tab, title } } : item),
  }
}

function allTabs(state: SidebarState): SidebarTab[] {
  const items: SidebarTab[] = []
  const visit = (node: SidebarState['splits']): void => {
    if (node.kind === 'leaf') items.push(...node.tabs)
    else node.children.forEach(visit)
  }
  visit(state.splits)
  visit(state.bottomSplits)
  items.push(...state.floats.map(item => item.tab))
  return items
}

function harness() {
  let snapshot = { sessionId: 's1', state: stateWithTabs(), prefs: {} } as SidebarSnapshot
  let language: 'zh' | 'en' = 'zh'
  const sidebarListeners = new Set<() => void>()
  const localeListeners = new Set<() => void>()
  const updates: string[] = []
  const emitSidebar = (): void => { for (const listener of [...sidebarListeners]) listener() }
  const service: SidebarLabels = {
    getSnapshot: () => snapshot,
    subscribeState: (listener) => {
      sidebarListeners.add(listener)
      return () => { sidebarListeners.delete(listener) }
    },
    updateTab: (id, patch) => {
      if (patch.title === undefined || snapshot.state === undefined) return
      updates.push(id)
      snapshot = { ...snapshot, state: replaceTabTitle(snapshot.state, id, patch.title) }
      emitSidebar()
    },
  }
  return {
    service,
    updates,
    title: () => language === 'zh' ? zh['sidebar.filesTab'] : en['sidebar.filesTab'],
    subscribeLocale: (listener: () => void) => {
      localeListeners.add(listener)
      return () => { localeListeners.delete(listener) }
    },
    setLanguage: (next: 'zh' | 'en') => {
      language = next
      for (const listener of [...localeListeners]) listener()
    },
    rename: (id: string, title: string) => {
      snapshot = { ...snapshot, state: replaceTabTitle(snapshot.state!, id, title) }
      emitSidebar()
    },
    nextSession: () => {
      snapshot = { ...snapshot, sessionId: 's2', state: stateWithTabs() }
      emitSidebar()
    },
    snapshot: () => snapshot,
    listenerCounts: () => [sidebarListeners.size, localeListeners.size],
  }
}

describe('better-sidebar editor-home localization', () => {
  const defaultTitles = [zh['sidebar.filesTab'], en['sidebar.filesTab']]

  it('translates only default pathless editor tabs across pane trees and floats', () => {
    const fixture = harness()
    const stop = registerLocalizedFilesTab(
      fixture.service, fixture.title, fixture.subscribeLocale, defaultTitles,
    )
    const state = fixture.snapshot().state!
    expect(Object.fromEntries(allTabs(state).map(item => [item.id, item.title]))).toEqual({
      home: '文件', renamed: 'My files', path: 'Files', browser: 'Files',
      second: '文件', bottom: '文件', floating: '文件',
    })
    expect(fixture.updates).toEqual(['home', 'second', 'bottom', 'floating'])
    expect(state.panelOpen).toBe(true)
    expect(state.width).toBe(400)
    expect(state.splits.kind === 'split' && state.splits.children[0]?.kind === 'leaf'
      ? state.splits.children[0].active : null).toBe('home')
    stop()
  })

  it('follows language and active session changes without overwriting a renamed tab', () => {
    const fixture = harness()
    const stop = registerLocalizedFilesTab(
      fixture.service, fixture.title, fixture.subscribeLocale, defaultTitles,
    )
    fixture.rename('home', 'My workspace')
    fixture.setLanguage('en')
    expect(Object.fromEntries(allTabs(fixture.snapshot().state!).map(item => [item.id, item.title]))).toMatchObject({
      home: 'My workspace', second: 'Files', bottom: 'Files', floating: 'Files',
    })
    fixture.nextSession()
    fixture.setLanguage('zh')
    expect(Object.fromEntries(allTabs(fixture.snapshot().state!).map(item => [item.id, item.title]))).toMatchObject({
      home: '文件', second: '文件', bottom: '文件', floating: '文件',
    })
    stop()
    expect(fixture.listenerCounts()).toEqual([0, 0])
    const updateCount = fixture.updates.length
    fixture.setLanguage('en')
    expect(fixture.updates).toHaveLength(updateCount)
  })
})
