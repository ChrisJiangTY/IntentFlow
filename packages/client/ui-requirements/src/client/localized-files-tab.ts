/** Keeps the better-sidebar editor-home tab in the active UI language. */
import type { BetterSidebarService, SidebarState, SidebarTab } from 'dsh-better-sidebar/client/service'

type SidebarLabels = Pick<BetterSidebarService, 'getSnapshot' | 'subscribeState' | 'updateTab'>

function editorHomeTabIds(state: SidebarState, localizedTitle: string, defaultTitles: ReadonlySet<string>): string[] {
  const ids: string[] = []
  const addIfDefault = (tab: SidebarTab): void => {
    if (tab.type === 'editor'
      && tab.path === undefined
      && tab.title !== localizedTitle
      && defaultTitles.has(tab.title)) ids.push(tab.id)
  }
  const visit = (node: SidebarState['splits']): void => {
    if (node.kind === 'leaf') {
      for (const tab of node.tabs) addIfDefault(tab)
      return
    }
    for (const child of node.children) visit(child)
  }
  visit(state.splits)
  visit(state.bottomSplits)
  for (const floating of state.floats) addIfDefault(floating.tab)
  return ids
}

/**
 * Subscribe to the active session's tabs and locale without changing tab
 * selection, panel layout, file-backed tabs, or custom editor-home titles.
 * @param sidebar - better-sidebar's display-field service.
 * @param localizedTitle - current locale's editor-home title.
 * @param subscribeLocale - locale change subscription.
 * @param defaultTitles - built-in translations that identify the upstream seed.
 * @returns both subscription disposers.
 */
export function registerLocalizedFilesTab(
  sidebar: SidebarLabels,
  localizedTitle: () => string,
  subscribeLocale: (listener: () => void) => () => void,
  defaultTitles: readonly string[],
): () => void {
  const recognizedTitles = new Set(defaultTitles)
  let updating = false
  const sync = (): void => {
    if (updating) return
    const state = sidebar.getSnapshot().state
    if (state === undefined) return
    const title = localizedTitle()
    const ids = editorHomeTabIds(state, title, recognizedTitles)
    updating = true
    try {
      for (const id of ids) sidebar.updateTab(id, { title })
    } finally {
      updating = false
    }
  }
  const stopSidebar = sidebar.subscribeState(sync)
  const stopLocale = subscribeLocale(sync)
  sync()
  return () => {
    stopLocale()
    stopSidebar()
  }
}
