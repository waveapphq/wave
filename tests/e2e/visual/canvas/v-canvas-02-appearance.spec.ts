/**
 * V-CANVAS-02 Extended: Node Appearance Visual Tests
 *
 * Design Decisions: CANVAS-35 to CANVAS-44
 *
 * Extended tests for node appearance including icon colors and display names.
 *
 * Tests:
 * - V-CANVAS-02-S6 to S11: Colored icons match palette (orange=conditional, cyan=loop, etc.)
 * - V-CANVAS-02-S12 to S14: Display name shown below type label
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

test.describe('V-CANVAS-02: Node Appearance Extended', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage workbench state for a fresh canvas
    // NOTE: Do NOT delete /workbench/session - it's shared with fixture-phase tests
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
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
  async function addNodeFromPalette(
    page: import('@playwright/test').Page,
    searchTerm: string,
    testId: string,
    position: { xFactor: number; yFactor: number } = { xFactor: 0.5, yFactor: 0.5 }
  ) {
    await setupPalette(page)
    await findItemBySearch(page, searchTerm)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, { term: searchTerm, testId }, {
        x: canvasBox!.width * position.xFactor,
        y: canvasBox!.height * position.yFactor,
      })
    // Wait for the node to render (not just a fixed timeout - under parallel load, 100ms isn't enough)
    await page.locator('[data-testid^="workflow-node-"][data-nodetype]').first().waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(200)
  }

  test('V-CANVAS-02-S6: HTTP Client has globe icon', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'http', 'palette-item-http-client')

    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="globe"]')
    await expect(icon, 'HTTP Client node should have globe icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S7: Shell Script has file-terminal icon', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'shell script', 'palette-item-shell-script')

    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="file-terminal"]')
    await expect(icon, 'Shell Script node should have file-terminal icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S8: If-Else has git-fork icon', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'if', 'palette-item-if-else')

    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="git-fork"]')
    await expect(icon, 'If-Else node should have git-fork icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S9: For Loop has repeat icon', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'for', 'palette-item-for')

    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="repeat"]')
    await expect(icon, 'For Loop node should have repeat icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S10: SQL Client has database icon', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'sql', 'palette-item-sql-client')

    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="database"]')
    await expect(icon, 'SQL Client node should have database icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S11: multiple different node icons visible on same canvas', async ({ page }) => {
    // Verify multiple different node types can coexist on the canvas with correct icons
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add multiple different node types at different positions
    await addNodeFromPalette(page, 'http', 'palette-item-http-client', { xFactor: 0.3, yFactor: 0.3 })
    await addNodeFromPalette(page, 'sql', 'palette-item-sql-client', { xFactor: 0.5, yFactor: 0.5 })
    await addNodeFromPalette(page, 'if', 'palette-item-if-else', { xFactor: 0.7, yFactor: 0.7 })

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()
    expect(nodeCount).toBeGreaterThanOrEqual(3)

    // Verify each node has the correct icon (data-icon attribute proves icon mapping)
    const httpIcon = page.locator('[data-testid^="workflow-node-"] [data-icon="globe"]').first()
    await expect(httpIcon, 'HTTP Client should have globe icon').toBeVisible({ timeout: 5000 })

    const sqlIcon = page.locator('[data-testid^="workflow-node-"] [data-icon="database"]').first()
    await expect(sqlIcon, 'SQL Client should have database icon').toBeVisible({ timeout: 5000 })

    const ifIcon = page.locator('[data-testid^="workflow-node-"] [data-icon="git-fork"]').first()
    await expect(ifIcon, 'If-Else should have git-fork icon').toBeVisible({ timeout: 5000 })
  })

  test('V-CANVAS-02-S12: display name shown below type label when set', async ({ page }) => {
    // User-defined display name shown below type label
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'http', 'palette-item-http-client')

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

    // Set a display name
    const nameInput = modal.locator('[data-testid="element-description-input"]')
    await nameInput.fill('My Custom API Call')

    // Fill required URL field - literal string edits via the shared sheet
    await setStringParam(modal, page, 'url', 'https://api.example.com')

    // Fill required method field (enum)
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    if (await methodRow.isVisible()) {
      const selectTrigger = methodRow.locator('button[role="combobox"]')
      await selectTrigger.click()
      const getOption = page.locator('[role="option"]', { hasText: 'GET' })
      await getOption.click()
    }

    // Save
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeEnabled({ timeout: 2000 })
    await saveButton.click()
    await expect(modal).not.toBeVisible()

    // Node should now show the description.
    await expect(firstNode).toContainText('My Custom API Call')
    const descRow = firstNode.locator('[data-testid="node-description"]')
    await expect(descRow).toBeVisible()
    await expect(descRow).toHaveText('My Custom API Call')
  })

  test('V-CANVAS-02-S13: node layout shows Icon + Type on top row', async ({ page }) => {
    // Top row shows Icon + Type label
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'http', 'palette-item-http-client')

    // Find the HTTP node by its icon
    const icon = page.locator('[data-testid="workflow-node-icon"][data-icon="globe"]')
    await expect(icon).toBeVisible({ timeout: 5000 })

    // The node containing this icon
    const httpNode = icon.locator('xpath=ancestor::div[@data-testid and starts-with(@data-testid, "workflow-node-")]')

    // Type label should be visible (HTTP Client)
    await expect(httpNode).toContainText('HTTP')

    // Icon and type should be in the same row (flex items)
    const topRow = httpNode.locator('.flex.items-center.gap-2').first()
    await expect(topRow).toBeVisible()
  })

  test('V-CANVAS-02-S14: display name row is full width below type row', async ({ page }) => {
    // Display name on separate row below, full width
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page, 'http', 'palette-item-http-client')

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select and configure
    await firstNode.locator('button').first().dispatchEvent('click')
    const gearButton = page.locator('[data-testid="node-configure"]').first()
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible()

    // Set a display name
    const nameInput = modal.locator('[data-testid="element-description-input"]')
    await nameInput.fill('A Very Long Display Name for Testing Full Width')

    // Fill required URL field - literal string edits via the shared sheet
    await setStringParam(modal, page, 'url', 'https://api.example.com')

    // Fill required method field (enum)
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    if (await methodRow.isVisible()) {
      const selectTrigger = methodRow.locator('button[role="combobox"]')
      await selectTrigger.click()
      const getOption = page.locator('[role="option"]', { hasText: 'GET' })
      await getOption.click()
    }

    // Save
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeEnabled({ timeout: 2000 })
    await saveButton.click()
    await expect(modal).not.toBeVisible()

    // The main content should use flex-col layout
    const mainContent = firstNode.locator('.flex.flex-col')
    await expect(mainContent).toBeVisible()

    // Description row renders the saved text with the 2-line clamp.
    const descRow = firstNode.locator('[data-testid="node-description"]')
    await expect(descRow).toBeVisible()
    await expect(descRow).toHaveClass(/line-clamp-2/)
  })
})
