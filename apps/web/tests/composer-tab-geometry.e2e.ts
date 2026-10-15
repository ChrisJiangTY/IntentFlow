// Browser geometry for the right Chat input card across the left Chat and
// Trace tabs. The browser must expose layout-consuming scrollbars, and a
// deliberate card displacement keeps equal rectangles from passing vacuously.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, openRightChat, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/composer-tab-geometry', import.meta.url))
/** Records platform-neutral distances between the right card under both left tabs. */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()

/** Long enough that the transcript overflows the lane's 1000px viewport; the scenario asserts the overflow rather than trusting it. */
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'TAB_GEOMETRY',
  title: 'COMPOSER_TAB_GEOMETRY long session',
  turns: 24,
})
const SEED_ID = 'composer-tab-geometry-web-e2e'

/** Wide and narrow viewport widths used to check that the right card stays inside the page. */
const WIDE_VIEWPORT = { width: 1680, height: 1000 }
const NARROW_VIEWPORT = { width: 800, height: 1000 }

/**
 * Resize to one measurement viewport after the responsive sidebar and center
 * column finish their track transition.
 * @param page - the page under test.
 * @param viewport - the viewport dimensions to apply.
 * @param sidebarCollapsed - the sidebar state expected at this width.
 */
async function setMeasuredViewport(
  page: Page,
  viewport: { width: number; height: number },
  sidebarCollapsed: boolean,
): Promise<void> {
  await page.setViewportSize(viewport)
  await page.locator('[data-sidebar-collapsed="true"]').waitFor({
    state: sidebarCollapsed ? 'attached' : 'detached',
    timeout: 10_000,
  })
  await page.locator('[data-conversation-scroll]').evaluate(async (host) => {
    const deadline = performance.now() + 5_000
    let previous = host.getBoundingClientRect().width
    let stableFrames = 0
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
      const current = host.getBoundingClientRect().width
      stableFrames = Math.abs(current - previous) < 0.01 ? stableFrames + 1 : 0
      if (stableFrames >= 3) return
      previous = current
    }
    throw new Error('conversation width did not settle after the viewport changed')
  })
}

/** The left scroller and the single right Chat input card in one selected tab. */
interface TabMetrics {
  gutter: string
  overflowX: string
  overflowY: string
  band: number
  scrolls: boolean
  cardLeft: number
  cardRight: number
  cardWidth: number
  rightPanelLeft: number
  rightPanelRight: number
  cardInsidePanel: boolean
  composerCount: number
  leftComposerCount: number
}

/** One tab's metrics beside the other's, plus the distances between them. */
interface TabComparison {
  chat: TabMetrics
  trajectory: TabMetrics
  leftShift: number
  rightShift: number
  widthShift: number
}

/**
 * Measure the left scroller and the right Chat card in the tab currently shown.
 * @param page - the page under test.
 * @returns the scroller's resolved overflow style and the card's rectangle.
 */
function measureTab(page: Page): Promise<TabMetrics> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (host === null) throw new Error('conversation column scroller not in the DOM')
    const panel = document.querySelector<HTMLElement>('[data-right-chat-panel]')
    const card = panel?.querySelector<HTMLElement>('[data-composer-card]')
    if (panel === null || card === null || card === undefined) throw new Error('right Chat input card is absent')
    const style = getComputedStyle(host)
    const hostRect = host.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    return {
      gutter: style.scrollbarGutter,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      band: hostRect.width - host.clientWidth,
      scrolls: host.scrollHeight > host.clientHeight,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      cardWidth: cardRect.width,
      rightPanelLeft: panelRect.left,
      rightPanelRight: panelRect.right,
      cardInsidePanel: cardRect.left >= panelRect.left && cardRect.right <= panelRect.right,
      composerCount: document.querySelectorAll('[data-composer-card]').length,
      leftComposerCount: host.querySelectorAll('[data-composer-card]').length,
    }
  })
}

