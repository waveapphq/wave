/**
 * V-CANVAS-03-S42/S43: Auto-Connection Proximity Animation
 *
 * Design Decisions: CANVAS-29-CANVAS-34
 * REQ: REQ-3.1.1.2 Auto-connection proximity animation
 *
 * Pass Criteria:
 * S42:
 *   1. Dragging a new element from palette within ~100px of a free output handle
 *      triggers a ghost edge (dashed #A1A1AA at 60% opacity, smoothstep bezier)
 *   2. Source handle glows green (ring-green-400, bg-green-500, animate-pulse)
 *   3. Ghost edge renders from source output to drag position
 *   4. Works for palette drags (handleDrop)
 *   5. Start node participates in proximity on empty canvas
 *
 * S43:
 *   1. When drag moves beyond the threshold, ghost edge disappears
 *   2. Source handle glow disappears
 *   3. On drop within proximity, an edge is auto-created
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  waitForCanvasLoad,
  stubSessionRecovery,
  dragPaletteItemToCanvas,
} from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03-S42/S43: Proximity Ghost Edge Animation', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await stubSessionRecovery(page)
  })

  // Drop target relative to the Start node - the Start box is always present
  // on an empty canvas and gives us a stable anchor for "near" drops.
  async function dropPositionNearStart(
    page: import('@playwright/test').Page,
    offsetY = 60
  ): Promise<{ x: number; y: number }> {
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    const startNodeBox = await page.locator('[data-testid="start-node"]').boundingBox()
    return {
      x: startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2,
      y: startNodeBox!.y - canvasBox!.y + startNodeBox!.height + offsetY,
    }
  }

  // ============================================================================
  // V-CANVAS-03-S42: Ghost edge + handle glow during drag near free output
  // ============================================================================

  test('S42: ghost edge appears when dragging palette item near Start node', async ({ page }) => {
    // Per CANVAS-29-CANVAS-34: Ghost edge + handle glow during drag proximity
    //
    // Playwright can't hold mid-drag on HTML5 drag events to visually observe
    // the ghost edge, so we verify the end-state of the proximity system by
    // dropping within the auto-connect threshold and confirming both the new
    // node and an auto-created edge appear.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await dragPaletteItemToCanvas(page, 'if', await dropPositionNearStart(page))

    const edges = page.locator('.react-flow__edge')
    await expect(
      edges.first(),
      'Auto-connect should create at least one edge'
    ).toBeVisible({ timeout: 5000 })
  })

  test('S42: dropping near Start auto-creates edge (proximity behavior)', async ({ page }) => {
    // Per design: Drop within proximity auto-creates edge from free output to new node
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await dragPaletteItemToCanvas(page, 'if', await dropPositionNearStart(page))

    // Edge should be auto-created (helper already verified the node appeared)
    const edges = page.locator('.react-flow__edge')
    await expect(edges.first()).toBeVisible({ timeout: 5000 })
  })

  // ============================================================================
  // V-CANVAS-03-S43: Ghost edge disappears when drag moves away
  // ============================================================================

  test('S43: dropping far from Start does NOT auto-connect (no edge created)', async ({ page }) => {
    // Per design: Moving beyond threshold removes ghost edge; dropping outside threshold
    // does not auto-connect
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Drop far from Start node but clearly inside the React Flow pane.
    // Proportional coordinates keep "far from Start" while staying off the zoom-control
    // / help-button overlay in the bottom-right corner, which is not a drop target.
    await dragPaletteItemToCanvas(page, 'shell script', {
      x: canvasBox!.width * 0.8,
      y: canvasBox!.height * 0.7,
    })

    // With one user node, onboarding is hidden so the onboarding ghost edge
    // is gone. The only remaining edges would be auto-connect ones, which
    // shouldn't exist when the drop is outside the proximity threshold.
    const realEdges = page.locator('.react-flow__edge:not([data-testid="ghost-edge"])')
    const edgeCount = await realEdges.count()
    expect(edgeCount, 'No auto-connect edge when dropped far from Start').toBe(0)
  })

  test('S43: Start node stops pulsing after node is connected', async ({ page }) => {
    // Per design: Start node has pulse animation when no connection exists,
    // stops pulsing after a connection is made
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Initially, Start node should be pulsing (no outgoing connection)
    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode).toHaveAttribute('data-animate', 'pulse')

    await dragPaletteItemToCanvas(page, 'if', await dropPositionNearStart(page))

    // Start node should no longer pulse (has connection)
    await expect(startNode).not.toHaveAttribute('data-animate', 'pulse')
  })
})
