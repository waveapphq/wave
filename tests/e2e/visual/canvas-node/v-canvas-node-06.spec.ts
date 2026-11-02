/**
 * V-CANVAS-NODE-06: Plugin DISABLED state
 *
 * Design Decisions: Element Node Visual Structure (full-card grayscale + opacity 0.55); disable is structural, not a runtime skip
 *
 * Phase: no-data (parallel) - drops a Shell Script plugin and toggles Disable via the
 * kebab menu. `data.disabled = true` is a structural state set at design time;
 * no execution required.
 *
 * Pass Criteria:
 *   1. Card outer wrapper carries `grayscale` and `opacity-[0.55]` classes.
 *   2. Status bar shows a DISABLED badge with `data-state="disabled"`.
 *   3. The card's `data-disabled="true"` attribute is set.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

async function dropAndDisableShellScript(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: cb!.width / 2, y: cb!.height / 2 })
  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await expect(node).toBeVisible()

  // Select the node so the kebab is interactive, then open it.
  await node.locator('button').first().dispatchEvent('click')
  const kebab = node.locator('[data-testid="node-kebab"]')
  await expect(kebab).toBeVisible()
  await kebab.click()

  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Disable' }).click()
  await expect(menu).not.toBeVisible()

  return node
}

test.describe('V-CANVAS-NODE-06: plugin DISABLED', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: card wrapper carries grayscale + opacity-[0.55] classes', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropAndDisableShellScript(page)

    await expect(node).toHaveAttribute('data-disabled', 'true')
    await expect(node).toHaveClass(/grayscale/)
    await expect(node).toHaveClass(/opacity-\[0\.55\]/)
  })

  test('S2: DISABLED run-state badge renders in the status bar', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropAndDisableShellScript(page)

    const badge = node.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'disabled')
    await expect(badge).toHaveText('DISABLED')
  })

  test('S3: persistent status bar is still rendered when disabled (always visible)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropAndDisableShellScript(page)

    await expect(node.locator('[data-testid="node-status-bar"]')).toBeVisible()
    await expect(node.locator('[data-testid="node-configure"]')).toBeVisible()
    await expect(node.locator('[data-testid="node-kebab"]')).toBeVisible()
  })
})
