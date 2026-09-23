// Web e2e scenarios: navigation & panes — the Trajectory view and timing
// overview, the bilingual Requirements view, its local details inspector, and sidebar search, all over ONE rich
// two-turn seeded fixture rendered purely from the log (the seeded-history
// pattern: zero model calls in replay, so every surface here is the client
// fold + host history RPC, not replay binding). The seed is recorded live
// under the standard discipline: turn 1 produces a bash call plus two
// parallel reads in one assistant message (tool-call density for the
// trajectory ledger/timing lanes), turn 2 a markdown-rich reply.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page, Response } from 'playwright'
import { chromium } from 'playwright'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/navigation-panes', import.meta.url))
const SEED = join(SNAPSHOT_DIR, 'session.jsonl')
const TRAJECTORY_EXPECTED = join(SNAPSHOT_DIR, 'trajectory.expected.md')
const SEARCH_EXPECTED = join(SNAPSHOT_DIR, 'search-results.expected.md')
const TERMINAL_EXPECTED = join(SNAPSHOT_DIR, 'terminal-card.expected.md')
const REQUIREMENTS_EN_EXPECTED = join(SNAPSHOT_DIR, 'requirements-en.expected.md')
const REQUIREMENTS_ZH_EXPECTED = join(SNAPSHOT_DIR, 'requirements-zh.expected.md')
const REQUIREMENTS_DRAFT_EXPECTED = join(SNAPSHOT_DIR, 'requirements-draft.expected.md')
const REQUIREMENTS_NOTE_EXPECTED = join(SNAPSHOT_DIR, 'requirements-markdown-note.expected.md')
const REQUIREMENTS_RESTORED_EXPECTED = join(SNAPSHOT_DIR, 'requirements-restored.expected.md')
const REQUIREMENTS_GRAPH_EXPECTED = join(SNAPSHOT_DIR, 'requirements-graph.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'navigation-panes-web-e2e'

// Turn 1 leads with a distinctive word: the session-title fallback takes the
// first words of the first message, so the sidebar-search scenario has a
// known-matching query ('navscenario') without depending on a live title call.
const PROMPT_TURN1 = 'NavScenario: first run bash to print exactly NAVIGATION_OK, then read nav-a.md and nav-b.md using two read calls in ONE assistant message, then reply with the single word FIRST_DONE and stop.'
const PROMPT_TURN2 = 'Reply in markdown with: a level-2 heading "Navigation Summary", a bulleted list of exactly two items, and a fenced code block containing echo WATERFALL. Then stop.'

async function baselineResponse(
  page: Page,
): Promise<Response> {
  return page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/session/list'
  ), { timeout: 30_000 })
}

async function assertBaselineSucceeded(response: Response, method: string): Promise<void> {
  expect(response.ok(), `${method} baseline HTTP response`).toBe(true)
  const body = await response.json() as { result?: { ok?: unknown } }
  expect(body.result?.ok, `${method} baseline RPC result`).toBe(true)
}

async function ensureSeedOpen(page: Page): Promise<void> {
  const welcome = page.locator('[class*="onboardingOverlay"]')
  if (await welcome.count() > 0) {
    await welcome.getByRole('button').click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
  }
  const chat = page.getByRole('tab', { name: 'Chat', exact: true })
  // Search is a collapsed header action; expand it so the input is actionable.
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByPlaceholder('Search sessions', { exact: false })
  if (await chat.count() === 0) {
    await search.fill('WATERFALL')
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => result.count(), { timeout: 15_000 }).toBe(1)
    await result.click()
    await chat.waitFor({ timeout: 15_000 })
  }
  await chat.click()
  await page.getByText('FIRST_DONE', { exact: true }).waitFor({ timeout: 15_000 })
  if (await search.inputValue() !== '') {
    await search.fill('')
    await expect.poll(() => search.inputValue(), { timeout: 5_000 }).toBe('')
  }
}

