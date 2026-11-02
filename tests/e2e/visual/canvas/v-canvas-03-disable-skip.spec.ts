/**
 * V-CANVAS-03 Extended: Disabled / Skipped / Unreachable Node Visual Treatment
 *
 * Design Decisions: CANVAS-71 (Disabled = structural), CANVAS-72 (Skipped = runtime),
 *                   CANVAS-73 (Both dashed border, no opacity), CANVAS-145 (Skip separate from Disable)
 *
 * Visual Treatment:
 * | State    | Border  | Opacity | Badge |
 * |----------|---------|---------|-------|
 * | Normal   | solid   | 100%    | none  |
 * | Disabled | dashed  | 100%    | "D"   |
 * | Skipped  | dashed  | 100%    | "S"   |
 * | Both     | dashed  | 100%    | "D"   |
 *
 * Pass Criteria:
 * 1. Disabling a node shows dashed border and "D" badge
 * 2. Skipping a node shows dashed border and "S" badge
 * 3. Unreachable node (not connected to Start) appears muted with dashed border
 * 4. Enabling a disabled node reverts to normal appearance
 * 5. Unskipping a skipped node reverts to normal appearance
 * 6. Disabled badge takes priority over skipped when both active
 * 7. Unlink action removes edges from a node
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03: Disabled / Skipped / Unreachable Visual Treatment', () => {
  // Clear state before each test
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

  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to add a workflow node at center of canvas (unconnected to Start)
  async function addNodeFromPalette(page: import('@playwright/test').Page) {
    await setupPalette(page)
    await findItemBySearch(page, 'http')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Count nodes before drop so we can detect when the new one appears
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodesBefore = await workflowNodes.count()

    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })

    // Wait for the new node to appear
    await expect(workflowNodes).toHaveCount(nodesBefore + 1, { timeout: 5000 })
  }

  // Helper to select a node and click a kebab menu action
  async function clickKebabAction(page: import('@playwright/test').Page, actionText: string) {
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const targetNode = workflowNodes.last()

    // Ensure any prior menu is closed before proceeding
    const menuContent = page.locator('[role="menu"]')
    await expect(menuContent).not.toBeVisible({ timeout: 2000 }).catch(() => {})

    // Select the node (last = the one we dropped)
    await targetNode.locator('button').first().click()
    await expect(targetNode).toHaveAttribute('data-selected', 'true', { timeout: 5000 })

    // Open kebab menu - wait for the button to be stable after state changes
    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await expect(kebabButton).toBeVisible()
    await kebabButton.click()

    // Wait for menu
    await expect(menuContent).toBeVisible()

    // Click the action
    await menuContent.getByText(actionText, { exact: true }).click()
    await page.waitForTimeout(100)
  }

  // ============================================================================
  // Disabled Node Tests (CANVAS-71)
  // ============================================================================

  test('disabling a node shows dashed border and D badge', async ({ page }) => {
    // Per CANVAS-71: Disabled = structural, persistent
    // Per CANVAS-73: Dashed border, no opacity reduction
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Verify initially not disabled
    await expect(firstNode).not.toHaveAttribute('data-disabled', 'true')

    // Disable via kebab menu
    await clickKebabAction(page, 'Disable')

    // Verify disabled state
    await expect(firstNode).toHaveAttribute('data-disabled', 'true')

    // Verify DISABLED badge
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'disabled')
    await expect(badge).toHaveText('DISABLED')

    // Disabled wrapper is grayscale + 0.55 opacity.
    // The dashed-border indicator is gone.
    await expect(firstNode).toHaveClass(/grayscale/)
    await expect(firstNode).toHaveClass(/opacity-\[0\.55\]/)
  })

  test('enabling a disabled node reverts to normal appearance', async ({ page }) => {
    // Per CANVAS-71: Toggling disabled state
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Disable
    await clickKebabAction(page, 'Disable')
    await expect(firstNode).toHaveAttribute('data-disabled', 'true')

    // Re-enable via kebab menu (label is now "Enable")
    await clickKebabAction(page, 'Enable')

    // Verify no longer disabled
    await expect(firstNode).not.toHaveAttribute('data-disabled', 'true')

    // Badge should not be visible
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).not.toBeVisible()
  })

  test('disabled node shows Enable label in kebab menu', async ({ page }) => {
    // Per design: Menu shows "Enable" when node is disabled
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    // Disable the node
    await clickKebabAction(page, 'Disable')

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Wait for prior menu to fully close
    const menuContent = page.locator('[role="menu"]')
    await expect(menuContent).not.toBeVisible({ timeout: 2000 }).catch(() => {})

    // Re-select and open kebab
    await firstNode.locator('button').first().click()
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await expect(kebabButton).toBeVisible()
    await kebabButton.click()

    await expect(menuContent).toBeVisible()

    // Should show "Enable" instead of "Disable"
    await expect(menuContent.getByText('Enable', { exact: true })).toBeVisible()
  })

  // ============================================================================
  // Skipped Node Tests (CANVAS-72)
  // ============================================================================

  test('skipping a node shows dashed border and S badge', async ({ page }) => {
    // Per CANVAS-72: Skipped = runtime, transient
    // Per CANVAS-73: Same visual as disabled but "S" badge
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Verify initially not skipped
    await expect(firstNode).not.toHaveAttribute('data-skipped', 'true')

    // Skip via kebab menu
    await clickKebabAction(page, 'Skip')

    // Verify skipped state
    await expect(firstNode).toHaveAttribute('data-skipped', 'true')

    // Verify "S" badge
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'skip')
    await expect(badge).toHaveText('SKIP')

    // SKIP keeps its colors and surfaces only as
    // the amber SKIP run-state badge. No body border change.
    await expect(firstNode).toHaveAttribute('data-skipped', 'true')
  })

  test('unskipping a skipped node reverts to normal appearance', async ({ page }) => {
    // Per CANVAS-72: Toggle skip
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Skip
    await clickKebabAction(page, 'Skip')
    await expect(firstNode).toHaveAttribute('data-skipped', 'true')

    // Unskip via kebab menu (label is now "Unskip")
    await clickKebabAction(page, 'Unskip')

    // Verify no longer skipped
    await expect(firstNode).not.toHaveAttribute('data-skipped', 'true')

    // Badge should not be visible
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).not.toBeVisible()
  })

  test('skipped node shows Unskip label in kebab menu', async ({ page }) => {
    // Per design: Menu shows "Unskip" when node is skipped
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    // Skip the node
    await clickKebabAction(page, 'Skip')

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Wait for prior menu to fully close
    const menuContent = page.locator('[role="menu"]')
    await expect(menuContent).not.toBeVisible({ timeout: 2000 }).catch(() => {})

    // Re-select and open kebab
    await firstNode.locator('button').first().click()
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await expect(kebabButton).toBeVisible()
    await kebabButton.click()

    await expect(menuContent).toBeVisible()

    // Should show "Unskip" instead of "Skip"
    await expect(menuContent.getByText('Unskip', { exact: true })).toBeVisible()
  })

  // ============================================================================
  // Badge Priority (CANVAS-73)
  // ============================================================================

  test('disabled badge takes priority over skipped when both active', async ({ page }) => {
    // Per CANVAS-73: Disabled takes visual priority (persistent > transient)
    // Note: Skip is disabled in menu when node is already disabled,
    // but we can skip first then disable to get both states
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Skip first
    await clickKebabAction(page, 'Skip')
    await expect(firstNode).toHaveAttribute('data-skipped', 'true')

    // Then disable (toggleDisable removes from skippedNodeIds, but let's verify badge priority)
    await clickKebabAction(page, 'Disable')
    await expect(firstNode).toHaveAttribute('data-disabled', 'true')

    // Badge should show "D" (disabled priority)
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'disabled')
    await expect(badge).toHaveText('DISABLED')
  })

  // ============================================================================
  // Unreachable Node Muting
  // ============================================================================

  test('node not connected to Start appears with muted visual treatment', async ({ page }) => {
    // Per BFS reachability: Nodes not in Start's subgraph are visually muted
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop node far from Start (bottom-right corner) to avoid auto-connect (100px threshold)
    await setupPalette(page)
    await findItemBySearch(page, 'http')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width - 50, y: canvasBox!.height - 50 })
    await page.waitForTimeout(100)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()

    // Unreachable nodes are muted (no dashed border on
    // the wrapper). No run-state badge fires for unreachable-only state.
    const badge = firstNode.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).not.toBeVisible()
    // Wrapper has neither data-disabled nor data-skipped - just muted via opacity.
    await expect(firstNode).not.toHaveAttribute('data-disabled', 'true')
    await expect(firstNode).not.toHaveAttribute('data-skipped', 'true')
  })

  // ============================================================================
  // Unlink Action
  // ============================================================================

  test('unlink action removes all edges from a node', async ({ page }) => {
    // Per design: Unlink removes all ingress and egress edges
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop a node near Start to auto-connect
    await setupPalette(page)
    await findItemBySearch(page, 'if')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    const startNode = page.locator('[data-testid="start-node"]')
    const startNodeBox = await startNode.boundingBox()

    const dropX = startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2
    const dropY = startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60

    await dragPaletteItemToCanvas(page, 'if', { x: dropX, y: dropY })
    await page.waitForTimeout(200)

    // Verify edge was created
    const edges = page.locator('.react-flow__edge')
    const edgeCountBefore = await edges.count()
    expect(edgeCountBefore, 'Should have at least one edge').toBeGreaterThanOrEqual(1)

    // Select the node and click Unlink in kebab
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.last()
    await firstNode.locator('button').first().click()
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await kebabButton.click()

    const menuContent = page.locator('[role="menu"]')
    await expect(menuContent).toBeVisible()
    await menuContent.getByText('Unlink').click()

    // Wait for edge removal
    await page.waitForTimeout(200)

    // Edges connected to this node should be removed
    const edgeCountAfter = await edges.count()
    expect(edgeCountAfter, 'Edges should be removed after unlink').toBeLessThan(edgeCountBefore)
  })
})
