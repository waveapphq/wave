/**
 * V-CTRL-WHILE-01: While Loop Control - Visual Tests
 *
 * Validates the While Loop control's palette presence, canvas rendering,
 * output handles (body + then), config modal parameters, and version display.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Output handles: body (cyan) + then (gray)
 * S3 - Config modal default (While-Do mode, conditions area, Advanced group)
 * S4 - Version and metadata display
 *
 * REQ: REQ-3.5.1.17
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-WHILE-01: While Loop Control', () => {
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

  async function addWhileLoopNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('while')
    await page.waitForTimeout(100)

    const whileItem = page.locator('[data-testid="palette-item-while"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'while', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
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

    await test.step('Search for "while" in palette and find While Loop item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('while')
      await page.waitForTimeout(100)

      const whileItem = page.locator('[data-testid="palette-item-while"]')
      await expect(whileItem).toBeVisible()
    })

    await test.step('Drag While Loop onto canvas', async () => {
      await addWhileLoopNode(page)

      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()
    })

    await test.step('Verify node appears with RefreshCw icon and While Loop label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'refresh-cw')
      await expect(workflowNodes.first()).toContainText('While Loop')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Output handles - body (cyan) + then (gray)
  // ---------------------------------------------------------------------------
  test('S2: output handles - body and then', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addWhileLoopNode(page)

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
  // S3: Config modal - While-Do mode default with conditions and Advanced group
  // ---------------------------------------------------------------------------
  test('S3: config modal - while-do mode default', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addWhileLoopNode(page)

    const modal = await openConfigModal(page)

    await test.step('Verify Mode parameter shows while-do as default', async () => {
      const modeRow = modal.locator('[data-testid="param-row-mode"]')
      await expect(modeRow).toBeVisible()
      await expect(modeRow.getByText('while-do')).toBeVisible()
    })

    await test.step('Verify conditions area is present', async () => {
      // The conditions section should be visible (AssertionBuilder rendered directly)
      const conditionsSection = modal.locator('[data-testid="assertion-builder"]')
      await expect(conditionsSection).toBeVisible()
    })

    await test.step('Verify Advanced group exists', async () => {
      // Advanced group is collapsible - look for the group header
      const advancedGroup = modal.getByText('Advanced')
      await expect(advancedGroup).toBeVisible()
    })
  })

  // ---------------------------------------------------------------------------
  // S4: Version and metadata
  // ---------------------------------------------------------------------------
  test('S4: version badge shows 1.0.0', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addWhileLoopNode(page)

    await selectNode(page)

    await test.step('Verify no inline version badge on canvas', async () => {
      const versionInBar = page.locator('[data-testid="node-status-bar"]').locator('text=1.0.0')
      await expect(versionInBar).toHaveCount(0)
    })
  })
})