/**
 * Show one tab and wait for the view that owns it to be laid out.
 * @param page - the page under test.
 * @param tab - the tab to show.
 */
async function showTab(page: Page, tab: 'Chat' | 'Trace'): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).click()
  if (tab === 'Trace') await page.getByLabel('Trajectory timeline').waitFor({ timeout: 30_000 })
  else await page.locator('[data-conversation-scroll] [data-chat-anchor-key]:visible').first().waitFor({ timeout: 30_000 })
  // Both measurements are taken after a paint, so a rectangle read mid-transition
  // cannot be reported as a shift the cascade did not cause.
  await page.evaluate(() => new Promise<void>((settle) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { settle() }) })
  }))
}

/**
 * Measure both tabs and the distances between them, leaving Chat shown.
 * @param page - the page under test.
 * @returns each tab's metrics and the card's displacement between them.
 */
async function compareTabs(page: Page): Promise<TabComparison> {
  await showTab(page, 'Chat')
  const chat = await measureTab(page)
  await showTab(page, 'Trace')
  const trajectory = await measureTab(page)
  await showTab(page, 'Chat')
  return {
    chat,
    trajectory,
    leftShift: Math.abs(trajectory.cardLeft - chat.cardLeft),
    rightShift: Math.abs(trajectory.cardRight - chat.cardRight),
    widthShift: Math.abs(trajectory.cardWidth - chat.cardWidth),
  }
}

/**
 * Move the right card by 8px only during the Trace measurement, then
 * restore it. This proves the rectangle comparison detects a real displacement.
 * @param page - the page under test.
 * @returns the comparison with the temporary right-card displacement.
 */
async function compareTabsWithCardDisplacement(page: Page): Promise<TabComparison> {
  await showTab(page, 'Chat')
  const chat = await measureTab(page)
  await showTab(page, 'Trace')
  const card = page.locator('[data-right-chat-panel] [data-composer-card]')
  await card.evaluate((element) => { (element as HTMLElement).style.transform = 'translateX(8px)' })
  try {
    const trajectory = await measureTab(page)
    return {
      chat,
      trajectory,
      leftShift: Math.abs(trajectory.cardLeft - chat.cardLeft),
      rightShift: Math.abs(trajectory.cardRight - chat.cardRight),
      widthShift: Math.abs(trajectory.cardWidth - chat.cardWidth),
    }
  } finally {
    await card.evaluate((element) => { (element as HTMLElement).style.removeProperty('transform') })
    await showTab(page, 'Chat')
  }
}

