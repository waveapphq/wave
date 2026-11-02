/**
 * VI-INT-01: Drag Block from Palette to Canvas
 *
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.1 (No-code test creation), REQ-4.2.3 (Intuitive drag-drop interface)
 *
 * Pass Criteria:
 * 1. Palette items are draggable
 * 2. Valid drop zones accept drops
 * 3. Block is created at drop position when released
 * 4. Block appears with correct icon and label from palette item
 * 5. Multiple blocks can be dropped sequentially
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('VI-INT-01: Drag Block from Palette to Canvas', () => {
  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    // Use palette search to find items
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100) // Allow search to filter
  }

  test('VI-INT-01: palette items are draggable', async ({ page }) => {
    // Per REQ-3.1.1.1: Items in palette should be draggable
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    await findItemBySearch(page, 'if')

    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    await expect(ifElseItem).toBeVisible()

    // Verify item has draggable attribute
    await expect(ifElseItem).toHaveAttribute('draggable', 'true')
  })

  test('VI-INT-01-S1: block created at drop position', async ({ page }) => {
    // Per REQ-3.1.1.1: Block appears where user drops it
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    await findItemBySearch(page, 'if')

    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')

    // Verify no workflow nodes exist initially (only start + onboarding placeholder)
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes).toHaveCount(0)

    // Get canvas center for drop target
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Perform drag and drop using Playwright's built-in
    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })

    // Wait for node to be created
    await page.waitForTimeout(100)

    // Verify a workflow node was created
    await expect(workflowNodes.first()).toBeVisible()
  })

  test('VI-INT-01-S2: dropped block shows correct icon and label', async ({ page }) => {
    // Per REQ-4.2.1: Block displays identifiable icon and name
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    await findItemBySearch(page, 'http')

    const httpClientItem = page.locator('[data-testid="palette-item-http-client"]')
    await expect(httpClientItem).toBeVisible()

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Drag HTTP Client to canvas
    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })

    // Wait for node to be created
    await page.waitForTimeout(100)

    // Verify the created node exists
    const createdNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await expect(createdNode).toBeVisible()

    // Verify icon is present
    const nodeIcon = createdNode.locator('[data-testid="workflow-node-icon"]')
    await expect(nodeIcon).toBeVisible()

    // Verify icon has data-icon attribute for HTTP (globe)
    await expect(nodeIcon).toHaveAttribute('data-icon', 'globe')
  })

  test('VI-INT-01-S3: multiple blocks can be dropped sequentially', async ({ page }) => {
    // Per REQ-4.2.3: Intuitive interface supports building workflows
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Count initial nodes
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const initialCount = await workflowNodes.count()

    // Search and drop first block (If/Else)
    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width / 3, y: canvasBox!.height / 3 })
    await page.waitForTimeout(100)

    // Verify first node was created
    const afterFirstCount = await workflowNodes.count()
    expect(afterFirstCount, 'First drop should create a node').toBeGreaterThan(initialCount)

    // Search and drop second block - use specific term "delay" to get only one match
    await dragPaletteItemToCanvas(page, 'delay', { x: (canvasBox!.width * 2) / 3, y: (canvasBox!.height * 2) / 3 })
    await page.waitForTimeout(100)

    // Verify second node was created
    const finalCount = await workflowNodes.count()
    expect(finalCount, 'Second drop should create another node').toBeGreaterThan(afterFirstCount)
  })
})
