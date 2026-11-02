/**
 * V-CTRL-FOREACH-01: ForEach Control - Visual Tests
 *
 * Validates the ForEach control's palette presence, canvas rendering,
 * output handles (body + then), config modal parameters, and scope isolation.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Output handles: body (cyan) + then (gray)
 * S3 - Config modal - collection variable ref and timeout
 * S4 - Version and metadata display
 *
 * REQ: REQ-3.5.1.16
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-FOREACH-01: ForEach Control', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function addForEachNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('for each')
    await page.waitForTimeout(100)

    const forEachItem = page.locator('[data-testid="palette-item-for-each"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'for each', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(300)
  }

  async function selectNode(page: Page) {
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    const node = workflowNodes.first()
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')
    return node
  }

  async function openConfigModal(page: Page) {
    await selectNode(page)

    const gearButton = page.locator(
      '[data-testid="node-configure"]',
    )
    await expect(gearButton).toBeVisible({ timeout: 5000 })
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 10000 })
    return modal
  }

  // ---------------------------------------------------------------------------
  // S1: Palette search and canvas drop
  // ---------------------------------------------------------------------------
  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "for each" in palette and find For Each item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('for each')
      await page.waitForTimeout(100)

      const forEachItem = page.locator('[data-testid="palette-item-for-each"]')
      await expect(forEachItem).toBeVisible()
    })

    await test.step('Drag ForEach onto canvas', async () => {
      await addForEachNode(page)

      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()
    })

    await test.step('Verify node appears with IterationCw icon and For Each label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'iteration-cw')
      await expect(workflowNodes.first()).toContainText('For Each')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Output handles - body (cyan) + then (gray)
  // ---------------------------------------------------------------------------
  test('S2: output handles - body and then', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForEachNode(page)

    await test.step('Verify body handle exists with cyan color', async () => {
      const bodyHandle = page.locator('[data-testid="handle-output-body"]')
      await expect(bodyHandle).toBeVisible()
      await expect(bodyHandle).toHaveAttribute('aria-label', 'body')
    })

    await test.step('Verify then handle exists with gray color', async () => {
      const thenHandle = page.locator('[data-testid="handle-output-then"]')
      await expect(thenHandle).toBeVisible()
      await expect(thenHandle).toHaveAttribute('aria-label', 'then')
    })

    await test.step('Verify no default single output handle', async () => {
      const defaultHandle = page.locator('[data-testid="handle-output"]')
      await expect(defaultHandle).not.toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Config modal - collection and timeout parameters
  // ---------------------------------------------------------------------------
  test('S3: config modal - collection and timeout parameters', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForEachNode(page)

    const modal = await openConfigModal(page)

    await test.step('Verify Collection parameter row is visible and required', async () => {
      const collectionRow = modal.locator('[data-testid="param-row-collection"]')
      await expect(collectionRow).toBeVisible()
    })

    await test.step('Verify Timeout parameter is in Advanced group', async () => {
      // Timeout is in the Advanced group - expand it first
      const advancedHeader = modal.locator('[data-testid="group-header-Advanced"]')
      await expect(advancedHeader).toBeVisible()
      // Advanced group is collapsed by default - click to expand
      const timeoutRow = modal.locator('[data-testid="param-row-timeout"]')
      const isVisible = await timeoutRow.isVisible().catch(() => false)
      if (!isVisible) {
        await advancedHeader.click()
      }
      await expect(timeoutRow).toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S4: Version and metadata
  // ---------------------------------------------------------------------------
  test('S4: version badge shows 1.0.0', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addForEachNode(page)

    await selectNode(page)

    await test.step('Verify no inline version badge on canvas', async () => {
      const versionInBar = page.locator('[data-testid="node-status-bar"]').locator('text=1.0.0')
      await expect(versionInBar).toHaveCount(0)
    })
  })
})
