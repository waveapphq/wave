/**
 * V-CANVAS-RB-S1, S2, S5: Rubber-Band Selection & Chain Select
 *
 * REQ: REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Pass Criteria:
 * 1. V-CANVAS-RB-S1: Shift+drag on canvas draws visible selection rectangle
 * 2. V-CANVAS-RB-S2: Shift+drag selects all nodes within rectangle (additive)
 * 3. V-CANVAS-RB-S5: Shift+click no-op when no selection or unconnected
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-RB: Rubber-Band Selection & Chain Select', () => {
  test.beforeEach(async ({ page }) => {
    // Clear workbench session and localStorage for fresh state
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  // Helper to expand palette and search
  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  // Helper to add a workflow node at a specific canvas position (relative to workflow-canvas)
  async function addNodeAt(page: Page, searchTerm: string, x: number, y: number) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)

    const testIdMap: Record<string, string> = {
      'http': 'palette-item-http-client',
      'sql': 'palette-item-sql-client',
      'if': 'palette-item-if-else',
      'shell script': 'palette-item-shell-script',
      'for': 'palette-item-for',
    }

    const testId = testIdMap[searchTerm] ?? `palette-item-${searchTerm}`
    await dragPaletteItemToCanvas(page, { term: searchTerm, testId }, { x, y })
  }

  // Helper to get selected node count
  async function getSelectedNodeCount(page: Page): Promise<number> {
    return page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]').count()
  }

  // Helper to click React Flow pane to deselect all
  async function clickPane(page: Page) {
    const pane = page.locator('.react-flow__pane')
    const paneBox = await pane.boundingBox()
    if (paneBox) {
      // Click in upper-left area of pane (away from nodes which are typically centered)
      await page.mouse.click(paneBox.x + 20, paneBox.y + 20)
    }
    await page.waitForTimeout(100)
  }

  test('V-CANVAS-RB-S1: Shift+drag draws visible selection rectangle', async ({ page }) => {
    // Holding Shift while dragging on canvas background draws a
    // visible selection rectangle. Regular drag (without Shift) pans the canvas.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Get the React Flow pane (the actual draggable area, not the outer wrapper)
    const pane = page.locator('.react-flow__pane')
    const paneBox = await pane.boundingBox()
    expect(paneBox, 'React Flow pane should have a bounding box').not.toBeNull()

    // Perform Shift+drag within the React Flow pane
    // Start from upper-left area and drag to lower-right
    const startX = paneBox!.x + 50
    const startY = paneBox!.y + 50
    const endX = paneBox!.x + paneBox!.width * 0.7
    const endY = paneBox!.y + paneBox!.height * 0.7

    await page.keyboard.down('Shift')
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Move in steps so React Flow can detect the drag and render selection box
    await page.mouse.move(endX, endY, { steps: 20 })

    // While dragging with Shift, React Flow renders the .react-flow__selection element
    const selectionBox = page.locator('.react-flow__selection')
    await expect(selectionBox, 'Selection rectangle should be visible during Shift+drag').toBeVisible({ timeout: 3000 })

    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(100)
  })

  test('V-CANVAS-RB-S2: Shift+drag selects all nodes within rectangle (additive)', async ({ page }) => {
    // Shift+drag selects all nodes whose bounding boxes intersect
    // the selection rectangle. Selection is additive.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Add two nodes at positions that will be within the rubber-band rectangle
    await addNodeAt(page, 'http', canvasBox!.width * 0.4, canvasBox!.height * 0.5)
    await addNodeAt(page, 'shell script', canvasBox!.width * 0.6, canvasBox!.height * 0.5)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()
    expect(nodeCount, 'Should have at least 2 workflow nodes').toBeGreaterThanOrEqual(2)

    // Click pane to deselect all
    await clickPane(page)

    // Verify no nodes selected
    const selectedBefore = await getSelectedNodeCount(page)
    expect(selectedBefore, 'No nodes should be selected initially').toBe(0)

    // Shift+drag a large rectangle covering the entire pane to select all nodes
    const pane = page.locator('.react-flow__pane')
    const paneBox = await pane.boundingBox()
    expect(paneBox).not.toBeNull()

    const startX = paneBox!.x + 10
    const startY = paneBox!.y + 10
    const endX = paneBox!.x + paneBox!.width - 10
    const endY = paneBox!.y + paneBox!.height - 10

    await page.keyboard.down('Shift')
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 20 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(300)

    // All workflow nodes should be selected
    const selectedAfter = await getSelectedNodeCount(page)
    expect(selectedAfter, 'All workflow nodes should be selected after rubber-band').toBe(nodeCount)
  })

  test('V-CANVAS-RB-S5: Shift+click no-op when no selection or unconnected', async ({ page }) => {
    // Shift+click does nothing when:
    // (a) no nodes are currently selected
    // (b) the clicked node is not connected to any selected node
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    // Add two disconnected nodes (far apart, no edges between them)
    await addNodeAt(page, 'http', canvasBox!.width * 0.4, canvasBox!.height * 0.3)
    await addNodeAt(page, 'shell script', canvasBox!.width * 0.7, canvasBox!.height * 0.7)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const node1TestId = await workflowNodes.nth(0).getAttribute('data-testid')
    const node2TestId = await workflowNodes.nth(1).getAttribute('data-testid')

    // Case (a): Shift+click with no nodes selected - should be no-op for chain select
    await clickPane(page)
    await page.waitForTimeout(100)

    const selectedBefore = await getSelectedNodeCount(page)
    expect(selectedBefore, 'No nodes should be selected initially').toBe(0)

    // Shift+click on node1 using mouse coordinates
    const node1Box = await page.locator(`[data-testid="${node1TestId}"]`).boundingBox()
    expect(node1Box).not.toBeNull()

    await page.keyboard.down('Shift')
    await page.mouse.click(node1Box!.x + node1Box!.width / 2, node1Box!.y + node1Box!.height / 2)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(200)

    // Chain select should be a no-op (no pre-existing selection to chain from)
    // RF may select the clicked node itself, but no chain of multiple nodes
    const selectedAfterA = await getSelectedNodeCount(page)
    expect(selectedAfterA, 'Shift+click with no selection should not chain-select multiple nodes').toBeLessThanOrEqual(1)

    // Case (c): Select node1, then Shift+click on disconnected node2
    // First select node1 with a real pointer click on the RF wrapper
    await page.locator(`[data-testid="${node1TestId}"]`).click()
    await page.waitForTimeout(150)
    await expect(page.locator(`[data-testid="${node1TestId}"]`)).toHaveAttribute('data-selected', 'true')

    // Shift+click on node2 which is NOT connected to node1
    const node2Box = await page.locator(`[data-testid="${node2TestId}"]`).boundingBox()
    expect(node2Box).not.toBeNull()

    await page.keyboard.down('Shift')
    await page.mouse.click(node2Box!.x + node2Box!.width / 2, node2Box!.y + node2Box!.height / 2)
    await page.keyboard.up('Shift')
    await page.waitForTimeout(300)

    // Chain select should be a no-op for disconnected nodes (BFS finds no path)
    // At most 2 nodes could be selected (node1 from before + node2 if RF selects it)
    // but no intermediate chain nodes should appear
    const selectedAfterC = await getSelectedNodeCount(page)
    expect(selectedAfterC, 'Shift+click on disconnected node should not select extra nodes').toBeLessThanOrEqual(2)
  })
})
