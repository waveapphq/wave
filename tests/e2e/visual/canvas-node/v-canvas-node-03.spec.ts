/**
 * V-CANVAS-NODE-03: Control node idle, no description
 *
 * Design Decisions: Element Node Visual Structure
 *
 * Phase: no-data (parallel) - drops an If/Else control onto an empty canvas.
 *
 * Pass Criteria:
 *   1. The persistent status bar is rendered for control-kind nodes too.
 *   2. Cog (Configure) and kebab (More options) actions are both present.
 *   3. No dig-in glyph (function-only) and no L/S badge (function-only).
 *   4. The card's `data-nodetype="control"` attribute exposes the kind.
 *   5. No description row for a control without `data.description`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

async function dropIfElse(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'if', { x: cb!.width / 2, y: cb!.height / 2 })
  return page.locator('[data-testid^="workflow-node-"][data-nodetype="control"]').first()
}

test.describe('V-CANVAS-NODE-03: control idle, no description', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: persistent status bar is rendered for a control kind', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropIfElse(page)

    await expect(node).toBeVisible()
    await expect(node).toHaveAttribute('data-nodetype', 'control')
    await expect(node.locator('[data-testid="node-status-bar"]')).toBeVisible()
  })

  test('S2: action cluster shows cog and kebab; no version arrow', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropIfElse(page)

    await expect(node.locator('[data-testid="node-configure"]')).toBeVisible()
    await expect(node.locator('[data-testid="node-kebab"]')).toBeVisible()
    await expect(node.locator('[data-testid="version-update-indicator"]')).toHaveCount(0)
  })

  test('S3: function-only affordances are hidden on a control', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropIfElse(page)

    await expect(node.locator('[data-testid="node-dig-in"]')).toHaveCount(0)
    await expect(node.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveCount(0)
  })

  test('S4: no description row when data.description is absent', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropIfElse(page)

    await expect(node.locator('[data-testid="node-description"]')).toHaveCount(0)
  })

  test('S5: no run-state badge on an idle control', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropIfElse(page)

    await expect(node.locator('[data-testid="node-run-state-badge"]')).toHaveCount(0)
  })
})
