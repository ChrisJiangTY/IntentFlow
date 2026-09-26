import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'RECO',
    short_name: 'RECO',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/reco-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  })
})

it('ships the RECO favicon with light- and dark-scheme brand colors', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  expect(favicon).toContain('viewBox="0 0 24 24"')
  expect(favicon.match(/<circle /g)).toHaveLength(3)
  expect(favicon).toContain('.mark { stroke: #4176e6; }')
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*#8ab4ff/i)
  expect(favicon).toContain('M8.5 6.2L15 5.8M7.1 7.4L7.4 15.5M9.5 16.4L16 7.6')
})

it('ships a transparent square RECO install icon', async () => {
  const icon = await readFile(join(DIST_ROOT, 'reco-icon.png'))
  expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(icon.readUInt32BE(16)).toBe(512)
  expect(icon.readUInt32BE(20)).toBe(512)
  expect(icon[25]).toBe(6)
})
