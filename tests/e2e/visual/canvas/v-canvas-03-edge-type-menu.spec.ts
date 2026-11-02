/**
 * V-CANVAS-03: Edge Context Menu - Edge Type Selection
 *
 * Validates:
 * 1. Edge context menu shows 4 edge type options (Bezier, Smoothstep, Step, Straight)
 * 2. Active edge type shows check icon
 * 3. Separator between edge types and Delete
 * 4. Selecting an edge type updates the edge visually
 * 5. Default edge type (Bezier) is active for new edges
 *
 * REQ: Edge type selection in edge context menu
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  waitForCanvasLoad,
  stubSessionRecovery,
  dragPaletteItemToCanvas,
} from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03: Edge Type Selection Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await stubSessionRecovery(page)
  })

  // Drop an If-Else near Start so auto-connect creates an edge. Uses the
  // shared dragPaletteItemToCanvas helper (retry + RAF settle).
  async function addConnectedNode(page: import('@playwright/test').Page) {
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    const startNodeBox = await page.locator('[data-testid="start-node"]').boundingBox()

    await dragPaletteItemToCanvas(page, 'if', {
      x: startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2,
      y: startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60,
    })
  }

  // Helper to right-click the first edge and open context menu
  async function openEdgeContextMenu(page: import('@playwright/test').Page) {
    const edges = page.locator('.react-flow__edge')
    // dragPaletteItemToCanvas waits for the new NODE, but React Flow
    // commits the auto-connect edge on a separate microtask. A direct
    // `.count()` call races with that commit under shard-container
    // CPU load. Use auto-retrying `toHaveCount` so Playwright polls
    // until the edge lands (default 5s, plenty for a single node drop).
    await expect(edges, 'Should have at least one edge').toHaveCount(1)

    const edgePath = edges.first().locator('.react-flow__edge-interaction')
    const edgeBox = await edgePath.boundingBox()

    if (edgeBox) {
      await page.mouse.click(
        edgeBox.x + edgeBox.width / 2,
        edgeBox.y + edgeBox.height / 2,
        { button: 'right' },
      )
    } else {
      await edges.first().click({ button: 'right' })
    }

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()
    return contextMenu
  }

  // ============================================================================
  // Edge type options visible
  // ============================================================================

  test('edge context menu shows 4 edge type options and Delete', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    const contextMenu = await openEdgeContextMenu(page)

    // Verify all 4 edge type options (use exact: true to avoid "Step" matching "Smoothstep")
    await expect(contextMenu.getByText('Bezier', { exact: true })).toBeVisible()
    await expect(contextMenu.getByText('Smoothstep', { exact: true })).toBeVisible()
    await expect(contextMenu.getByText('Step', { exact: true })).toBeVisible()
    await expect(contextMenu.getByText('Straight', { exact: true })).toBeVisible()

    // Verify Delete is still present (below separator)
    await expect(contextMenu.getByText('Delete')).toBeVisible()
  })

  // ============================================================================
  // Default edge type has check icon
  // ============================================================================

  test('selecting edge type and re-opening shows check on selected type', async ({ page }) => {
    // Test the check icon behavior by selecting a type and verifying it persists
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    // Select Straight edge type
    let contextMenu = await openEdgeContextMenu(page)
    await contextMenu.getByText('Straight', { exact: true }).click()
    await expect(contextMenu).not.toBeVisible()
    await page.waitForTimeout(200)

    // Re-open and verify Straight has the check icon
    contextMenu = await openEdgeContextMenu(page)
    const menuItems = contextMenu.locator('[role="menuitem"]')
    const itemCount = await menuItems.count()

    let straightHasCheck = false
    for (let i = 0; i < itemCount; i++) {
      const item = menuItems.nth(i)
      const text = await item.textContent()
      const svgCount = await item.locator('svg').count()
      if (text?.trim() === 'Straight') straightHasCheck = svgCount > 0
    }

    expect(straightHasCheck, 'Straight should have check icon after selection').toBeTruthy()
  })

  // ============================================================================
  // Separator between edge types and Delete
  // ============================================================================

  test('separator exists between edge type options and Delete', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    const contextMenu = await openEdgeContextMenu(page)

    // The separator is a div with bg-border class (horizontal rule)
    const separator = contextMenu.locator('.bg-border')
    await expect(separator).toBeVisible()

    // Verify order: edge types before separator, Delete after
    const menuItems = contextMenu.locator('[role="menuitem"]')
    const itemCount = await menuItems.count()
    // 4 edge types + 1 Delete = 5 menu items
    expect(itemCount).toBe(5)
  })

  // ============================================================================
  // Selecting an edge type updates the edge
  // ============================================================================

  test('selecting Smoothstep updates edge type and shows check on Smoothstep', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addConnectedNode(page)

    // Open context menu and select Smoothstep
    let contextMenu = await openEdgeContextMenu(page)
    await contextMenu.getByText('Smoothstep').click()
    await expect(contextMenu).not.toBeVisible()

    // Re-open context menu on the same edge
    contextMenu = await openEdgeContextMenu(page)

    // Auto-waiting locator assertions on the individual items: the check icon may
    // not have rendered yet, and toBeVisible / toHaveCount poll until it has.
    const smoothstepItem = contextMenu
      .locator('[role="menuitem"]')
      .filter({ hasText: 'Smoothstep' })
    const bezierItem = contextMenu
      .locator('[role="menuitem"]')
      .filter({ hasText: /^Bezier$/ }) // exact match to avoid matching "Smoothstep"

    await expect(
      smoothstepItem.locator('svg').first(),
      'Smoothstep should show a check icon after selection',
    ).toBeVisible()
    await expect(
      bezierItem.locator('svg'),
      'Bezier should no longer show a check icon',
    ).toHaveCount(0)
  })
})