describe('web e2e: navigation & panes over a rich seeded session', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole> = { warnings: [], pageErrors: [] }
  let slotErrors: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The workspace-aware flow runs sessions in <workspaceCwd>/workspace;
    // the read targets must live in that session cwd (pre-creation is safe
    // because the picker adopts an existing directory by path).
    const sessionCwd = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(sessionCwd, { recursive: true })
    await writeFile(join(sessionCwd, 'nav-a.md'), '# alpha nav\n')
    await writeFile(join(sessionCwd, 'nav-b.md'), '# beta nav\n')
    if (MODE !== 'record') {
      const raw = await readFile(SEED, 'utf8')
      expect(fixtureUserPrompts(raw), 'seed fixture must carry exactly the two drive prompts')
        .toEqual([PROMPT_TURN1, PROMPT_TURN2])
      await seedSession(scaffold, raw, SEED_ID)
    }
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  }, 120_000)

  beforeEach(async () => {
    page = await newEnglishPage(browser, 1000, MODE === 'record' ? 'chat' : 'product-default')
    tripwire = watchConsole(page)
    slotErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error' && /slot entry crashed/i.test(message.text())) {
        slotErrors.push(message.text())
      }
    })
    // Arm before navigation so the Session response cannot be missed. The
    // Workspace stream settles through the user-visible Ungrouped barrier.
    const sessionBaseline = baselineResponse(page)
    const [, sessionResponse] = await Promise.all([
      page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' }),
      sessionBaseline,
    ])
    await assertBaselineSucceeded(sessionResponse, 'session.list')
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The frame mounts before the asynchronous session-list baseline lands.
    // Search must target the settled seeded row, not the startup input that
    // the ready projection replaces (the compact layout dropped group session
    // counts; the Ungrouped bucket row is the barrier).
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterEach(async () => {
    const failures: unknown[] = []
    try {
      expect({
        pageErrors: tripwire.pageErrors,
        slotErrors,
        warnings: tripwire.warnings,
      }).toEqual({
        pageErrors: [],
        slotErrors: [],
        warnings: [],
      })
    } catch (error) {
      failures.push(error)
    }
    await page?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'navigation case cleanup failed')
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'navigation e2e cleanup failed')
  })

  it.skipIf(MODE !== 'record')('records the two-turn seed live through the composer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-record'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    let sessionId: Awaited<ReturnType<WebScaffold['whenTurnSettled']>> | undefined
    for (const prompt of [PROMPT_TURN1, PROMPT_TURN2]) {
      const settled = scaffold.whenTurnSettled()
      // Turn 2 types into the same composer once turn 1 unlocks it.
      await expect.poll(() => input.isEnabled(), { timeout: 15_000 }).toBe(true)
      await input.fill(prompt)
      await input.press('Enter')
      sessionId = await settled
    }
    await recordFixture(scaffold, sessionId!, SEED)
    // Fixture honesty: the recording must contain the events the replay
    // scenarios assert on: three calls in turn 1 and two closed turns.
    const recorded = parseSessionLog(await readFile(SEED, 'utf8'))
    expect(recorded.filter(e => e.type === 'turn/end')).toHaveLength(2)
    const calls = recorded.filter((e): e is SessionEvent & { data: { name: string } } => e.type === 'tool/call')
    expect(calls.map(e => e.data.name).sort()).toEqual(['bash', 'read', 'read'])
  }, 400_000)

  it.skipIf(MODE === 'record')('finds an unopened seeded session by message content and opens it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-search'))
    // The API baselines can settle before React commits their projection. The
    // seeded Ungrouped bucket row is the final user-visible barrier before
    // editing search (the compact layout dropped group session counts).
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
    // Search is a collapsed header action; expand it so the input is actionable.
    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
    const search = page.getByPlaceholder('Search sessions', { exact: false })
    // The cold row has not been opened, so only the persisted log can satisfy
    // this query. First search lazily reconciles the SQLite content index.
    await search.fill('zzzqx-no-such-session')
    await page.getByText('No matching sessions').waitFor({ timeout: 30_000 })
    await expect.poll(
      () => page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').count(),
      { timeout: 10_000 },
    ).toBe(0)

    await search.fill('WATERFALL')
    const resultTree = page.getByRole('tree', { name: 'Search results' })
    const result = resultTree.getByRole('treeitem')
    await expect.poll(() => result.count(), { timeout: 30_000 }).toBe(1)
    await expect.poll(() => result.getByText('WATERFALL', { exact: false }).count(), {
      timeout: 10_000,
    }).toBeGreaterThanOrEqual(1)
    const snapshot = (await captureStableAria(page, '[class*="listArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(SEARCH_EXPECTED, snapshot, MODE)

    await result.click()
    // Search navigation addresses the session, not a specific event, and the
    // query remains until the user explicitly clears it.
    await expect.poll(() => search.inputValue(), { timeout: 5_000 }).toBe('WATERFALL')
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await expect.poll(() => page.getByText('FIRST_DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => page.getByRole('heading', { name: 'Navigation Summary' }).count(), { timeout: 15_000 }).toBe(1)
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.poll(() => search.inputValue(), { timeout: 5_000 }).toBe('')
    await expect.poll(() => page.locator('[role="treeitem"]').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  }, 90_000)

  it.skipIf(MODE === 'record')('opens a Session in the Requirements view by default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-default-requirements'))
    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count() > 0) {
      await welcome.getByRole('button').click()
      await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    }
    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
    const search = page.getByPlaceholder('Search sessions', { exact: false })
    await search.fill('WATERFALL')
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => result.count(), { timeout: 15_000 }).toBe(1)
    await result.click()

    const requirements = page.getByRole('tab', { name: 'Requirements', exact: true })
    await requirements.waitFor({ timeout: 15_000 })
    await expect.poll(() => requirements.getAttribute('aria-selected'), { timeout: 15_000 }).toBe('true')
    await page.getByRole('toolbar', { name: 'Requirements view toolbar' }).waitFor({ timeout: 15_000 })
  }, 60_000)

  it.skipIf(MODE === 'record')('renders the trajectory ledger and opens its local record inspector', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-trajectory'))
    await ensureSeedOpen(page)
    await page.getByRole('tab', { name: 'Trajectory' }).click()
    await page.waitForTimeout(100)
    const overlayLayout = await page.getByRole('table').evaluate((table) => {
      const host = table.closest('[data-conversation-scroll]')
      const seat = host?.querySelector('[data-composer-seat]') ?? null
      const pane = table.parentElement
      return {
        hostPosition: host === null ? null : getComputedStyle(host).position,
        paneOverflowX: pane === null ? null : getComputedStyle(pane).overflowX,
        paneScrollableWidth: pane === null ? null : pane.scrollWidth - pane.clientWidth,
        seatPosition: seat === null ? null : getComputedStyle(seat).position,
      }
    })
    expect(overlayLayout).toEqual({
      hostPosition: 'relative',
      paneOverflowX: 'hidden',
      paneScrollableWidth: 0,
      seatPosition: 'absolute',
    })
    expect({
      pageErrors: tripwire.pageErrors,
      slotErrors,
      warnings: tripwire.warnings,
    }).toEqual({
      pageErrors: [],
      slotErrors: [],
      warnings: [],
    })
    // Turn rules partition the ledger without restoring a separate header row.
    await expect.poll(() => page.locator('tr[data-turn-start="true"]').count(), { timeout: 15_000 }).toBe(2)
    await expect.poll(() => page.getByRole('columnheader').count(), { timeout: 10_000 }).toBe(0)
    await page.locator('tr[data-kind="tool"]').first().click()
    const details = page.getByRole('complementary', { name: 'Event details' })
    await expect.poll(() => details.count(), { timeout: 10_000 }).toBe(1)
    expect(await details.getByRole('tabpanel').evaluate(panel => getComputedStyle(panel).overflowX))
      .toBe('hidden')
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const darkSummarySurfaces = await details.getByRole('heading', { name: 'Payload' }).evaluate(heading => ({
      heading: getComputedStyle(heading).backgroundColor,
      panel: getComputedStyle(heading.closest('[aria-label="Event details"]')!).backgroundColor,
    }))
    expect(darkSummarySurfaces.heading).toBe(darkSummarySurfaces.panel)
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    await page.getByRole('tab', { name: 'Result' }).click()
    await expect.poll(() => page.getByText('NAVIGATION_OK', { exact: false }).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    const assistantSpan = page.locator('[data-timeline-span="message"][data-assistant-timing="true"]').first()
    await assistantSpan.hover()
    const timingTooltip = page.getByRole('tooltip')
    await timingTooltip.waitFor({ timeout: 5_000 })
    await expect.poll(() => timingTooltip.textContent(), { timeout: 5_000 }).toMatch(/TTFT .* Decoding/)
    const assistantTimingStyle = await assistantSpan.evaluate(node => ({
      background: getComputedStyle(node).backgroundImage,
      ttft: getComputedStyle(node).getPropertyValue('--trajectory-assistant-ttft'),
    }))
    expect(assistantTimingStyle.background).toContain('linear-gradient')
    expect(assistantTimingStyle.ttft).toMatch(/%$/)
    const snapshot = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(TRAJECTORY_EXPECTED, snapshot, MODE)
    await details.getByRole('button', { name: 'Close details' }).click()
  }, 60_000)

  it.skipIf(MODE === 'record')('renders the requirement Notebook path and its top-only cell insertion', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-requirements'))
    await ensureSeedOpen(page)
    const session = scaffold.ctx.sessions.get(SessionId(SEED_ID))
    if (session === undefined) throw new Error('opened navigation seed is not attached')
    const roundId = 'ROUND-WEB-01' as never
    const completedTaskId = 'TASK-WEB-01' as never
    const failedTaskId = 'TASK-WEB-02' as never
    const finalTaskId = 'TASK-WEB-FINAL' as never
    const sourceMessageId = 'requirements-source-message' as never
    session.append('requirement/round', {
      version: 1,
      revision: 1,
      roundId,
      round: 1,
      sourceMessageId,
      language: 'en',
      input: 'Build a navigation HTML page, preserve the existing behavior, and validate it.',
      status: 'completed',
      turn: 2,
    })
    session.append('requirement/clarification', {
      version: 1,
      revision: 1,
      roundId,
      attempt: 1,
      status: 'answered',
      questions: [{ id: 'scope', question: '本次是否只修改导航页面？' }],
      answers: [{ id: 'scope', selected: ['是，只修改导航页面'] }],
    })
    session.append('requirement/document', {
      version: 1,
      revision: 1,
      roundId,
      turn: 2,
      summary: '构建并验证导航页面',
      markdown: '# 需求文档\n\n## 简介\n\n构建并验证导航页面，同时保留现有行为。\n\n## 需求\n\n### 需求 1：导航页面\n\n**用户故事：** 作为用户，我希望使用清晰的导航页面，以便访问主要功能。\n\n#### 验收标准\n\n1. 当页面打开时，系统应当显示导航内容。\n2. 当视口缩小至移动端时，系统应当保持导航可用。',
      valid: true,
      issues: [],
    })
    session.append('requirement/graph', {
      version: 1,
      revision: 1,
      roundId,
      documentRevision: 1,
      nodes: [{ requirementId: '1', title: '导航页面', acceptanceRefs: ['1.1', '1.2'] }],
      relations: [],
    })
    session.append('requirement/task-list', {
      version: 1,
      revision: 1,
      roundId,
      documentRevision: 1,
      tasks: [{
        id: completedTaskId,
        order: 0,
        kind: 'implementation',
        title: 'Build navigation HTML',
        summary: 'Users can navigate the page with a clear, complete layout.',
        statement: 'Implement the requested navigation in index.html.\n\n_关联需求：1.1_',
        requirementRefs: ['1.1'],
        status: 'completed',
      }, {
        id: failedTaskId,
        order: 1,
        kind: 'checkpoint',
        title: 'Check mobile navigation',
        summary: 'Mobile navigation remains usable at the target breakpoint.',
        statement: 'Verify the navigation at the mobile breakpoint.\n\n_关联需求：1.2_',
        requirementRefs: ['1.2'],
        status: 'failed',
      }, {
        id: finalTaskId,
        order: 2,
        kind: 'final-test',
        title: 'Final Test',
        summary: 'The complete navigation experience meets every acceptance criterion.',
        statement: 'Run the complete navigation test set and verify every acceptance criterion.\n\n_关联需求：1.1、1.2_',
        requirementRefs: ['1.1', '1.2'],
        status: 'pending',
      }],
    })
    session.append('requirement/task-execution', {
      version: 1,
      revision: 1,
      roundId,
      taskId: completedTaskId,
      messageId: 'requirements-task-message-1' as never,
      status: 'completed',
      turn: 2,
      output: 'Implemented index.html and preserved the current navigation behavior.',
    })
    session.append('requirement/task-execution', {
      version: 1,
      revision: 1,
      roundId,
      taskId: failedTaskId,
      messageId: 'requirements-task-message-2' as never,
      status: 'failed',
      turn: 3,
      output: 'Checking mobile viewport.\n\n## Deliverables\n\nNo mobile layout delivered.\n\n## Verification\n\nInternal viewport assertions.\n\n## Notes\n\nThe mobile breakpoint needs another pass.',
    })
    session.append('requirement/note', {
      version: 1,
      roundId,
      noteId: 'NOTE-WEB-01' as never,
      kind: 'text',
      content: 'Keep the existing DSH conversation controls visible.',
      dispatched: false,
    })
    session.append('requirement/note', {
      version: 1, roundId, noteId: 'COMMENT-WEB-01' as never,
      kind: 'comment', content: 'Hidden Notebook comment', dispatched: true,
    })
    session.append('requirement/validation', {
      version: 1,
      revision: 1,
      roundId,
      turn: 2,
      reviewedThroughSeq: session.events.at(-1)?.seq ?? -1,
      status: 'completed',
      summary: {
        zh: 'HTML 已生成；移动端检查仍有一个普通执行失败，但没有历史需求回归。',
        en: 'The HTML was generated; one ordinary mobile check failed, with no historical requirement regression.',
      },
      regressions: [],
      failedTaskIds: [failedTaskId],
    })
    session.append('requirement/review', {
      version: 2,
      status: 'completed',
      turn: 2,
      reviewedThroughSeq: session.events.at(-1)?.seq ?? -1,
      reviewerSessionId: SessionId('navigation-requirements-reviewer'),
      requirements: [{
        id: 'R1',
        title: { zh: '导航结果必须清晰可读', en: 'Navigation results must be easy to read' },
        statement: {
          zh: '最终回复必须用标题、两项列表和代码块清晰呈现导航结果。',
          en: 'The final reply must present the navigation results clearly with a heading, two list items, and a code block.',
        },
        lifecycle: 'active',
        change: 'added',
        sources: [{
          seq: 204,
          kind: 'user',
          summary: { zh: '用户明确指定了最终回复的结构。', en: 'The user explicitly specified the final response structure.' },
        }],
        code: [{
          path: 'nav-a.md',
          startLine: 1,
          endLine: 1,
          relation: 'touches',
          evidence: { zh: '第一项导航内容来自该文件。', en: 'The first navigation item comes from this file.' },
        }, {
          path: 'nav-b.md',
          startLine: 1,
          endLine: 1,
          relation: 'touches',
          evidence: { zh: '第二项导航内容来自该文件。', en: 'The second navigation item comes from this file.' },
        }],
        audit: {
          status: 'verified',
          summary: {
            zh: '录制回复包含所需标题、恰好两个列表项和指定代码块。',
            en: 'The recorded reply contains the required heading, exactly two list items, and the specified code block.',
          },
          gaps: [],
        },
      }],
    })
    await page.getByRole('tab', { name: 'Requirements' }).click()
    const notebook = page.locator('[data-notebook-scroll]')
    const latestCell = notebook.locator('[data-round-id="ROUND-WEB-01"] [data-cell="validation"]')
    await expect.poll(() => latestCell.evaluate((cell) => {
      const notebookBounds = cell.closest('[data-notebook-scroll]')!.getBoundingClientRect()
      const cellBounds = cell.getBoundingClientRect()
      return cellBounds.top >= notebookBounds.top - 1 && cellBounds.bottom <= notebookBounds.bottom + 1
    })).toBe(true)
    await page.getByRole('button', { name: 'Collapse round', exact: true }).click()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await page.getByRole('tab', { name: 'Requirements', exact: true }).click()
    await page.getByRole('button', { name: 'Expand round', exact: true }).waitFor({ state: 'visible' })
    expect(await notebook.locator('[data-round-id="ROUND-WEB-01"] [data-cell]').count()).toBe(0)
    await page.getByRole('button', { name: 'Expand round', exact: true }).click()
    const taskCell = page.locator('[data-cell="task"][data-task-id]').filter({ hasText: 'Build navigation HTML' })
    await taskCell.waitFor({ timeout: 15_000 })
    const failedOutput = page.getByRole('region', { name: 'Task output Check mobile navigation' })
    expect(await failedOutput.getByRole('heading').allTextContents()).toEqual(['Deliverables'])
    expect(await failedOutput.getByText('The mobile breakpoint needs another pass.', { exact: true }).count()).toBe(0)
    expect(await failedOutput.getByText('Internal viewport assertions.', { exact: true }).count()).toBe(0)
    expect(await page.locator('[data-cell="comment"]').count()).toBe(0)
    expect(await page.getByText('Hidden Notebook comment', { exact: true }).count()).toBe(0)
    expect(session.events.some(event => event.type === 'requirement/note' && event.data.kind === 'comment')).toBe(true)
    await page.getByText('Users can navigate the page with a clear, complete layout.', { exact: true }).waitFor()
    expect(await page.getByRole('textbox', { name: 'Task content Build navigation HTML', exact: true }).count()).toBe(0)
    const toolbar = page.getByRole('toolbar', { name: 'Requirements view toolbar' })
    expect(await page.getByRole('button', { name: 'Code', exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Text', exact: true }).count()).toBe(1)
    expect(await toolbar.getByRole('button', { name: 'Code', exact: true }).count()).toBe(1)
    expect(await toolbar.getByRole('button', { name: 'Text', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-cell="task"][data-status="failed"]').count()).toBe(1)
    expect(await page.locator('[data-cell="validation"][data-status="completed"]').count()).toBe(1)
    await taskCell.click()
    await page.getByRole('button', { name: 'More cell actions' }).click()
    await page.getByRole('menuitem', { name: 'View details and evidence' }).click()
    await page.getByText('The recorded reply contains the required heading', { exact: false }).waitFor()
    const english = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(REQUIREMENTS_EN_EXPECTED, english, MODE)

    await toolbar.getByRole('button', { name: 'Command', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Use Chinese content' }).click()
    await page.getByRole('complementary', { name: 'Notebook details' }).getByText('导航结果必须清晰可读', { exact: false }).waitFor()
    await page.getByText('录制回复包含所需标题', { exact: false }).waitFor()
    const chinese = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(REQUIREMENTS_ZH_EXPECTED, chinese, MODE)

    await page.getByRole('complementary', { name: 'Notebook details' }).getByRole('button', { name: 'Close details' }).click()
    await toolbar.getByRole('button', { name: 'Command', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Use English content' }).click()
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    const expandSidebar = sidebar.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await expandSidebar.count() > 0) await expandSidebar.click()
    const graph = page.getByRole('region', { name: 'Session requirement code graph' })
    const documentNode = graph.getByRole('button', { name: 'Inspect round 1 document: 构建并验证导航页面' })
    await documentNode.waitFor()
    expect(await documentNode.getAttribute('aria-pressed')).toBe('true')
    expect(await graph.getByRole('region', { name: 'Graph node details' }).innerText()).toContain('Document revision 1')
    expect(await graph.getByRole('separator', { name: 'Resize graph details' }).getAttribute('aria-valuenow')).toBe('50')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const planeGeometry = () => graph.locator('g[data-layer] > path:first-child').evaluateAll(nodes => nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { path: node.getAttribute('d'), x: box.x, width: box.width, height: box.height }
    }))
    const initialPlanes = await planeGeometry()
    expect(initialPlanes).toHaveLength(4)
    const orbGeometry = await documentNode.locator('span[class*="orb"]').evaluate(node => ({
      radius: getComputedStyle(node).borderRadius, width: node.clientWidth, height: node.clientHeight,
    }))
    expect(orbGeometry.radius).toBe('50%')
    expect(orbGeometry.width).toBe(orbGeometry.height)
    expect(orbGeometry.width).toBeGreaterThanOrEqual(36)
    expect(orbGeometry.width).toBeLessThanOrEqual(44)
    expect(await graph.getByRole('button', { name: /requirement 1: 导航页面/u }).count()).toBe(0)
    expect(await graph.getByRole('button', { name: /Inspect task:/u }).count()).toBe(0)
    await documentNode.click()
    expect(await graph.getByRole('button', { name: /requirement 1: 导航页面/u }).count()).toBe(0)
    await graph.getByRole('button', { name: 'Expand 构建并验证导航页面' }).click()
    const graphNode = graph.getByRole('button', { name: /requirement 1: 导航页面/u })
    await graphNode.waitFor()
    expect(await graphNode.getAttribute('data-status')).toBe('blocked')
    await graph.getByRole('button', { name: 'Expand 导航页面' }).click()
    await graph.getByRole('button', { name: 'Inspect task: Build navigation HTML' }).click()
    expect(await graph.getByText('No traceable code mutation recorded yet.', { exact: true }).count()).toBe(1)
    expect(await graph.getByRole('button', { name: /Inspect code changes:/u }).count()).toBe(0)
    const callId = 'graph-navigation-edit' as never
    session.append('tool/call', {
      turn: 2, step: 1, callId, name: 'edit',
      arguments: JSON.stringify({ file_path: 'nav-a.md', old_string: '# alpha nav', new_string: '# updated nav' }),
    })
    await writeFile(join(scaffold.workspaceCwd, 'workspace', 'nav-a.md'), '# updated nav\n')
    session.append('tool/result', {
      turn: 2, step: 1,
      message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'Updated nav-a.md' }] }),
      meta: { diffs: [{ path: 'nav-a.md', oldText: '# alpha nav', newText: '# updated nav' }] },
    }, { surfaceOp: 'append' })
    const codeNode = graph.getByRole('button', { name: 'Inspect code changes: nav-a.md' })
    await expect.poll(() => graph.getByRole('button', { name: 'Expand Build navigation HTML' }).isEnabled()).toBe(true)
    expect(await codeNode.count()).toBe(0)
    await graph.getByRole('button', { name: 'Expand Build navigation HTML' }).click()
    await codeNode.waitFor()
    expect(await graph.locator('g[data-layer]').count()).toBe(4)
    const edgeColors = await graph.locator('path[marker-end]').evaluateAll(paths => paths.map(path => getComputedStyle(path).stroke))
    const arrowColors = await graph.locator('marker > path').evaluateAll(paths => paths.map(path => getComputedStyle(path).fill))
    expect(new Set(edgeColors).size).toBe(1)
    expect(new Set(arrowColors)).toEqual(new Set(edgeColors))
    const scrollArea = graph.locator('[aria-label="Four-layer requirement graph canvas"]')
    expect(await scrollArea.evaluate(node => getComputedStyle(node).overflowY)).toBe('auto')
    const viewportBox = await scrollArea.boundingBox()
    if (viewportBox === null) throw new Error('requirement graph viewport geometry is unavailable')
    const scrollHeight = await scrollArea.evaluate(node => node.scrollHeight)
    for (const node of [documentNode, graphNode, graph.getByRole('button', { name: 'Inspect task: Build navigation HTML' }), codeNode]) {
      const nodeBox = await node.boundingBox()
      if (nodeBox === null) throw new Error('four-layer graph node geometry is unavailable')
      expect(nodeBox.y).toBeGreaterThanOrEqual(viewportBox.y - 1)
      expect(nodeBox.y + nodeBox.height).toBeLessThanOrEqual(viewportBox.y + scrollHeight + 1)
    }
    await codeNode.click()
    expect(await planeGeometry()).toEqual(initialPlanes)
    const layoutToggle = graph.getByRole('button', { name: 'Switch graph layout' })
    const visibleNodeCount = await graph.locator('article[data-node-key]').count()
    for (const [mode, variant] of Object.entries({
      radial: 'ring', layered: 'plane',
    })) {
      await layoutToggle.focus()
      await page.keyboard.press(mode === 'radial' ? 'Enter' : 'Space')
      expect(await layoutToggle.getAttribute('aria-pressed')).toBe(String(mode === 'radial'))
      expect(await scrollArea.getAttribute('data-layout-mode')).toBe(mode)
      expect(await graph.locator(`g[data-region-variant="${variant}"]`).count()).toBe(4)
      expect(await graph.locator('article[data-node-key]').count()).toBe(visibleNodeCount)
      expect(await codeNode.getAttribute('aria-pressed')).toBe('true')
      expect(await graph.getByText('# updated nav', { exact: true }).count()).toBeGreaterThan(0)
    }
    expect(await planeGeometry()).toEqual(initialPlanes)
    expect(await graph.getByRole('button', { name: 'Content', exact: true }).count()).toBe(0)
    expect(await graph.getByText('# updated nav', { exact: true }).count()).toBeGreaterThan(0)
    expect(await scrollArea.evaluate(node => node.scrollHeight))
      .toBeGreaterThanOrEqual(await scrollArea.evaluate(node => node.clientHeight))
    const detail = graph.getByRole('region', { name: 'Graph node details' })
    expect(await detail.getByRole('button').allTextContents()).toEqual(['Locate Notebook'])
    const detailBox = await detail.boundingBox()
    if (detailBox === null) throw new Error('graph detail geometry is unavailable')
    expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    const searchBox = await graph.getByRole('searchbox').boundingBox()
    const layoutToggleBox = await layoutToggle.boundingBox()
    const notebookBox = await detail.getByRole('button', { name: 'Locate Notebook' }).boundingBox()
    if (searchBox === null || layoutToggleBox === null || notebookBox === null) throw new Error('compact graph controls are unavailable')
    expect(searchBox.height).toBe(27)
    const expandAllBox = await graph.getByRole('button', { name: 'Expand all', exact: true }).boundingBox()
    if (expandAllBox === null) throw new Error('expand-all control is unavailable')
    expect(searchBox.x - detailBox.x).toBeLessThanOrEqual(16)
    expect(layoutToggleBox.x - detailBox.x).toBeLessThanOrEqual(16)
    expect(layoutToggleBox.width).toBe(28)
    expect(layoutToggleBox.height).toBe(28)
    expect(await layoutToggle.evaluate(node => getComputedStyle(node).borderRadius)).toBe('50%')
    expect(detailBox.x + detailBox.width - expandAllBox.x - expandAllBox.width).toBeLessThanOrEqual(16)
    expect(notebookBox.height).toBe(26)
    expect(detailBox.x + detailBox.width - notebookBox.x - notebookBox.width).toBeLessThanOrEqual(18)
    const divider = graph.getByRole('separator', { name: 'Resize graph details' })
    const dividerBox = await divider.boundingBox()
    if (dividerBox === null) throw new Error('graph divider is unavailable')
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y - 70, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await detail.boundingBox())!.height).toBeGreaterThan(detailBox.height + 40)
    await divider.focus()
    await page.keyboard.press('Home')
    for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowUp')
    expect(await divider.getAttribute('aria-valuenow')).toBe('30')
    const previewDirectory = fileURLToPath(new URL('../../../.artifacts/', import.meta.url))
    await mkdir(previewDirectory, { recursive: true })
    await page.screenshot({ path: join(previewDirectory, 'session-graph.png') })
    const graphSnapshot = await captureStableAria(page, '[aria-label="Session requirement code graph"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(REQUIREMENTS_GRAPH_EXPECTED, graphSnapshot, MODE)
    await graph.getByRole('button', { name: 'Collapse 构建并验证导航页面' }).click()
    expect(await codeNode.count()).toBe(0)
    await graph.getByRole('button', { name: 'Expand all', exact: true }).click()
    await codeNode.waitFor()
    await graph.getByRole('button', { name: 'Collapse 构建并验证导航页面' }).click()
    await graph.getByRole('searchbox').fill('nav-a.md')
    await graph.getByRole('region', { name: 'Graph search results' }).getByRole('button').click()
    await codeNode.waitFor()
    await graph.getByRole('button', { name: 'Clear search' }).click()
    const wideViewport = page.viewportSize()
    if (wideViewport === null) throw new Error('requirements viewport geometry is unavailable')
    const graphBox = await graph.boundingBox()
    if (graphBox === null) throw new Error('requirement graph geometry is unavailable')
    expect(graphBox.y + graphBox.height).toBeLessThanOrEqual(wideViewport.height)
    for (let step = 0; step < 10; step++) await graph.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(() => scrollArea.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0)
    await scrollArea.evaluate((node) => { node.scrollTop = node.scrollHeight })
    expect(await scrollArea.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()

    const failedRail = page.locator('[data-cell="task"][data-status="failed"] [class*="statusRail"]')
    expect(await failedRail.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(235, 148, 13)')
    session.append('requirement/validation', {
      version: 1,
      revision: 2,
      roundId,
      turn: 2,
      reviewedThroughSeq: session.events.at(-1)?.seq ?? -1,
      status: 'completed',
      summary: { zh: '检测到历史需求回归。', en: 'A historical requirement regression was detected.' },
      regressions: [{
        requirementId: 'R1',
        taskId: completedTaskId,
        reason: { zh: '当前实现意外改变了既有导航行为。', en: 'The implementation accidentally changed existing navigation behavior.' },
      }],
      failedTaskIds: [failedTaskId],
    })
    const regressionCell = page.locator('[data-cell="task"][data-status="regression"]')
    await regressionCell.waitFor()
    const regressionRail = regressionCell.locator('[class*="statusRail"]')
    expect(await regressionRail.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(237, 51, 31)')
    session.append('requirement/validation', {
      version: 1,
      revision: 3,
      roundId,
      turn: 2,
      reviewedThroughSeq: session.events.at(-1)?.seq ?? -1,
      status: 'completed',
      summary: {
        zh: 'HTML 已生成；移动端检查仍有一个普通执行失败，但没有历史需求回归。',
        en: 'The HTML was generated; one ordinary mobile check failed, with no historical requirement regression.',
      },
      regressions: [],
      failedTaskIds: [failedTaskId],
    })
    await expect.poll(() => page.locator('[data-cell="task"][data-status="regression"]').count()).toBe(0)
    const [toolbarBox, commandBox] = await Promise.all([
      toolbar.boundingBox(),
      toolbar.getByRole('button', { name: 'Command', exact: true }).boundingBox(),
    ])
    if (toolbarBox === null || commandBox === null) throw new Error('requirements toolbar geometry is unavailable')
    expect(toolbarBox.height).toBeGreaterThanOrEqual(48)
    expect(toolbarBox.height).toBeLessThanOrEqual(50)
    expect(commandBox.width).toBeGreaterThanOrEqual(91)
    expect(commandBox.width).toBeLessThanOrEqual(101)
    expect(commandBox.height).toBe(28)

    await toolbar.getByRole('button', { name: 'Code', exact: true }).click()
    await page.getByRole('textbox', { name: 'Task content New task' }).waitFor()
    const taskGroup = page.locator('[data-task-group]').nth(2)
    const editor = taskGroup.locator('[data-cell="task"]')
    const agentSpec = taskGroup.locator('[data-task-agent-spec]')
    const input = agentSpec.getByRole('textbox', { name: 'Task content New task' })
    await editor.waitFor()
    await editor.click()
    const summaryInput = editor.getByRole('textbox', { name: 'Human task description' })
    const compactBox = await editor.boundingBox()
    const compactSpecBox = await agentSpec.boundingBox()
    if (compactBox === null || compactSpecBox === null) throw new Error('compact task editor geometry is unavailable')
    expect(compactBox.height).toBeLessThanOrEqual(280)
    expect(await summaryInput.evaluate(node => Number.parseFloat(node.style.height))).toBeLessThanOrEqual(50)
    expect(await input.evaluate(node => Number.parseFloat(node.style.height))).toBeLessThanOrEqual(110)
    expect(await taskGroup.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0)
    expect(await taskGroup.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0)
    expect(await editor.getByRole('button', { name: 'Run task New task' }).isDisabled()).toBe(true)
    const content = 'Export navigation results\n  Export the current navigation results.\n  Use CSV.\n  Keep the header.\n  Validate the file.'
    const humanSummary = 'Users can export the current navigation results as a clear CSV file.'
    const storedStatement = 'Export the current navigation results.\nUse CSV.\nKeep the header.\nValidate the file.\n\n_关联需求：1.1、1.2_'
    const translator = vi.spyOn(scaffold.ctx.subagents, 'start').mockImplementation(async (_provider, request) => {
      const prompt = request.prompt[0]
      if (prompt?.type !== 'text') throw new Error('expected task translation prompt')
      const source = JSON.parse(prompt.text.slice(prompt.text.lastIndexOf('\n\n') + 2)) as { task: { title: string; statement: string } }
      return { id: SessionId('navigation-task-translator'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed', output: [], structured: {
          title: source.task.title, summary: '用户可以导出清晰的搜索结果。', markdown: source.task.statement,
        } }), dispose: async () => {},
      }
    })
    await input.fill(content)
    await expect.poll(() => {
      const latest = session.events.findLast(event => event.type === 'requirement/task-list')
      return latest?.type === 'requirement/task-list'
        ? latest.data.tasks.find(task => task.title === 'Export navigation results')?.statement
        : undefined
    }).toBe(storedStatement)
    await summaryInput.fill(humanSummary)
    await summaryInput.blur()
    await expect.poll(() => {
      const latest = session.events.findLast(event => event.type === 'requirement/task-list')
      return latest?.type === 'requirement/task-list'
        ? latest.data.tasks.find(task => task.title === 'Export navigation results')?.summary
        : undefined
    }).toBe(humanSummary)
    translator.mockRestore()
    await expect.poll(async () => (await agentSpec.boundingBox())?.height ?? 0).toBeGreaterThan(compactSpecBox.height)
    const draft = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(REQUIREMENTS_DRAFT_EXPECTED, draft, MODE)
    await page.reload()
    await ensureSeedOpen(page)
    await page.getByRole('tab', { name: 'Requirements' }).click()
    const restoredCell = page.locator('[data-cell="task"]').filter({ hasText: 'Export navigation results' })
    await restoredCell.waitFor()
    await expect.poll(() => restoredCell.getByRole('textbox', { name: 'Human task description' }).inputValue()).toBe(humanSummary)
    expect(await page.getByText('Export the current navigation results.', { exact: true }).count()).toBe(0)
    await restoredCell.click()
    expect(await restoredCell.getByRole('textbox', { name: 'Human task description' }).inputValue()).toBe(humanSummary)
    const restoredGroup = restoredCell.locator('..')
    const restoredSpec = restoredGroup.locator('[data-task-agent-spec]')
    expect(await restoredSpec.getByRole('button', { name: 'Expand Agent execution instructions Export navigation results' }).getAttribute('aria-expanded')).toBe('false')
    await restoredSpec.getByRole('button', { name: 'Expand Agent execution instructions Export navigation results' }).click()
    const restored = restoredSpec.getByRole('textbox', { name: 'Task content Export navigation results' })
    await restored.waitFor()
    expect(await restored.inputValue()).toBe(`Export navigation results\n  ${storedStatement.replaceAll('\n', '\n  ')}`)

    const turnsBeforeNote = session.events.filter(event => event.type === 'turn/start').length
    await toolbar.getByRole('button', { name: 'Text', exact: true }).click()
    const noteInput = page.getByRole('textbox', { name: 'Markdown note content' })
    await noteInput.waitFor()
    const noteCell = page.locator('[data-cell="text"]').last()
    const markdown = '# Review notes\n\n- **Keep** the navigation\n- Verify `index.html`\n\n| Check | Result |\n| --- | --- |\n| Mobile | Pending |\n\n```js\nconst reviewed = true\n```'
    await noteInput.fill(markdown)
    await expect.poll(() => {
      const latest = session.events.findLast(event => event.type === 'requirement/note')
      return latest?.type === 'requirement/note' ? latest.data.content : undefined
    }).toBe(markdown)
    expect(await noteCell.getByRole('button', { name: 'Save', exact: true }).count()).toBe(0)
    expect(await noteCell.getByRole('button', { name: /Run task/ }).count()).toBe(0)
    await noteCell.getByRole('button', { name: 'Preview note', exact: true }).click()
    await noteCell.getByRole('heading', { name: 'Review notes' }).waitFor()
    expect(await noteCell.getByRole('table').count()).toBe(1)
    const noteSnapshot = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(REQUIREMENTS_NOTE_EXPECTED, noteSnapshot, MODE)
    await page.reload()
    await ensureSeedOpen(page)
    await page.getByRole('tab', { name: 'Requirements' }).click()
    const restoredNote = page.locator('[data-cell="text"]').filter({ has: page.getByRole('heading', { name: 'Review notes' }) })
    await restoredNote.waitFor()
    await restoredNote.getByRole('button', { name: 'Edit note' }).click()
    expect(await page.getByRole('textbox', { name: 'Markdown note content' }).inputValue()).toBe(markdown)
    expect(session.events.filter(event => event.type === 'turn/start')).toHaveLength(turnsBeforeNote)

    const retained = scaffold.ctx.sessions.create(SessionId('notebook-retention-web-e2e'), {
      seed: session.events.filter(event => event.type.startsWith('requirement/')).map((event, seq) => ({ ...event, seq })),
      meta: { cwd: scaffold.workspaceCwd },
    })
    retained.append('turn/start', { turn: 1 })
    for (let index = 0; index < 65; index++) retained.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `NOTEBOOK_RETENTION ${index}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    retained.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(retained)
    const searchResponse = await scaffold.hostFetch('/api/session/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'notebook-retention-search', method: 'session/search',
        payload: { args: { request: { query: 'NOTEBOOK_RETENTION' } } } }),
    })
    const found = await searchResponse.json() as { result: { ok: boolean; value: { items: { sessionId: string }[] } } }
    expect(found.result.ok, JSON.stringify(found)).toBe(true)
    expect(found).toMatchObject({ result: { ok: true, value: { items: [{ sessionId: retained.id }] } } })
    await page.reload()
    await page.getByText('Ungrouped', { exact: true }).waitFor()
    const searchButton = page.getByRole('button', { name: 'Search sessions' })
    if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill('NOTEBOOK_RETENTION')
    const retainedRow = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => retainedRow.count(), { timeout: 15_000 }).toBe(1)
    await retainedRow.click()
    await page.getByRole('tab', { name: 'Requirements' }).click()
    await page.locator('[data-cell="task"]').filter({ hasText: 'Export navigation results' }).waitFor()
    const taskCount = await page.locator('[data-cell="task"]').count()
    const outputBefore = await page.locator('[data-cell-output]').allTextContents()
    expect(taskCount).toBe(4)
    expect(outputBefore.join('\n')).toContain('No mobile layout delivered.')
    await page.addInitScript(() => {
      const state = globalThis as typeof globalThis & { notebookSockets: WebSocket[] }
      state.notebookSockets = []
      const Original = WebSocket
      globalThis.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          state.notebookSockets.push(this)
        }
      }
    })
    await page.reload()
    await page.getByRole('tab', { name: 'Requirements' }).click()
    await expect.poll(() => page.locator('[data-cell="task"]').count()).toBe(taskCount)
    expect(await page.locator('[data-cell-output]').allTextContents()).toEqual(outputBefore)
    const durableNote = page.locator('[data-cell="text"]').filter({ has: page.getByRole('heading', { name: 'Review notes' }) })
    await durableNote.waitFor()
    expect(await page.locator('[data-cell="task"]').filter({ hasText: 'Export navigation results' })
      .getByRole('textbox', { name: 'Human task description' }).inputValue()).toBe(humanSummary)
    const reconnected = page.waitForEvent('websocket')
    await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { notebookSockets: WebSocket[] }
      for (const socket of state.notebookSockets) socket.close()
    })
    await reconnected
    retained.append('requirement/note', { version: 1, roundId, noteId: 'AFTER-RECONNECT' as never,
      kind: 'text', content: 'Saved after reconnect', dispatched: false })
    await page.getByText('Saved after reconnect', { exact: true }).waitFor()
    expect(await page.locator('[data-cell="task"]').count()).toBe(taskCount)
    expect(await page.locator('[data-cell-output]').allTextContents()).toEqual(outputBefore)
    // The injected disconnect owes exactly one warning; later transport warnings still fail cleanup.
    expect(tripwire.warnings.splice(0)).toEqual(['[connection] connection lost, retry #1'])
    const retainedSnapshot = (await captureStableAria(page, '[class*="viewArea"]', scaffold.workspaceCwd))
      .split(retained.id).join('{{retainedId}}')
    await compareOrRefreshGolden(REQUIREMENTS_RESTORED_EXPECTED, retainedSnapshot, MODE)

    const previousTasks = retained.events.findLast(event => event.type === 'requirement/task-list')
    if (previousTasks?.type !== 'requirement/task-list') throw new Error('retained Notebook has no Tasks')
    retained.append('requirement/task-list', {
      ...previousTasks.data,
      revision: previousTasks.data.revision + 1,
      tasks: previousTasks.data.tasks.filter(task => task.kind !== 'final-test')
        .map((task, order) => ({ ...task, order })),
    })
    await expect.poll(() => page.locator('[data-cell="task"]').count()).toBe(taskCount - 1)
    expect(await page.getByText('Final Test', { exact: true }).count()).toBe(0)
  }, 120_000)

  it.skipIf(MODE === 'record')('downloads through the Session Header and /export with one dialog', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-export'))
    await ensureSeedOpen(page)
    const exportButton = page.getByRole('button', { name: 'Session log' })
    expect(await exportButton.isDisabled()).toBe(false)
    const header = exportButton.locator('xpath=ancestor::header[1]')
    const [buttonBox, headerBox] = await Promise.all([
      exportButton.boundingBox(), header.boundingBox(),
    ])
    if (buttonBox === null || headerBox === null) {
      throw new Error('Session Header export geometry is unavailable')
    }
    expect(headerBox.x + headerBox.width - (buttonBox.x + buttonBox.width)).toBeLessThanOrEqual(32)
    const responsePromise = page.waitForResponse(response =>
      response.request().method() === 'HEAD'
      && new URL(response.url()).pathname === '/api/session.export', { timeout: 30_000 })
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await exportButton.click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^dsh-session-.+\.zip$/)
    const dialog = page.getByRole('dialog', { name: 'Session download started' })
    await dialog.waitFor({ timeout: 30_000 })
    // The real host streamed the ZIP; its root entry is the persisted log
    // text verbatim (the assembled seam: real route, real persistence read).
    const files = unzipSync(await readFile(await download.path()))
    expect(Object.keys(files)).toEqual(['session.jsonl'])
    const content = strFromU8(files['session.jsonl'] as Uint8Array)
    expect(content.split('\n')[0]).toContain(SEED_ID)
    expect(content).toContain('FIRST_DONE')
    await dialog.getByText('Close', { exact: true }).click()

    const observer = await newEnglishPage(browser)
    const observerTripwire = watchConsole(observer)
    const observerSlotErrors: string[] = []
    let observerDownloads = 0
    observer.on('download', () => { observerDownloads += 1 })
    observer.on('console', (message) => {
      if (message.type() === 'error' && /slot entry crashed/i.test(message.text())) {
        observerSlotErrors.push(message.text())
      }
    })
    const observerSessionBaseline = baselineResponse(observer)
    const [, observerSessionResponse] = await Promise.all([
      observer.goto(scaffold.authenticatedUrl, { waitUntil: 'load' }),
      observerSessionBaseline,
    ])
    await assertBaselineSucceeded(observerSessionResponse, 'observer session.list')
    await observer.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
    await ensureSeedOpen(observer)

    try {
      const input = page.locator('[data-composer-input]').first()
      const slashDownloadPromise = page.waitForEvent('download', { timeout: 30_000 })
      await input.fill('/export')
      await page.getByRole('option', { name: /export/u }).waitFor({ timeout: 10_000 })
      await input.press('Enter')
      const slashDownload = await slashDownloadPromise
      expect(slashDownload.suggestedFilename()).toBe(download.suggestedFilename())
      const slashFiles = unzipSync(await readFile(await slashDownload.path()))
      const slashContent = strFromU8(slashFiles['session.jsonl'] as Uint8Array)
      const slashEvents = parseSessionLog(slashContent)
      const exportRun = slashEvents.findLast(event => event.type === 'command/run' && event.data.name === 'export')
      if (exportRun?.type !== 'command/run') throw new Error('slash ZIP has no export command/run')
      const exportDone = slashEvents.find(event =>
        event.type === 'command/done' && event.data.commandId === exportRun.data.commandId)
      expect(exportDone?.type).toBe('command/done')
      await page.getByRole('dialog', { name: 'Session download started' }).waitFor({ timeout: 30_000 })
      await page.getByRole('dialog', { name: 'Session download started' })
        .getByText('Close', { exact: true }).click()
      await observer.getByText('Session log download requested.', { exact: true }).waitFor({ timeout: 30_000 })
      expect(observerDownloads).toBe(0)
      expect(await observer.getByRole('dialog', { name: 'Session download started' }).count()).toBe(0)
      expect({
        pageErrors: observerTripwire.pageErrors,
        slotErrors: observerSlotErrors,
        warnings: observerTripwire.warnings,
      }).toEqual({ pageErrors: [], slotErrors: [], warnings: [] })
    } finally {
      await observer.close()
    }
  }, 120_000)

  it.skipIf(MODE === 'record')('focuses the ledger by dragging an overview interval', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-timeline'))
    await ensureSeedOpen(page)
    await page.getByRole('tab', { name: 'Trajectory' }).click()
    const plot = page.getByLabel('Timeline overview; drag horizontally to focus events')
    await plot.waitFor({ timeout: 15_000 })
    const before = await page.locator('tr[data-kind]').count()
    const box = await plot.boundingBox()
    if (box === null) throw new Error('trajectory timeline plot has no layout box')
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2)
    await page.mouse.up()
    await expect.poll(() => page.locator('tr[data-timeline-focus="outside"]').count(), { timeout: 10_000 })
      .toBeGreaterThan(0)
    await expect.poll(() => page.locator('tr[data-kind]').count(), { timeout: 10_000 }).toBe(before)
    await plot.click({ button: 'right' })
    await expect.poll(() => page.locator('tr[data-timeline-focus]').count(), { timeout: 10_000 }).toBe(0)
  }, 60_000)

  it.skipIf(MODE === 'record')('bash and file-path rows leave the default details column closed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-details'))
    await ensureSeedOpen(page)
    const bashRow = page.locator('[data-sample="bash"]').first()
    await expandOwningTurnProcess(page, bashRow)
    await bashRow.waitFor({ timeout: 15_000 })
    const frame = page.locator('[style*="grid-template-columns"]').first()
    expect(await frame.getAttribute('data-details-collapsed')).toBe('true')
    // The row click is the card's expand toggle (unified tool-row
    // interaction); it must not drive layout geometry either way.
    await bashRow.click()
    await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
    // The card's own controls are outside the summary row and must not open
    // details either — the expanded terminal card is read in place.
    await page.locator('[data-sample="bash"] ~ div [data-terminal] [class*="_copyButton_"]').first().click()
    await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
    // Read summaries are host-open file links; they also must not open details.
    const fileLink = page.locator('[data-variant="read"] button').first()
    await fileLink.waitFor({ timeout: 10_000 })
    const openPath = vi.spyOn(scaffold.ctx.sessionController, 'openWorkspacePath')
      .mockResolvedValue({ opened: true })
    try {
      await fileLink.click()
      await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
    } finally {
      openPath.mockRestore()
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('renders the bash row as a terminal card in the real browser', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-navigation-terminal'))
    await ensureSeedOpen(page)
    // The card is expand-gated behind the whole-row toggle (the unified
    // tool-row interaction): open it if this fresh view leaves it collapsed.
    // Expanded, the recorded command's own output sits in the message flow,
    // derived from the logged call/result presentations alone.
    const bashRow = page.locator('[data-sample="bash"]').first()
    await expandOwningTurnProcess(page, bashRow)
    await bashRow.waitFor({ timeout: 15_000 })
    if (await bashRow.getAttribute('aria-expanded') !== 'true') await bashRow.click()
    const card = page.locator('[data-sample="bash"] ~ div [data-terminal]').first()
    await card.waitFor({ timeout: 15_000 })
    // Real layout, not jsdom's stub (which computes no geometry at all):
    // squeeze the output pane below its content width and the line must keep
    // its single row and overflow sideways instead of folding. Soft-wrapping
    // here shreds the column alignment this card exists to hold.
    const layout = await card.locator('[class*="_output_"]').first().evaluate((node) => {
      const pane = node as HTMLElement
      const row = pane.querySelector<HTMLElement>('[class*="_line_"]')
      if (row === null) throw new Error('output pane has no line')
      const before = row.offsetHeight
      const restore = pane.style.width
      pane.style.width = '8px'
      const squeezed = { wrapped: row.offsetHeight > before, scrollsSideways: pane.scrollWidth > pane.clientWidth }
      pane.style.width = restore
      return { whiteSpace: getComputedStyle(row).whiteSpace, overflowX: getComputedStyle(pane).overflowX, ...squeezed }
    })
    expect(layout).toEqual({ whiteSpace: 'pre', overflowX: 'auto', wrapped: false, scrollsSideways: true })
    // The run-state dot's color is the whole point of it and is the one thing
    // jsdom cannot report: --dsw-* tokens resolve only against the real theme
    // stylesheet. This command settled cleanly, so the dot must be the green
    // success token — a red one here would read as a failed command.
    const dot = await card.locator('[class*="_runState_"][data-state]').first().evaluate((node) => {
      // The token lives on body, so the probe must sit in the same cascade.
      const probe = document.createElement('span')
      probe.style.color = 'var(--dsw-alias-state-success-primary)'
      document.body.appendChild(probe)
      const success = getComputedStyle(probe).color
      probe.remove()
      return {
        state: node.getAttribute('data-state'),
        color: getComputedStyle(node as HTMLElement).color,
        success,
        // One label per card (the state is the call's), so it hangs off the
        // prompt column rather than the row the dot sits in.
        label: node.closest('[class*="_prompt_"]')?.querySelector('[class*="_runStateLabel_"]')?.textContent ?? null,
        // The dot precedes the prompt label in document order, which is what
        // puts it to the left of the `$`.
        beforePrompt: node.compareDocumentPosition(node.parentElement!.querySelector('[class*="_cwd_"]')!)
          === Node.DOCUMENT_POSITION_FOLLOWING,
        // The dot lives in the card's OWN left padding, so it sits inside the
        // card box yet left of the prompt text. Owning the reservation as padding
        // rather than margin is what keeps a consumer's own margin from
        // cancelling it and letting a container clip the dot — geometry jsdom
        // cannot compute.
        insideCard: (node as HTMLElement).getBoundingClientRect().left
          >= (node.closest('[data-terminal]')?.getBoundingClientRect().left ?? Infinity),
        leftOfPrompt: (node as HTMLElement).getBoundingClientRect().right
          <= (node.closest('[class*="_promptLine_"]')
            ?.querySelector('[class*="_cwd_"]')
            ?.getBoundingClientRect().left ?? -Infinity),
      }
    })
    expect(dot.state).toBe('done')
    expect(dot.label).toBe('Done')
    expect(dot.beforePrompt).toBe(true)
    expect(dot.insideCard).toBe(true)
    expect(dot.leftOfPrompt).toBe(true)
    // Resolved through the theme token, not a literal hex in the component.
    expect(dot.success).toMatch(/^rgb/)
    expect(dot.color).toBe(dot.success)
    // Golden of the card at rest — captured before the copy click, whose
    // confirmation label self-reverts on a timer and would not hold still.
    const snapshot = (await captureStableAria(page, '[data-terminal]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(TERMINAL_EXPECTED, snapshot, MODE)
    // Copy writes the raw output through the browser's own clipboard, which in
    // a real page is the async Clipboard API rather than the jsdom fallback.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await card.locator('[class*="_copyButton_"]').first().click()
    await expect.poll(() => card.locator('[class*="_copyButton_"]').first().textContent(), { timeout: 5_000 })
      .toBe('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('NAVIGATION_OK')
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the recorded fixture inventory exact', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.jsonl', 'search-results.expected.md', 'trajectory.expected.md',
      'terminal-card.expected.md', 'requirements-en.expected.md', 'requirements-zh.expected.md',
      'requirements-draft.expected.md', 'requirements-markdown-note.expected.md',
      'requirements-restored.expected.md', 'requirements-graph.expected.md',
    ])
  })

  it.skipIf(MODE === 'record')('keeps dense layered nodes readable with blue curved links', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-layered-density'))
    await ensureSeedOpen(page)
    const session = scaffold.ctx.sessions.get(SessionId(SEED_ID))
    if (session === undefined) throw new Error('opened navigation seed is not attached')
    for (let round = 1; round <= 3; round++) {
      const roundId = `ROUND-WEB-0${round}` as never
      const common = { version: 1 as const, revision: 2, roundId }
      const count = round === 3 ? 6 : 7
      session.append('requirement/round', { ...common, round, sourceMessageId: `density-${round}` as never,
        language: 'en', input: `Dense graph round ${round}`, status: 'completed', turn: 2 })
      session.append('requirement/document', { ...common, turn: 2, summary: `Dense round ${round}`,
        markdown: '# Dense graph', valid: true, issues: [] })
      session.append('requirement/graph', { ...common, documentRevision: 2,
        nodes: Array.from({ length: count }, (_, i) => ({ requirementId: String(i + 1),
          title: `Requirement ${round}.${i + 1}`, acceptanceRefs: [`${i + 1}.1`] })), relations: [] })
      const tasks = Array.from({ length: 9 }, (_, i) => ({ id: `density-task-${round}-${i}` as never,
        order: i, kind: 'implementation' as const, title: `Task ${round}.${i + 1}`, summary: '', statement: '',
        requirementRefs: [`${i % count + 1}.1`, `${(i + 1) % count + 1}.1`], status: 'completed' as const }))
      session.append('requirement/task-list', { ...common, documentRevision: 2, tasks })
      for (const [i, task] of tasks.entries()) {
        const turn = 10 + round * 10 + i
        session.append('requirement/task-execution', { ...common, taskId: task.id,
          messageId: `density-execution-${round}-${i}` as never, status: 'completed', turn, output: 'Done' })
        const fileCount = round === 3 ? 13 : 14
        const diffs = Array.from({ length: fileCount }, (_, j) => j).filter(j => j % 9 === i)
          .map(j => ({ path: `density/r${round}-${j}.ts`, oldText: null, newText: 'export {}' }))
        const callId = `density-edit-${round}-${i}` as never
        session.append('tool/call', { turn, step: 1, callId, name: 'edit', arguments: '{}' })
        session.append('tool/result', { turn, step: 1,
          message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'Updated' }] }),
          meta: { diffs } }, { surfaceOp: 'append' })
      }
    }
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    const expand = sidebar.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await expand.count()) await expand.click()
    const graph = page.getByRole('region', { name: 'Session requirement code graph' })
    await expect.poll(() => graph.locator('article[data-layer="document"]').count()).toBe(3)
    await graph.getByRole('button', { name: 'Expand all', exact: true }).click()
    await expect.poll(() => graph.locator('article[data-node-key]').count()).toBe(91)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const [kind, count, rowCount] of [['requirement', 20, 2], ['task', 27, 2], ['code', 41, 3]] as const) {
      const measurements = await graph.locator(`article[data-layer="${kind}"]`).evaluateAll(nodes => nodes.map(node => ({
        top: (node as HTMLElement).style.top,
        scale: Number((node as HTMLElement).style.scale),
        width: node.querySelector('button > span')!.getBoundingClientRect().width,
      })))
      expect(measurements).toHaveLength(count)
      expect(new Set(measurements.map(node => node.top)).size).toBe(rowCount)
      expect(Math.min(...measurements.map(node => node.scale))).toBeGreaterThanOrEqual(.48)
      expect(Math.min(...measurements.map(node => node.width))).toBeGreaterThan(12)
    }
    const colors = await graph.locator('path[marker-end]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke))
    expect(new Set(colors).size).toBe(1)
    const directory = fileURLToPath(new URL('../../../.artifacts/', import.meta.url))
    await mkdir(directory, { recursive: true })
    await graph.screenshot({ path: join(directory, 'layered-density.png') })
  }, 60_000)
})
