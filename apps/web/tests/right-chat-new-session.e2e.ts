/** Browser acceptance for a New Session's retained central composer. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { chooseNormalChatIntent, newEnglishPage, openRightChat, saveFailureShot } from './support.ts'

const normalFixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const prompt = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'

describe('web e2e: New Session composer handoff', () => {
  it('keeps the central composer until the first message and continues in right Chat', async () => {
    const scaffold = await launchWebScaffold({ replayFixture: normalFixture, compareReplaySession: false })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    onTestFailed(() => saveFailureShot(page, 'right-chat-new-session'))
    let completed = false
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const workspace = join(scaffold.workspaceCwd, 'workspace')
      mkdirSync(workspace, { recursive: true })
      await page.getByRole('textbox', { name: 'Choose workspace' }).click()
      const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
      await picker.waitFor({ state: 'visible' })
      await picker.getByRole('button', { name: 'Edit path' }).click()
      const pathInput = picker.getByRole('textbox', { name: 'Edit path' })
      await pathInput.fill(workspace)
      await pathInput.press('Enter')
      await picker.getByRole('button', { name: 'Open', exact: true }).click()

      const main = page.locator('[data-conversation-scroll]').first()
      const mainInput = main.locator('[data-composer-input]')
      await mainInput.and(page.locator('[contenteditable="true"]')).waitFor({ state: 'visible', timeout: 15_000 })
      expect(await mainInput.count()).toBe(1)
      expect(await page.locator('[data-right-chat-panel]').count()).toBe(0)

      await page.getByRole('button', { name: 'New session', exact: true }).first().click()
      await mainInput.and(page.locator('[contenteditable="true"]')).waitFor({ state: 'visible', timeout: 15_000 })
      expect(await page.locator('[data-composer-input]').count()).toBe(1)
      await mainInput.fill(prompt)
      await mainInput.press('Enter')
      const settled = scaffold.whenTurnSettled()
      await chooseNormalChatIntent(page)
      await settled

      await expect.poll(() => main.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThan(0)
      expect(await mainInput.count()).toBe(0)
      await openRightChat(page)
      const right = page.locator('[data-right-chat-panel]')
      await right.getByText('DONE', { exact: true }).waitFor({ state: 'visible' })
      expect(await right.getByText(prompt, { exact: true }).count()).toBeGreaterThan(0)
      expect(await right.locator('[data-composer-input]').count()).toBe(1)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      completed = true
    } catch (error) {
      await saveFailureShot(page, 'right-chat-new-session')
      throw error
    } finally {
      await browser.close()
      if (completed) await scaffold.close()
      else await scaffold.close().catch(() => { /* preserve the browser failure */ })
    }
  }, 180_000)
})
