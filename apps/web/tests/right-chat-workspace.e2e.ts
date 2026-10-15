/** Browser acceptance for the second, Session-shared Chat surface and prompt intents. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openRightChat, saveFailureShot } from './support.ts'

const normalFixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const appendFixture = fileURLToPath(new URL('../../../snapshots/web/requirement-append/session.jsonl', import.meta.url))
const normalPrompt = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'
const additionalRequirement = '请在已有欢迎文案需求中增加一条验收标准：文案旁显示可复制按钮，点击后复制文案。'
const standaloneTask = '检查欢迎文案复制按钮的键盘操作和提示文字。'

describe('web e2e: right Chat and Session prompt intents', () => {
  it('mirrors one Chat, owns the composer, resizes, and restores the sidebar', async () => {
    const scaffold = await launchWebScaffold({ replayFixture: normalFixture, compareReplaySession: false })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'right-chat-normal-flow'))
    let completed = false
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const panel = page.locator('[data-right-chat-panel]')
      const input = panel.locator('[data-composer-input]')
      expect(await page.locator('[data-composer-input]').count()).toBe(1)
      expect(await page.locator('[data-conversation-scroll]').first().locator('[data-composer-input]').count()).toBe(0)

      const sidebar = page.locator('[data-dsh-panel]:not([data-dsh-bottom-panel])')
      await page.getByRole('button', { name: 'Close Chat' }).click()
      await panel.waitFor({ state: 'detached' })
      const sidebarWasClosed = (await sidebar.getAttribute('class'))?.includes('panelHidden') === true
      await openRightChat(page)
      const before = await panel.boundingBox()
      const sidebarBefore = await sidebar.boundingBox()
      if (before === null || sidebarBefore === null) throw new Error('right Chat and sidebar need visible boxes')
      expect(Math.abs(before.width - sidebarBefore.width)).toBeLessThan(12)
      const resize = sidebar.locator('[class*="panelResize"]')
      await expect.poll(async () => {
        const box = await resize.boundingBox()
        return box === null ? Number.POSITIVE_INFINITY : box.x + box.width / 2
      }, { timeout: 10_000 }).toBeLessThan(before.x - 2)
      const handle = await resize.boundingBox()
      if (handle === null) throw new Error('sidebar resize handle is missing')
      const resizeX = handle.x + handle.width / 2
      const resizeY = handle.y + Math.min(80, handle.height / 2)
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('class') ?? '',
        { x: resizeX, y: resizeY })
      expect(hit, `sidebar resize strip must be pointer reachable at ${resizeX}, ${resizeY}`).toContain('panelResize')
      await page.mouse.move(resizeX, resizeY)
      await page.mouse.down()
      await page.mouse.move(handle.x - 80, resizeY, { steps: 6 })
      const dragState = await page.evaluate(() => ({
        dragging: document.body.hasAttribute('data-dsh-sidebar-dragging'),
        width: document.documentElement.style.getPropertyValue('--dsh-sidebar-width'),
        sidebarWidth: document.querySelector<HTMLElement>('[data-dsh-panel]:not([data-dsh-bottom-panel])')?.getBoundingClientRect().width,
      }))
      expect(dragState.dragging, JSON.stringify(dragState)).toBe(true)
      await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 30)
      await page.mouse.up()
      await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 30)

      await input.fill(normalPrompt)
      await input.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'What should this message do?' })
      await dialog.waitFor({ state: 'visible' })
      await dialog.locator('[data-intent-choice="cancel"]').click()
      expect((await input.textContent())?.trim()).toBe(normalPrompt)
      await input.press('Enter')
      const settled = scaffold.whenTurnSettled()
      await dialog.locator('[data-intent-choice="chat"]').click()
      await settled
      await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 10_000 })
      expect(await page.getByRole('tab', { name: 'Chat', exact: true }).getAttribute('aria-selected')).toBe('true')
      const leftChat = page.locator('[data-conversation-scroll]').first()
      await expect.poll(() => leftChat.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThan(0)
      await expect.poll(() => panel.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThan(0)
      expect(await leftChat.getByText(normalPrompt, { exact: true }).count()).toBeGreaterThan(0)
      expect(await panel.getByText(normalPrompt, { exact: true }).count()).toBeGreaterThan(0)

      await page.getByRole('button', { name: 'New session', exact: true }).first().click()
      await expect.poll(() => panel.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(0)
      const searchButton = page.getByRole('button', { name: 'Search sessions' })
      await searchButton.click()
      const search = page.getByPlaceholder('Search sessions', { exact: false })
      await search.fill('WEB_E2E_OK')
      const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
      await expect.poll(() => result.count(), { timeout: 15_000 }).toBe(1)
      await result.click()
      await panel.getByText('DONE', { exact: true }).waitFor({ timeout: 10_000 })

      await page.getByRole('button', { name: 'Close Chat' }).click()
      await panel.waitFor({ state: 'detached' })
      expect((await sidebar.getAttribute('class'))?.includes('panelHidden') === true).toBe(sidebarWasClosed)
      expect(await page.locator('[data-composer-input]').count()).toBe(0)
      await openRightChat(page)
      await panel.getByText('DONE', { exact: true }).waitFor({ timeout: 10_000 })
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      completed = true
    } catch (error) {
      await saveFailureShot(page, 'right-chat-normal-flow')
      throw error
    } finally {
      await browser.close()
      if (completed) await scaffold.close()
      else await scaffold.close().catch(() => { /* primary browser failure is reported above */ })
    }
  }, 180_000)

  it('appends a document revision and creates a separate task-only round', async () => {
    const scaffold = await launchWebScaffold({ replayFixture: appendFixture, compareReplaySession: false })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'right-chat-requirement-task'))
    let completed = false
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const session = scaffold.ctx.agents.list()[0]?.session
      if (session === undefined) throw new Error('workspace picker did not create a Session')
      const roundId = 'ROUND-01' as never
      session.append('requirement/round', {
        version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'append-original' as never,
        language: 'zh', input: '交付一条欢迎文案。', status: 'tasks-ready',
      })
      session.append('requirement/document', {
        version: 1, revision: 1, roundId, turn: 1, summary: '交付欢迎文案', valid: true, issues: [],
        markdown: '# 需求文档\n\n## 简介\n\n交付欢迎文案。\n\n## 需求\n\n### 需求 1：欢迎文案\n\n**用户故事：** 作为用户，我希望看到欢迎文案，以便确认页面已打开。\n\n#### 验收标准\n\n1. 页面打开时显示“欢迎体验”。',
      })
      const panel = page.locator('[data-right-chat-panel]')
      const input = panel.locator('[data-composer-input]')
      const settled = scaffold.whenTurnSettled()
      await input.fill(additionalRequirement)
      await input.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'What should this message do?' })
      await dialog.waitFor({ state: 'visible' })
      await dialog.locator('[data-intent-choice="requirement"]').click()
      await settled
      await page.getByRole('tab', { name: 'Requirements', exact: true }).click()
      await page.locator('[data-round-id="ROUND-01"]').waitFor({ timeout: 10_000 })
      await expect.poll(() => session.events.filter(event => event.type === 'requirement/document' && event.data.roundId === roundId).length,
        { timeout: 15_000 }).toBe(2)
      const documents = session.events.filter((event): event is SessionEvent<'requirement/document'> =>
        event.type === 'requirement/document' && event.data.roundId === roundId)
      expect(documents.map(event => event.data.revision)).toEqual([1, 2])
      expect(documents[0]?.data.markdown).toContain('欢迎体验')
      expect(documents[1]?.data.markdown).toContain('复制')
      expect([...new Set(session.events.filter(event => event.type === 'requirement/round').map(event => event.data.roundId))])
        .toEqual([roundId])
      await expect.poll(() => page.locator('[data-round-id="ROUND-01"] [data-cell="document"]').count(),
        { timeout: 10_000 }).toBe(1)

      await input.fill(standaloneTask)
      await input.press('Enter')
      await dialog.waitFor({ state: 'visible' })
      await dialog.locator('[data-intent-choice="task"]').click()
      await expect.poll(() => [...new Set(session.events.filter(event => event.type === 'requirement/round')
        .map(event => event.data.roundId))].length, { timeout: 10_000 }).toBe(2)
      const taskRound = session.events.findLast((event): event is SessionEvent<'requirement/round'> =>
        event.type === 'requirement/round')
      if (taskRound === undefined) throw new Error('task-only round was not recorded')
      expect(taskRound.data.kind).toBe('task')
      expect(taskRound.data.round).toBe(2)
      const taskList = session.events.findLast((event): event is SessionEvent<'requirement/task-list'> =>
        event.type === 'requirement/task-list' && event.data.roundId === taskRound.data.roundId)
      if (taskList === undefined) throw new Error('task-only list was not recorded')
      expect(taskList.data.documentRevision).toBe(0)
      expect(taskList.data.tasks).toHaveLength(1)
      expect(taskList.data.tasks[0]?.status).toBe('pending')
      expect(session.events.filter(event => event.type === 'requirement/document' && event.data.roundId === taskRound.data.roundId)).toEqual([])
      await page.locator(`[data-round-id="${taskRound.data.roundId}"] [data-cell="task"]`).waitFor({ timeout: 10_000 })
      expect(await page.locator(`[data-round-id="${taskRound.data.roundId}"] [data-cell="document"]`).count()).toBe(0)
      const graph = page.locator('[role="region"][aria-label="Session requirement code graph"]')
      expect(await graph.isVisible()).toBe(false)
      await page.getByRole('button', { name: 'Close Chat' }).click()
      await panel.waitFor({ state: 'detached' })
      await graph.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await page.locator('[data-round-id="ROUND-01"]').count()).toBe(1)
      expect(await page.locator(`[data-round-id="${taskRound.data.roundId}"]`).count()).toBe(1)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      completed = true
    } catch (error) {
      await saveFailureShot(page, 'right-chat-requirement-task')
      throw error
    } finally {
      await browser.close()
      if (completed) await scaffold.close()
      else await scaffold.close().catch(() => { /* primary browser failure is reported above */ })
    }
  }, 180_000)
})
