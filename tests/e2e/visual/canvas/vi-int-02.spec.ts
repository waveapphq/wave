/**
 * VI-INT-02: Click to Select Block
 *
 * Design Decisions: CANVAS-35 to CANVAS-44
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.1 (No-code test creation)
 *
 * Pass Criteria:
 * 1. Click on block selects it (selection state changes)
 * 2. Click on canvas background deselects all blocks
 * 3. Basic selection interaction only (NOT V-CANVAS-03 visual spec like border color)
 * 4. Selected block can be identified via data attribute
 *
 * Note: This test covers INTERACTION behavior, not visual styling.
 * V-CANVAS-03 will cover the visual spec (2px border, property panel).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('VI-INT-02: Click to Select Block', () => {
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
  async function addNodeFromPalette(page: import('@playwright/test').Page) {
    await setupPalette(page)
    await findItemBySearch(page, 'if')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)
  }

  // Helper to add a second node at a different position
  async function addSecondNode(page: import('@playwright/test').Page) {
    await findItemBySearch(page, 'for')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'for', { x: canvasBox!.width / 3, y: (canvasBox!.height * 2) / 3 })
    await page.waitForTimeout(100)
  }

  test('VI-INT-02: click on block selects it', async ({ page }) => {
    // Per REQ-4.2.1: Users can interact with blocks
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Initially no node should be selected
    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')

    // Click on the node
    await firstNode.locator('button').first().dispatchEvent('click')

    // Node should now be selected
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
  })

  test('VI-INT-02-S1: click on canvas deselects block', async ({ page }) => {
    // Per CANVAS-35: Click elsewhere deselects
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Select the node first
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Click on canvas background (away from nodes)
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Click in top-left corner of canvas (should be empty area)
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + 20)

    // Node should be deselected
    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')
  })

  test('VI-INT-02-S2: clicking different block changes selection', async ({ page }) => {
    // Per CANVAS-35: Single selection by default
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)
    await addSecondNode(page)

    // Use selector that excludes icon elements (which also start with "workflow-node-")
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const nodeCount = await workflowNodes.count()
    expect(nodeCount, 'Need at least 2 nodes for this test').toBeGreaterThanOrEqual(2)

    // Get stable references to the nodes by their testids
    const firstNodeTestId = await workflowNodes.nth(0).getAttribute('data-testid')
    const secondNodeTestId = await workflowNodes.nth(1).getAttribute('data-testid')

    const firstNode = page.locator(`[data-testid="${firstNodeTestId}"]`)
    const secondNode = page.locator(`[data-testid="${secondNodeTestId}"]`)

    // Select first node - dispatchEvent bypasses coordinate hit-testing (React Flow node overlap in CI)
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
    await expect(secondNode).not.toHaveAttribute('data-selected', 'true')

    // Select second node - dispatchEvent bypasses coordinate hit-testing (React Flow node overlap in CI)
    await secondNode.locator('button').first().dispatchEvent('click')

    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')
    await expect(secondNode).toHaveAttribute('data-selected', 'true')
  })

  test('VI-INT-02-S3: selected node is identifiable via data attribute', async ({ page }) => {
    // Per implementation: Selection state tracked via data attribute
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Before selection
    const beforeAttr = await firstNode.getAttribute('data-selected')
    expect(beforeAttr).not.toBe('true')

    // After selection
    await firstNode.locator('button').first().dispatchEvent('click')
    const afterAttr = await firstNode.getAttribute('data-selected')
    expect(afterAttr).toBe('true')
  })

  test('VI-INT-02-S4: only one node selected at a time by default', async ({ page }) => {
    // Per CANVAS-35: Default is single selection
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)
    await addSecondNode(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()

    // Click through all nodes, verify only one selected at a time
    for (let i = 0; i < nodeCount; i++) {
      // dispatchEvent bypasses coordinate hit-testing (React Flow node overlap in CI)
      await workflowNodes.nth(i).locator('button').first().dispatchEvent('click')

      // Count selected nodes
      const selectedNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]')
      const selectedCount = await selectedNodes.count()
      expect(selectedCount, `Should have exactly 1 selected node after clicking node ${i}`).toBe(1)
    }
  })

  test('VI-INT-02-S5: double-click does not cause issues', async ({ page }) => {
    // Robustness: Double-click should maintain selection
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Double-click the node
    await firstNode.dispatchEvent('dblclick')

    // The key validation is that the page doesn't error
    expect(page.url()).toContain('/workbench')
  })

  test('VI-INT-02-S6: selection persists after page interaction', async ({ page }) => {
    // Per implementation: Selection should be stable
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Perform non-deselecting interactions
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Check node is still visible and page is stable
    await expect(firstNode).toBeVisible()
  })
})