/**
 * Open the seeded session from the sidebar search.
 *
 * Cold summaries carry the temp workspace's basename, so the persisted first
 * message is the stable identity to search for, and the query itself drives the
 * lazy content-index reconciliation. Hand-rolled polling because `expect.poll`
 * is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function openSeededSession(page: Page): Promise<void> {
  // Search collapsed into a header action; expand it before filling.
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  for (;;) {
    if (await results.count() === 1) break
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

/**
 * Render the golden body.
 * @param wide - comparison at the viewport where the card sits at its width cap.
 * @param narrow - comparison at the viewport where the card shrinks with the column.
 * @param control - comparison at the wide viewport with the card displaced.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(wide: TabComparison, narrow: TabComparison, control: TabComparison): string {
  const section = (name: string, comparison: TabComparison): string[] => [
    `## ${name}`,
    '',
    `- Chat: scrollbar-gutter ${comparison.chat.gutter}, overflow ${comparison.chat.overflowX}/${comparison.chat.overflowY}`,
    `- Chat scroller scrolls: ${String(comparison.chat.scrolls)}`,
    `- Chat reserved band: ${String(comparison.chat.band)}px`,
    `- Trace: scrollbar-gutter ${comparison.trajectory.gutter}, overflow ${comparison.trajectory.overflowX}/${comparison.trajectory.overflowY}`,
    `- Trace scroller scrolls: ${String(comparison.trajectory.scrolls)}`,
    `- Trace reserved band: ${String(comparison.trajectory.band)}px`,
    `- right card inside panel: ${String(comparison.chat.cardInsidePanel && comparison.trajectory.cardInsidePanel)}`,
    `- composer cards: ${String(comparison.chat.composerCount)}`,
    `- left composer cards: ${String(comparison.chat.leftComposerCount)}`,
    `- input card left edge moves between tabs: ${String(comparison.leftShift)}px`,
    `- input card right edge moves between tabs: ${String(comparison.rightShift)}px`,
    `- input card width changes between tabs: ${String(comparison.widthShift)}px`,
    '',
  ]
  return [
    '# Right Chat input card across the left Chat and Trace tabs',
    '',
    ...section(`Wide viewport (${String(WIDE_VIEWPORT.width)}px)`, wide),
    ...section(`Narrow viewport (${String(NARROW_VIEWPORT.width)}px)`, narrow),
    ...section('Wide viewport, right card displaced 8px in Trace (control)', control),
  ].join('\n').trimEnd()
}

describe('web e2e: input card position across view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    // Scrollbars must take layout space here or the comparison is vacuous.
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
    page = await newEnglishPage(browser, WIDE_VIEWPORT.height)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
    await openRightChat(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the left scrollbars independent of the right Chat card', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-band'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    // The left Chat transcript overflows, but its reserved scrollbar has no
    // effect on the right Chat card's own panel.
    await expect.poll(async () => (await measureTab(page)).scrolls, { timeout: 10_000 }).toBe(true)
    const comparison = await compareTabs(page)
    expect(comparison.chat.band).toBeGreaterThan(0)
    expect(comparison.chat.gutter).toBe('stable')
    expect(comparison.trajectory.gutter).toBe('auto')
    expect(comparison.trajectory.band).toBe(0)
    expect(comparison.trajectory.overflowY).toBe('auto')
    expect(comparison.trajectory.overflowX).toBe('hidden')
    expect(comparison.trajectory.scrolls).toBe(false)
    expect(comparison.chat.cardInsidePanel).toBe(true)
    expect(comparison.trajectory.cardInsidePanel).toBe(true)
    expect(comparison.chat.composerCount).toBe(1)
    expect(comparison.chat.leftComposerCount).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('holds the input card in place when the tab changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-wide'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const comparison = await compareTabs(page)
    // Switching the left content view must leave the right card in place.
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    expect(comparison.chat.rightPanelLeft).toBe(comparison.trajectory.rightPanelLeft)
    expect(comparison.chat.rightPanelRight).toBe(comparison.trajectory.rightPanelRight)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('holds the right card in place at a narrow viewport', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-narrow'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const comparison = await compareTabs(page)
    expect(comparison.chat.cardLeft).toBeGreaterThanOrEqual(0)
    expect(comparison.chat.cardRight).toBeLessThanOrEqual(NARROW_VIEWPORT.width)
    expect(comparison.chat.cardInsidePanel).toBe(true)
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    expect(comparison.chat.rightPanelLeft).toBe(comparison.trajectory.rightPanelLeft)
    expect(comparison.chat.rightPanelRight).toBe(comparison.trajectory.rightPanelRight)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('detects a deliberate right-card displacement in Trace', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-control'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const comparison = await compareTabsWithCardDisplacement(page)
    expect(comparison.chat.gutter).toBe('stable')
    expect(comparison.chat.band).toBeGreaterThan(0)
    expect(comparison.trajectory.band).toBe(0)
    expect(comparison.leftShift).toBe(8)
    expect(comparison.rightShift).toBe(8)
    expect(comparison.widthShift).toBe(0)
    const restored = await compareTabs(page)
    expect(restored.leftShift).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed tab geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-golden'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const wide = await compareTabs(page)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const narrow = await compareTabs(page)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const control = await compareTabsWithCardDisplacement(page)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(wide, narrow, control), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // The seeded session is generated in-process, so the geometry golden is the
    // whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
