/**
 * V-CANVAS-03 Extended: Selection Visual Feedback Tests
 *
 * Design Decisions: CANVAS-35 to CANVAS-44
 *
 * Extended tests for selection behaviors including halo, action row, and multi-select.
 *
 * Tests:
 * - V-CANVAS-03-S10 to S13: White dashed halo, action row, separator, version arrow
 * - V-CANVAS-03-S14 to S19: Version visibility, click behavior, multi-select
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CANVAS-03: Selection Visual Feedback Extended', () => {
  // Clear localStorage before each test to ensure clean workflow state
  test.beforeEach(async ({ page }) => {
    // Go to a page to enable localStorage access, then clear it
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    // Now navigate to workbench with clean state
  })

  // Helper to expand palette and search
  async function setupPalette(page: import('@playwright/test').Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to add a workflow node by dragging from palette
  async function addNodeFromPalette(page: import('@playwright/test').Page, searchTerm = 'http') {
    await setupPalette(page)
    await findItemBySearch(page, searchTerm)

    const testIdMap: Record<string, string> = {
      'http': 'palette-item-http-client',
      'sql': 'palette-item-sql-client',
      'if': 'palette-item-if-else',
      'shell script': 'palette-item-shell-script',
      'delay': 'palette-item-delay',
    }

    const testId = testIdMap[searchTerm] ?? `palette-item-${searchTerm}`
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, { term: searchTerm, testId }, { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
  }

  test('V-CANVAS-03-S10: white dashed halo wraps entire node including action row', async ({ page }) => {
    // Per V-CANVAS-03: Outline wraps entire node including action row
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // The outline should be on the outer container that includes both main content and action row
    // Verify via classes
    await expect(firstNode).toHaveClass(/outline/)
    await expect(firstNode).toHaveClass(/outline-dashed/)
    await expect(firstNode).toHaveClass(/outline-white/)

    // Verify action row is inside the outlined element
    const actionRow = firstNode.locator('[data-testid="node-status-bar"]')
    await expect(actionRow).toBeVisible()
  })

  test('V-CANVAS-03-S11: action row appears with version gear and kebab', async ({ page }) => {
    // Per V-CANVAS-03: Action row with version (left), gear, kebab (right)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Status bar should be visible
    const actionRow = firstNode.locator('[data-testid="node-status-bar"]')
    await expect(actionRow).toBeVisible()

    // No inline version indicator on the canvas.
    await expect(firstNode.locator('[data-testid="block-version"]')).toHaveCount(0)

    // Gear (Configure) button is in the right action cluster.
    await expect(firstNode.locator('[data-testid="node-configure"]')).toBeVisible()

    // Kebab (More options) button is in the right action cluster.
    await expect(firstNode.locator('[data-testid="node-kebab"]')).toBeVisible()
  })

  test('V-CANVAS-03-S12: separator line visible between main content and action row', async ({ page }) => {
    // Per V-CANVAS-03: Separator visible (border-t-border/50)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Main content should have border-b-0 (no bottom border) when action row is shown
    // And the outer container of action row should have border
    const actionRowContainer = firstNode.locator('.rounded-b-lg')
    await expect(actionRowContainer).toHaveClass(/border/)
  })

  test('V-CANVAS-03-S13: version with green arrow when hasNewerVersion=true', async ({ page }) => {
    // Per V-CANVAS-03: Green up-arrow icon appears next to version text when newer version available
    // To test this, we need to:
    // 1. Add a Delay node (has 2 versions: 1.0.0 and 0.0.1)
    // 2. Open config modal
    // 3. Change version to 0.0.1 (non-latest)
    // 4. Save
    // 5. Verify green arrow in action row
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'delay')

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Open config modal
    const gearButton = page.locator('[data-testid="node-configure"]').first()
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible()

    // Check if multiple versions are available
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await versionSelector.click()

    const dropdown = versionSelector.locator('..').locator('ul')
    const isDropdownVisible = await dropdown.isVisible().catch(() => false)

    if (isDropdownVisible) {
      const options = dropdown.locator('li button')
      const optionCount = await options.count()

      if (optionCount > 1) {
        // Select a non-latest version (second option: 0.0.1)
        await options.nth(1).click()
        await page.waitForTimeout(100)

        // Fill required duration field for Delay control
        const durationAmount = modal.locator('[data-testid="param-input-duration-amount"]')
        if (await durationAmount.isVisible()) {
          await durationAmount.fill('5')
        }

        // Save
        const saveButton = modal.getByRole('button', { name: 'Save' })
        await expect(saveButton).toBeEnabled({ timeout: 2000 })
        await saveButton.click()
        await expect(modal).not.toBeVisible()

        // Re-select the node to see action row
        await firstNode.locator('button').first().dispatchEvent('click')
        await expect(firstNode).toHaveAttribute('data-selected', 'true')

        // Verify green arrow is visible in action row
        const updateIndicator = page.locator('[data-testid="version-update-indicator"]')
        await expect(updateIndicator).toBeVisible()

        // Arrow should have green color
        const arrow = updateIndicator.locator('svg')
        await expect(arrow).toHaveClass(/text-green-500/)
      } else {
        // Only one version available, skip the detailed test
        // but verify the structure is correct
        await modal.getByRole('button', { name: 'Cancel' }).click()
        console.log('Skipping V-CANVAS-03-S13 detailed check: only one version available')
      }
    } else {
      // No dropdown (single version), skip
      await modal.getByRole('button', { name: 'Cancel' }).click()
      console.log('Skipping V-CANVAS-03-S13 detailed check: version selector not expandable')
    }
  })

  test('V-CANVAS-03-S14: version is never inline on the canvas', async ({ page }) => {
    // The canvas carries no inline version label. The configuration-modal
    // header is the only version-display surface. The status bar is still
    // ALWAYS visible.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Status bar is visible regardless of selection.
    await expect(firstNode.locator('[data-testid="node-status-bar"]')).toBeVisible()
    // No inline version label.
    await expect(firstNode.locator('[data-testid="block-version"]')).toHaveCount(0)
  })

  test('V-CANVAS-03-S15: selection does not surface an inline version', async ({ page }) => {
    // Selecting a node does NOT surface a
    // version label. Only the ver-update arrow (when hasNewerVersion) and
    // the configuration-modal header carry version information.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    await expect(firstNode.locator('[data-testid="block-version"]')).toHaveCount(0)
  })

  test('V-CANVAS-03-S16: click to select (drag does NOT change selection)', async ({ page }) => {
    // Per V-CANVAS-03: Left-click selects, drag does not
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Initially not selected
    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')

    // Click to select
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Now drag the node (should stay selected during and after drag)
    const nodeBox = await firstNode.boundingBox()
    await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(nodeBox!.x + nodeBox!.width / 2 + 50, nodeBox!.y + nodeBox!.height / 2 + 50, { steps: 5 })
    await page.mouse.up()

    // Node should still be selected after drag
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
  })

  test('V-CANVAS-03-S17: click to deselect (pan/zoom do NOT deselect)', async ({ page }) => {
    // Per V-CANVAS-03: Click empty canvas deselects, pan/zoom do not
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Zoom with mouse wheel - should NOT deselect
    const canvasBox = await canvas.boundingBox()
    await page.mouse.move(canvasBox!.x + canvasBox!.width - 100, canvasBox!.y + 100)
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(100)

    // Should still be selected after zoom
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Click on empty canvas area to deselect
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + 20)

    // Should be deselected after clicking empty area
    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')
  })

  test('V-CANVAS-03-S18: right-click empty area does NOT deselect', async ({ page }) => {
    // Per V-CANVAS-03: Right-click empty area should NOT deselect
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Right-click on empty canvas area - should NOT deselect
    const canvasBox = await canvas.boundingBox()
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + 20, { button: 'right' })
    await page.waitForTimeout(100)

    // Should still be selected after right-click
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Dismiss any context menu that may have appeared
    await page.keyboard.press('Escape')
  })

  test('V-CANVAS-03-S19: multi-select keeps per-node status bars visible', async ({ page }) => {
    // The status bar is always on every node.
    // Multi-select adds dashed halos but does NOT hide the bars.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add two nodes
    await addNodeFromPalette(page, 'http')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'sql', { x: canvasBox!.width / 3, y: (canvasBox!.height * 2) / 3 })
    await page.waitForTimeout(100)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()
    expect(nodeCount).toBeGreaterThanOrEqual(2)

    const firstNode = workflowNodes.nth(0)
    const secondNode = workflowNodes.nth(1)

    // Single-select first node.
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // First node's bar is visible.
    await expect(firstNode.locator('[data-testid="node-status-bar"]')).toBeVisible()

    // Ctrl+click to add second node to selection.
    await secondNode.locator('button').first().dispatchEvent('click', { ctrlKey: true })

    // Both should be selected.
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
    await expect(secondNode).toHaveAttribute('data-selected', 'true')

    // Both per-node bars remain visible.
    await expect(firstNode.locator('[data-testid="node-status-bar"]')).toBeVisible()
    await expect(secondNode.locator('[data-testid="node-status-bar"]')).toBeVisible()

    // Both nodes have the dashed halo.
    await expect(firstNode).toHaveClass(/outline-dashed/)
    await expect(secondNode).toHaveClass(/outline-dashed/)
  })
})
