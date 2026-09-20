/** Real browser coverage for pointer lock in the installed sidebar's HTML preview. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('allows click-initiated pointer lock while keeping HTML previews isolated', async () => {
  const scaffold = await launchWebScaffold({})
  // Full Chromium supports pointer lock; the headless shell rejects its root document.
  const browser = await chromium.launch({ channel: process.env.DSH_PLAYWRIGHT_CHANNEL ?? 'chromium' })
  try {
    await writeFile(join(scaffold.workspaceCwd, 'pointer-lock.html'), `<!doctype html>
<canvas width="400" height="200" style="background:teal"></canvas><output>ready</output>
<script>
const canvas = document.querySelector('canvas');
const output = document.querySelector('output');
canvas.onclick = () => canvas.requestPointerLock().catch(error => { output.dataset.error = error.message; output.textContent = 'denied'; });
document.onpointerlockchange = () => { output.textContent = document.pointerLockElement === canvas ? 'locked' : 'released'; };
document.onpointerlockerror = () => { output.textContent = 'denied'; };
</script>`)
    await seedSession(scaffold, await readFile(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url), 'utf8'), 'pointer-lock-preview')
    const page = await newEnglishPage(browser)
    page.setDefaultTimeout(10_000)
    await page.goto(scaffold.authenticatedUrl)
    const onboarding = page.locator('[class*="onboardingOverlay"]')
    if (await onboarding.count() > 0) await onboarding.getByRole('button').click()
    const group = page.getByRole('treeitem', { name: /^Ungrouped/u })
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await page.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Files', exact: true }).click()
    await page.getByRole('button', { name: /pointer-lock\.html/u }).click()
    const iframe = page.locator('iframe[title$="pointer-lock.html"]')
    await iframe.waitFor()
    const frame = page.frameLocator('iframe[title$="pointer-lock.html"]')
    const sandbox = (await iframe.getAttribute('sandbox'))?.split(' ')
    expect(sandbox).toContain('allow-pointer-lock')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-top-navigation')
    const response = await page.request.get(new URL((await iframe.getAttribute('src'))!, page.url()).href)
    expect(response.headers()['content-security-policy']).toContain('allow-pointer-lock')
    await frame.locator('canvas').click()
    await expect.poll(() => frame.locator('output').evaluate(element => ({ status: element.textContent, error: element.getAttribute('data-error') })), { timeout: 10_000 })
      .toEqual({ status: 'locked', error: null })
    expect(await frame.locator('canvas').evaluate(element => document.pointerLockElement === element)).toBe(true)
    expect(await frame.locator('canvas').evaluate(() => {
      try { void window.parent.document; return false } catch { return true }
    })).toBe(true)
    await frame.locator('canvas').evaluate(() => { document.exitPointerLock() })
    await expect.poll(() => frame.locator('output').textContent()).toBe('released')

    // Reload with the original policy to reproduce the browser-level refusal.
    await iframe.evaluate((element) => {
      const node = element as HTMLIFrameElement
      node.sandbox.remove('allow-pointer-lock')
      node.src = node.src
    })
    await expect.poll(() => frame.locator('output').textContent()).toBe('ready')
    await frame.locator('canvas').click()
    await expect.poll(() => frame.locator('output').textContent()).toBe('denied')
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 90_000)
