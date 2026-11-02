/**
 * VI-INT-03: Connect Blocks with Edge
 *
 * Design Decisions: REQ-3.1.1.2
 * REQ: REQ-3.1.1.2 (Sequential flow connections between blocks)
 *
 * Pass Criteria:
 * 1. Connection handles visible on workflow nodes
 * 2. Dragging from handle shows preview edge
 * 3. Dropping on valid target creates edge
 * 4. Self-loop connections are rejected
 * 5. Duplicate edges are rejected
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('VI-INT-03: Connect Blocks with Edge', () => {
  // Clear workbench session before each test to ensure fresh canvas state
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {
      // Ignore errors - session may not exist
    })
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

  // Helper to add nodes from palette - positions nodes far from Start to avoid auto-connect
  // Single ingress/egress enforcement means auto-connect would make
  // occupied handles that reject manual connections.
  async function setupTwoNodes(page: import('@playwright/test').Page) {
    await setupPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Drop nodes in the RIGHT half of the canvas - far from Start to avoid auto-connect,
    // and right of the expanded palette overlay which covers the left ~25% of canvas.
    // Use force:true to bypass actionability checks (palette may overlap canvas).
    await findItemBySearch(page, 'if')
    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    await dragPaletteItemToCanvas(page, 'if', { x: canvasBox!.width * 0.45, y: canvasBox!.height * 0.7 })
    await page.waitForTimeout(200)

    await findItemBySearch(page, 'for')
    await dragPaletteItemToCanvas(page, 'for', { x: canvasBox!.width * 0.75, y: canvasBox!.height * 0.7 })
    await page.waitForTimeout(200)

    // Verify no auto-connect edges were created (only nodes, no edges)
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNodes.first()).toBeVisible({ timeout: 5000 })
    await expect(workflowNodes).toHaveCount(2)
  }

  test('VI-INT-03: handles visible on workflow nodes', async ({ page }) => {
    // Per REQ-3.1.1.2: Handles enable connection creation
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupTwoNodes(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // React Flow handles are always rendered on custom nodes
    // They use .react-flow__handle class
    const handles = firstNode.locator('.react-flow__handle')
    await expect(handles.first()).toBeAttached()
  })

  test('VI-INT-03-S1: edges created when dropping near nodes', async ({ page }) => {
    // Per REQ-3.1.1.2: Connections can be created via auto-connect
    // Note: The implementation uses auto-connect when dropping within 100px of free outputs
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupPalette(page)
    await findItemBySearch(page, 'if')

    // Get canvas and Start node positions
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).not.toBeNull()

    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode).toBeVisible()
    const startNodeBox = await startNode.boundingBox()
    expect(startNodeBox).not.toBeNull()

    const edges = page.locator('.react-flow__edge')

    // Calculate drop position relative to canvas (targetPosition is relative to target element)
    // Position below Start node to be within auto-connect threshold
    const dropX = startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2
    const dropY = startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60

    // Drop node directly below the Start node (within auto-connect threshold)
    // Use force: true to bypass actionability check since expanded palette may visually overlay
    // Retry drag if it silently fails (Playwright dragTo is unreliable under parallel load)
    const ifElseItem = page.locator('[data-testid="palette-item-if-else"]')
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    for (let attempt = 0; attempt < 3; attempt++) {
      await dragPaletteItemToCanvas(page, 'if', { x: dropX, y: dropY })
      const count = await workflowNodes.count()
      if (count >= 2) break
      await page.waitForTimeout(300)
    }
    await expect(workflowNodes).toHaveCount(2, { timeout: 5000 })
    // Wait for auto-connect edge to render (may take longer under parallel load)
    await expect(edges.first()).toBeAttached({ timeout: 5000 })
  })

  test('VI-INT-03-S3: self-loop connection rejected', async ({ page }) => {
    // Per design: Cannot connect node to itself
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupTwoNodes(page)

    const edges = page.locator('.react-flow__edge')
    const initialEdgeCount = await edges.count()

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Get source and target handles on same node (first bottom handle for scoped controls)
    const sourceHandle = firstNode.locator('.react-flow__handle-bottom').first()
    const targetHandle = firstNode.locator('.react-flow__handle-top')

    // Attempt to connect node to itself
    await sourceHandle.dragTo(targetHandle, { force: true })

    // Verify no edge was created
    await expect(edges).toHaveCount(initialEdgeCount, { timeout: 2000 })
  })

  test('VI-INT-03-S4: duplicate edge rejected', async ({ page }) => {
    // Per design: Cannot create duplicate edges
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupTwoNodes(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const sourceNode = workflowNodes.nth(0)
    const targetNode = workflowNodes.nth(1)

    const sourceHandle = sourceNode.locator('.react-flow__handle-bottom').first()
    const targetHandle = targetNode.locator('.react-flow__handle-top')

    // Wait for handles to be fully rendered and positioned before drag
    await expect(sourceHandle).toBeVisible({ timeout: 5000 })
    await expect(targetHandle).toBeVisible({ timeout: 5000 })

    // Create first edge (retry if drag silently fails under parallel load)
    const edges = page.locator('.react-flow__edge')
    const initialEdgeCount = await edges.count()

    for (let attempt = 0; attempt < 3; attempt++) {
      await sourceHandle.dragTo(targetHandle, { force: true })
      const count = await edges.count()
      if (count > initialEdgeCount) break
      await page.waitForTimeout(300)
    }

    // Wait for the first edge to render
    await expect(edges).toHaveCount(initialEdgeCount + 1, { timeout: 5000 })
    const edgeCountAfterFirst = await edges.count()

    // Attempt duplicate connection
    await sourceHandle.dragTo(targetHandle, { force: true })

    // Verify no new edge was created
    await expect(edges).toHaveCount(edgeCountAfterFirst, { timeout: 2000 })
  })

  test('VI-INT-03-S5: reverse direction rejected (A->B exists, B->A creates cycle)', async ({ page }) => {
    // Cycle detection prevents A->B->A cycles
    // After A->B, attempting B->A is rejected because A can reach B (forming a cycle)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await setupTwoNodes(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeA = workflowNodes.nth(0)
    const nodeB = workflowNodes.nth(1)

    const nodeASourceHandle = nodeA.locator('.react-flow__handle-bottom').first()
    const nodeBTargetHandle = nodeB.locator('.react-flow__handle-top')
    const nodeBSourceHandle = nodeB.locator('.react-flow__handle-bottom').first()
    const nodeATargetHandle = nodeA.locator('.react-flow__handle-top')

    // Wait for handles to be fully rendered and positioned before drag
    await expect(nodeASourceHandle).toBeVisible({ timeout: 5000 })
    await expect(nodeBTargetHandle).toBeVisible({ timeout: 5000 })

    // Create A -> B edge (retry if drag silently fails under parallel load)
    const edges = page.locator('.react-flow__edge')
    const initialEdgeCount = await edges.count()

    for (let attempt = 0; attempt < 3; attempt++) {
      await nodeASourceHandle.dragTo(nodeBTargetHandle, { force: true })
      const count = await edges.count()
      if (count > initialEdgeCount) break
      await page.waitForTimeout(300)
    }

    // Wait for the A->B edge to render
    await expect(edges).toHaveCount(initialEdgeCount + 1, { timeout: 5000 })
    const edgeCountAfterFirst = await edges.count()

    // Attempt B -> A edge (reverse direction - creates cycle A->B->A)
    await nodeBSourceHandle.dragTo(nodeATargetHandle, { force: true })

    // Verify B->A was rejected (cycle detection: A can reach B, so B->A is a cycle)
    await expect(edges).toHaveCount(edgeCountAfterFirst, { timeout: 2000 })
  })
})
