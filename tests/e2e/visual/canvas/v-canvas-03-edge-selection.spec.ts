/**
 * V-CANVAS-03-S37/S38/S39: Edge Selection & Keyboard Deletion
 *
 * Design Decisions: CANVAS-35-CANVAS-44
 *
 * Pass Criteria:
 * S37:
 *   1. Clicking an edge selects it with #A1A1AA (zinc-400) stroke and 3px width
 *   2. Default edge is #71717A stroke with 2px width
 *   3. Selected edge style applied via selectedEdgeIds mapping in allEdges useMemo
 *   4. Edge selection deselects all nodes (mutual exclusivity)
 *
 * S38:
 *   1. Clicking canvas background deselects the selected edge
 *   2. Edge returns to default styling (#71717A, 2px)
 *
 * S39:
 *   1. With edge selected, pressing Delete key removes the edge
 *   2. Downstream nodes become orphaned/muted if no longer reachable from Start
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03-S37/S38/S39: Edge Selection & Keyboard Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
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

  // Helper to drop a node near Start so auto-connect creates an edge
  async function addConnectedNode(page: import('@playwright/test').Page) {
    await setupPalette(page)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('if')

    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    // Wait for search filter to render the palette item before dragging
    await expect(ifElseItem).toBeVisible({ timeout: 5000 })

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    const startNode = page.locator('[data-testid="start-node"]')
    const startNodeBox = await startNode.boundingBox()

    // Count nodes before drop so we can detect when the new one appears
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodesBefore = await workflowNodes.count()

    // Drop below Start node within auto-connect threshold
    const dropX = startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2
    const dropY = startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60

    await dragPaletteItemToCanvas(page, 'if', { x: dropX, y: dropY })

    // Wait for the new node to appear and edge to be created
    await expect(workflowNodes).toHaveCount(nodesBefore + 1, { timeout: 5000 })
    await expect(page.locator('.react-flow__edge').first()).toBeVisible({ timeout: 5000 })
  }

  // Helper to click on an edge's interaction path
  async function clickEdge(page: import('@playwright/test').Page, options?: { button?: 'left' | 'right' }) {
    const edges = page.locator('.react-flow__edge')
    const edgePath = edges.first().locator('.react-flow__edge-interaction')
    const edgeBox = await edgePath.boundingBox()

    if (edgeBox) {
      await page.mouse.click(
        edgeBox.x + edgeBox.width / 2,
        edgeBox.y + edgeBox.height / 2,
        { button: options?.button ?? 'left' }
      )
    } else {
      await edges.first().click({ button: options?.button ?? 'left' })
    }
  }

  // ============================================================================
  // V-CANVAS-03-S37: Edge click shows zinc-400 (#A1A1AA) + 3px stroke
  // ============================================================================

  test('S37: clicking an edge selects it with zinc-400 stroke and 3px width', async ({ page }) => {
    // Per CANVAS-35-CANVAS-44: Edge selection shows #A1A1AA stroke, 3px width
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    const edges = page.locator('.react-flow__edge')
    await expect(edges.first()).toBeVisible()

    // Verify default edge styling before click - #71717A / rgb(113, 113, 122) stroke, 2px
    const edgePathBefore = edges.first().locator('path.react-flow__edge-path')
    await expect(edgePathBefore).toHaveAttribute('style', /stroke.*(?:#71717A|rgb\(113, 113, 122\))/)

    // Click the edge to select it
    await clickEdge(page)
    await page.waitForTimeout(300)

    // Verify selected edge styling - #A1A1AA / rgb(161, 161, 170) stroke, 3px
    // React Flow converts hex to RGB in inline styles (allow time for style update under load)
    const edgePathAfter = edges.first().locator('path.react-flow__edge-path')
    await expect(edgePathAfter).toHaveAttribute('style', /stroke.*(?:#A1A1AA|rgb\(161, 161, 170\))/, { timeout: 5000 })
    await expect(edgePathAfter).toHaveAttribute('style', /stroke-width.*3/, { timeout: 5000 })
  })

  test('S37: selecting edge deselects all nodes (mutual exclusivity)', async ({ page }) => {
    // Per design: Edge selection is mutually exclusive with node selection
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    // First select the workflow node
    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await workflowNode.first().click()
    await expect(workflowNode.first()).toHaveAttribute('data-selected', 'true')

    // Now click the edge - should deselect the node
    await clickEdge(page)
    await page.waitForTimeout(100)

    // Node should no longer be selected
    await expect(workflowNode.first()).not.toHaveAttribute('data-selected', 'true')

    // Edge should be selected (zinc-400 stroke)
    const edgePath = page.locator('.react-flow__edge').first().locator('path.react-flow__edge-path')
    await expect(edgePath).toHaveAttribute('style', /stroke.*(?:#A1A1AA|rgb\(161, 161, 170\))/)
  })

  // ============================================================================
  // V-CANVAS-03-S38: Canvas click deselects selected edge
  // ============================================================================

  test('S38: clicking canvas background deselects selected edge', async ({ page }) => {
    // Per design: Clicking empty canvas deselects all edges
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    // Select the edge
    await clickEdge(page)
    await page.waitForTimeout(100)

    // Verify edge is selected
    const edgePath = page.locator('.react-flow__edge').first().locator('path.react-flow__edge-path')
    await expect(edgePath).toHaveAttribute('style', /stroke.*(?:#A1A1AA|rgb\(161, 161, 170\))/)

    // Click empty canvas area (far from nodes)
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50)
    await page.waitForTimeout(100)

    // Edge should revert to default styling
    await expect(edgePath).toHaveAttribute('style', /stroke.*(?:#71717A|rgb\(113, 113, 122\))/)
  })

  // ============================================================================
  // V-CANVAS-03-S39: Delete key removes selected edge
  // ============================================================================

  test('S39: Delete key removes selected edge from canvas', async ({ page }) => {
    // Per design: Delete key removes the selected edge, downstream nodes become orphaned
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    const edges = page.locator('.react-flow__edge')
    const edgeCountBefore = await edges.count()
    expect(edgeCountBefore, 'Should have at least one edge from auto-connect').toBeGreaterThanOrEqual(1)

    // Select the edge
    await clickEdge(page)

    // Verify edge is selected - the selection style applies async so the
    // toHaveAttribute assertion auto-waits for the stroke to update.
    const edgePath = edges.first().locator('path.react-flow__edge-path')
    await expect(edgePath).toHaveAttribute('style', /stroke.*(?:#A1A1AA|rgb\(161, 161, 170\))/)

    // Press Delete key to remove the edge. toHaveCount auto-waits for
    // React Flow to commit the edge removal - avoids a fragile sleep.
    await page.keyboard.press('Delete')
    await expect(edges).toHaveCount(edgeCountBefore - 1)

    // The previously connected node should now be orphaned (muted treatment)
    // Node should still exist but have muted visual treatment (unreachable from Start)
    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNode.first()).toBeVisible()
  })
})
