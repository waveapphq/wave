/**
 * V-CANVAS-02: Block Appears on Canvas
 *
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-3.1.1.2 (Sequential flow connections), REQ-4.2.1 (No-code test creation)
 *
 * Pass Criteria:
 * 1. 3+ blocks visible on canvas
 * 2. Smooth step edges connect blocks
 * 3. Each block shows icon
 * 4. Proper spacing between blocks (no overlap)
 * 5. Blocks are rendered within canvas viewport
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-CANVAS-02: Block Appears on Canvas', () => {
  // No beforeAll needed - tests use palette drag-drop, no backend data required

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

  // Helper to add 3 nodes from palette
  async function setupThreeNodes(page: import('@playwright/test').Page) {
    await setupPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Drop nodes at diagonal positions in the RIGHT half of the canvas.
    // The expanded palette overlays the left ~25% of the canvas. Without force:true,
    // dragTo fires mouse events on the palette DOM instead of the canvas, silently
    // failing to create nodes. Use force:true AND right-side positions to be safe.

    // Search and drop HTTP Client node (right-center top)
    await findItemBySearch(page, 'http')
    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width * 0.5, y: canvasBox!.height * 0.2 })
    await page.waitForTimeout(200)

    // Search and drop SQL Query node (center-right)
    await findItemBySearch(page, 'sql')
    await dragPaletteItemToCanvas(page, 'sql', { x: canvasBox!.width * 0.65, y: canvasBox!.height * 0.5 })
    await page.waitForTimeout(200)

    // Search and drop If/Else node (far right bottom)
    await findItemBySearch(page, 'if')
    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width * 0.8, y: canvasBox!.height * 0.8 })
    await page.waitForTimeout(200)
  }

  test('V-CANVAS-02: canvas displays 3+ blocks', async ({ page }) => {
    // Per REQ-3.1.1.1: Multiple blocks visible on canvas
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    // Verify at least 3 workflow nodes are visible
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()
    expect(nodeCount, 'Canvas should have at least 3 blocks').toBeGreaterThanOrEqual(3)

    // Verify all nodes are visible
    for (let i = 0; i < nodeCount; i++) {
      await expect(workflowNodes.nth(i)).toBeVisible()
    }
  })

  test('V-CANVAS-02-S1: blocks connected with edges', async ({ page }) => {
    // Per REQ-3.1.1.2: Sequential flow connections between blocks
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    // Connect the nodes manually
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')

    // Connect first to second
    const node1 = workflowNodes.nth(0)
    const node2 = workflowNodes.nth(1)
    let sourceHandle = node1.locator('.react-flow__handle-bottom')
    let targetHandle = node2.locator('.react-flow__handle-top')

    let sourceBox = await sourceHandle.boundingBox()
    let targetBox = await targetHandle.boundingBox()

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 }
    )
    await page.mouse.up()
    await page.waitForTimeout(100)

    // Connect second to third
    const node3 = workflowNodes.nth(2)
    sourceHandle = node2.locator('.react-flow__handle-bottom')
    targetHandle = node3.locator('.react-flow__handle-top')

    sourceBox = await sourceHandle.boundingBox()
    targetBox = await targetHandle.boundingBox()

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 }
    )
    await page.mouse.up()
    await page.waitForTimeout(100)

    // Verify edges exist (at least 2 user edges)
    const edges = page.locator('.react-flow__edge')
    const edgeCount = await edges.count()
    expect(edgeCount, 'Canvas should have connecting edges').toBeGreaterThanOrEqual(2)
  })

  test('V-CANVAS-02-S2: each block shows icon', async ({ page }) => {
    // Per REQ-4.2.1: Blocks must be identifiable
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()

    for (let i = 0; i < nodeCount; i++) {
      const node = workflowNodes.nth(i)

      // Each node must have an icon
      const icon = node.locator('[data-testid="workflow-node-icon"]')
      await expect(icon, `Node ${i} should have an icon`).toBeVisible()
    }
  })

  test('V-CANVAS-02-S3: proper spacing between blocks (no overlap)', async ({ page }) => {
    // Blocks should have proper spacing
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    // Wait for auto-connect positioning and layout to settle
    // CI containers have constrained CPU; auto-connect triggers React + React Flow layout
    await page.waitForTimeout(500)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()

    // Get bounding boxes for all nodes
    const boxes: { x: number; y: number; width: number; height: number }[] = []
    for (let i = 0; i < nodeCount; i++) {
      const box = await workflowNodes.nth(i).boundingBox()
      expect(box, `Node ${i} should have a bounding box`).not.toBeNull()
      boxes.push(box!)
    }

    // Check no two nodes overlap
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]

        // Check if boxes overlap
        const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x
        const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y
        const overlaps = overlapsX && overlapsY

        expect(overlaps, `Nodes ${i} and ${j} should not overlap`).toBe(false)
      }
    }
  })

  test('V-CANVAS-02-S4: blocks rendered within canvas viewport', async ({ page }) => {
    // Blocks should be visible within canvas
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()

    // Check each node is within canvas bounds (allowing for some overflow due to pan)
    for (let i = 0; i < nodeCount; i++) {
      const nodeBox = await workflowNodes.nth(i).boundingBox()
      expect(nodeBox, `Node ${i} should have a bounding box`).not.toBeNull()

      // Node should be at least partially visible within canvas
      const visibleInCanvas =
        nodeBox!.x + nodeBox!.width > canvasBox!.x &&
        nodeBox!.x < canvasBox!.x + canvasBox!.width &&
        nodeBox!.y + nodeBox!.height > canvasBox!.y &&
        nodeBox!.y < canvasBox!.y + canvasBox!.height

      expect(visibleInCanvas, `Node ${i} should be visible within canvas`).toBe(true)
    }
  })

  test('V-CANVAS-02-S5: manual connection renders an edge path', async ({ page }) => {
    // Per design: default edge routing is Bezier (see v-canvas-03-edge-type-menu)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupThreeNodes(page)

    // Connect first to second node
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const node1 = workflowNodes.nth(0)
    const node2 = workflowNodes.nth(1)

    const sourceHandle = node1.locator('.react-flow__handle-bottom')
    const targetHandle = node2.locator('.react-flow__handle-top')

    const sourceBox = await sourceHandle.boundingBox()
    const targetBox = await targetHandle.boundingBox()

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 }
    )
    await page.mouse.up()
    await page.waitForTimeout(100)

    // Verify edge path exists
    const edgePaths = page.locator('.react-flow__edge path')
    const pathCount = await edgePaths.count()
    expect(pathCount, 'Should have edge paths').toBeGreaterThan(0)
  })
})
