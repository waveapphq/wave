/**
 * V-CANVAS-NODE-04: Plugin validation alert badge (structural)
 *
 * Design Decisions: Element Node Visual Structure (left cluster order: alert -> L/S -> run state); no bg tint on execution
 *
 * Phase: no-data (parallel) - drops an HTTP plugin without filling its required
 * `url` parameter so the design-time validation produces a node issue;
 * the persistent status bar's alert badge is rendered for that node.
 *
 * The FAIL run-state portion of V-04 needs a real workflow run +
 * environment and is not covered here: a page.route mock of the historical
 * canvas intercepts the API call, but the response never propagates back
 * through the apiClient envelope, so this test covers the
 * design-time-testable subset.
 *
 * Pass Criteria (structural, no execution):
 *   1. Alert badge (`node-validation-alert`) is visible for an HTTP node
 *      whose required `url` parameter is unset.
 *   2. The alert sits inside the left cluster of the persistent status bar.
 *   3. The body still uses `bg-elevated` (no execution bg tint).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

async function dropHttpWithoutUrl(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: cb!.width / 2, y: cb!.height / 2 })
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
}

test.describe('V-CANVAS-NODE-04: validation alert badge (structural)', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: alert badge renders for an HTTP node with no URL set', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropHttpWithoutUrl(page)
    await expect(node).toBeVisible()

    // HTTP Client requires `url`; an unset URL is a design-time validation issue.
    await expect(node.locator('[data-testid="node-validation-alert"]')).toBeVisible()
  })

  test('S2: alert sits inside the left cluster of the persistent status bar', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropHttpWithoutUrl(page)
    await expect(node).toBeVisible()

    const left = node.locator('[data-testid="node-status-bar-left"]')
    await expect(left).toBeVisible()
    await expect(left.locator('[data-testid="node-validation-alert"]')).toHaveCount(1)
  })

  test('S3: body uses bg-elevated (no execution bg tint)', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropHttpWithoutUrl(page)
    const bodyButton = node.locator('[data-testid^="workflow-node-body-"]')
    await expect(bodyButton).toBeVisible()
    await expect(bodyButton).toHaveClass(/bg-elevated/)
  })
})
