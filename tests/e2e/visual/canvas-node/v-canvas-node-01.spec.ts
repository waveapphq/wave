/**
 * V-CANVAS-NODE-01: Plugin node idle, no description
 *
 * Design Decisions: Element Node Visual Structure
 *
 * Phase: no-data (parallel) - drops a Shell Script plugin onto an empty canvas.
 *
 * Pass Criteria:
 *   1. The persistent status bar is rendered (always visible, never gated on selection).
 *   2. Cog (Configure) and kebab (More options) actions are both present in the right cluster.
 *   3. No alert badge, no run-state badge, no function-lifecycle badge, no ver-arrow on a fresh node.
 *   4. No description row is rendered for a node without `data.description`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openNodeSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

async function dropShellScript(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'shell script', { x: cb!.width / 2, y: cb!.height / 2 })
  // The outer node wrapper is the only element with data-nodetype set,
  // which disambiguates it from the body <button> (workflow-node-body-<id>)
  // and the inner icon span (workflow-node-icon).
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
}

test.describe('V-CANVAS-NODE-01: plugin idle, no description', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: persistent status bar is rendered without selection', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    // Bar must exist in DOM unconditionally, with no selection halo applied yet.
    const bar = node.locator('[data-testid="node-status-bar"]')
    await expect(bar).toBeVisible()
    await expect(node).not.toHaveAttribute('data-selected', 'true')
    await expect(bar).toBeVisible()
  })

  test('S2: action cluster shows cog and kebab; no version-update arrow', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    const cog = node.locator('[data-testid="node-configure"]')
    const kebab = node.locator('[data-testid="node-kebab"]')
    const verArrow = node.locator('[data-testid="version-update-indicator"]')

    await expect(cog).toBeVisible()
    await expect(kebab).toBeVisible()
    await expect(verArrow).toHaveCount(0)
  })

  test('S3: left cluster has no badges for an undecorated node', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    // A dropped Shell Script has no Script, which IS a validation issue; fill it so the node is clean.
    await node.locator('button').first().dispatchEvent('click')
    await openNodeSheet(page, node)
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    await setStringParam(modal, page, 'script', 'echo hello')
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(modal).toBeHidden()

    await expect(node.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)
    await expect(node.locator('[data-testid="node-run-state-badge"]')).toHaveCount(0)
    await expect(node.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveCount(0)
  })

  test('S4: no description row is rendered when data.description is absent', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    await expect(node.locator('[data-testid="node-description"]')).toHaveCount(0)
    await expect(node.locator('[data-testid="node-description-chevron"]')).toHaveCount(0)
  })

  test('S5: function-only affordances (dig-in glyph, L/S badge) are hidden on a plugin', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const node = await dropShellScript(page)

    await expect(node.locator('[data-testid="node-dig-in"]')).toHaveCount(0)
    await expect(node.locator('[data-testid="node-function-lifecycle-badge"]')).toHaveCount(0)
  })
})
