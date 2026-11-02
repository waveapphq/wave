/**
 * V-PLUGIN-REMOTE-ICONS-01: Remote-section icons + order
 *
 * Phase: no-data (palette only, no backend data).
 * Design Decisions: REMICON-1 (amended: SFTP joins the section before Remote Execution), SFTP-10
 * REQ: REQ-3.4.1.3, REQ-3.4.4.2
 *
 * Pass Criteria:
 * 1. The Remote section has exactly 8 plugin entries, all cyan.
 * 2. The 8 icons are visually DISTINCT (distinct rendered SVG geometry), so no
 *    two Remote entries look the same; SFTP's FolderSync differs from the other seven.
 * 3. The expanded Remote subcategory lists them in the REMICON-1 order: Session Open,
 *    Session Exec, Session Script, Session Close, Tunnel Open, Tunnel Close, SFTP,
 *    Remote Execution.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

// REMICON-1 order (Session Open -> ... -> SFTP -> Remote Execution).
const REMOTE_ORDER = [
  'ssh-session-open',
  'ssh-session-exec',
  'ssh-session-script',
  'ssh-session-close',
  'ssh-tunnel-open',
  'ssh-tunnel-close',
  'sftp',
  'remote-execution',
]

async function openPluginsFlyout(page: import('@playwright/test').Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  if ((await palette.getAttribute('data-state')) === 'expanded') {
    await page.locator('[data-testid="palette-collapse-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
  }
  await page.locator('[data-testid="palette-icon-plugins"]').click()
  const flyout = page.locator('[data-testid="palette-flyout-plugins"]')
  await expect(flyout).toBeVisible()
  return flyout
}

test.describe('V-PLUGIN-REMOTE-ICONS-01: Remote-section icons', () => {
  test('V-PLUGIN-REMOTE-ICONS-01-S1: all 8 Remote entries render cyan icons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const flyout = await openPluginsFlyout(page)

    for (const id of REMOTE_ORDER) {
      const item = flyout.locator(`[data-testid="flyout-item-${id}"]`)
      await expect(item).toBeVisible()
      await expect(item.locator('svg').first()).toHaveClass(/text-cyan-500/)
    }
  })

  test('V-PLUGIN-REMOTE-ICONS-01-S2: the 8 Remote icons are visually distinct', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const flyout = await openPluginsFlyout(page)

    // Compare the rendered SVG geometry (child <path>/<rect>... markup) - it is
    // identical only when two icons are the same glyph. Classes are stripped so
    // the shared cyan/size classes don't mask a genuine glyph collision.
    const shapes: string[] = []
    for (const id of REMOTE_ORDER) {
      const svg = flyout.locator(`[data-testid="flyout-item-${id}"] svg`).first()
      await expect(svg).toBeVisible()
      shapes.push(await svg.innerHTML())
    }
    const distinct = new Set(shapes)
    expect(
      distinct.size,
      `Expected 8 distinct Remote glyphs, got ${distinct.size} unique of ${shapes.length}`
    ).toBe(REMOTE_ORDER.length)
  })

  test('V-PLUGIN-REMOTE-ICONS-01-S3: expanded Remote subcategory lists the 8 entries in REMICON-1 order', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const remote = page.locator('[data-testid="palette-subcat-remote"]')
    await remote.locator('[data-testid="subcategory-header"]').click()

    const items = remote.locator('[data-testid^="palette-item-"]')
    await expect(items).toHaveCount(REMOTE_ORDER.length)
    const testIds = await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid'))
    )
    expect(testIds).toEqual(REMOTE_ORDER.map((id) => `palette-item-${id}`))
  })
})
