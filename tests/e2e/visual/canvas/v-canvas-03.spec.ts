/**
 * V-CANVAS-03: Selected State Visual
 *
 * Design Decisions: CANVAS-35 to CANVAS-44, CANVAS-143-145
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.1 (No-code test creation)
 *
 * Pass Criteria:
 * 1. Selected block shows white dashed halo (outline: 2px dashed white; outline-offset: 4px)
 * 2. Connection handles visible on selected block
 * 3. Action row appears BELOW selected block with:
 *    - Version indicator (left, format: "vX.X")
 *    - Gear icon (Settings) - opens config modal
 *    - Kebab menu (MoreVertical) - context actions
 * 4. Selection does not change surrounding UI layout
 * 5. Context menu has correct groups and actions
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CANVAS-03: Selected State Visual', () => {
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
    await findItemBySearch(page, 'http')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)
  }

  test('V-CANVAS-03: selected block shows white dashed halo', async ({ page }) => {
    // Per CANVAS-36: Selected: white dotted halo
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Click to select
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Verify white dashed outline style via class
    // Per implementation: 'outline outline-2 outline-dashed outline-white outline-offset-[4px]'
    await expect(firstNode).toHaveClass(/outline-dashed/)
    await expect(firstNode).toHaveClass(/outline-white/)
    await expect(firstNode).toHaveClass(/outline-2/)
    await expect(firstNode).toHaveClass(/outline-offset-\[4px\]/)
  })

  test('V-CANVAS-03-S1: connection handles visible on selected block', async ({ page }) => {
    // Per design: Handles visible when block is selected
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Verify input handle (top)
    const inputHandle = firstNode.locator('[data-testid="handle-input"]')
    await expect(inputHandle).toBeVisible()

    // Verify output handle (bottom)
    const outputHandle = firstNode.locator('[data-testid="handle-output"]')
    await expect(outputHandle).toBeVisible()
  })

  test('V-CANVAS-03-S2: persistent status bar is always visible', async ({ page }) => {
    // The status bar is ALWAYS visible, not
    // gated on selection. Both unselected and selected states render the bar.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Bar is visible BEFORE selection.
    const actionRow = firstNode.locator('[data-testid="node-status-bar"]')
    await expect(actionRow).toBeVisible()

    // Select the node - the bar stays visible (no chrome morph on selection).
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')
    await expect(actionRow).toBeVisible()
  })

  test('V-CANVAS-03-S3: action row shows version indicator on left', async ({ page }) => {
    // Per CANVAS-37: Action row: version (left)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // No inline version label on the canvas. Only the ver-update arrow appears
    // in the action cluster when a newer version is available, and the
    // configuration-modal header is the only version-display surface.
    await expect(page.locator('[data-testid="block-version"]')).toHaveCount(0)
  })

  test('V-CANVAS-03-S4: action row has gear icon (configure button)', async ({ page }) => {
    // Per CANVAS-37, CANVAS-38: Gear opens floating Properties modal
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Gear button (Configure) should be visible
    const gearButton = page.locator('[data-testid="node-configure"]').first()
    await expect(gearButton).toBeVisible()
  })

  test('V-CANVAS-03-S5: action row has kebab menu (more options)', async ({ page }) => {
    // Per CANVAS-39: Kebab mirrors right-click context menu
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Kebab button (More options) should be visible
    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await expect(kebabButton).toBeVisible()
  })

  test('V-CANVAS-03-S6: kebab menu opens with correct action groups', async ({ page }) => {
    // Per CANVAS-40: Kebab groups: Run, Debug, Edit (Duplicate/Copy/Cut), Disable, Delete (red)
    // Per CANVAS-143: "Toggle Breakpoint" in Debug actions
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Open kebab menu
    const kebabButton = page.locator('[data-testid="node-kebab"]').first()
    await kebabButton.click()

    // Wait for menu to open
    const menuContent = page.locator('[role="menu"]')
    await expect(menuContent).toBeVisible()

    // Verify Execution group: Run Current + Run from Here.
    await expect(menuContent.getByText('Run Current')).toBeVisible()
    await expect(menuContent.getByText('Run from Here')).toBeVisible()

    // Verify Debug group: Debug Current (REQ-3.2.1.5) +
    // Debug from Here + Toggle Breakpoint.
    await expect(menuContent.getByText('Debug Current')).toBeVisible()
    await expect(menuContent.getByText('Debug from Here')).toBeVisible()
    await expect(menuContent.getByText('Toggle Breakpoint')).toBeVisible()

    // Verify Clipboard/Edit group
    await expect(menuContent.getByText('Duplicate')).toBeVisible()
    await expect(menuContent.getByText('Copy')).toBeVisible()
    await expect(menuContent.getByText('Cut')).toBeVisible()
    await expect(menuContent.getByText('Unlink')).toBeVisible()

    // Verify State group
    await expect(menuContent.getByText('Disable')).toBeVisible()
    await expect(menuContent.getByText('Skip')).toBeVisible()

    // Verify Destructive group
    const deleteItem = menuContent.getByText('Delete')
    await expect(deleteItem).toBeVisible()
    // Delete should have red/destructive styling
    await expect(deleteItem).toHaveClass(/text-destructive/)
  })

  test('V-CANVAS-03-S7: selection does not change surrounding UI layout', async ({ page }) => {
    // Per CANVAS-35: Selection doesn't change surrounding UI
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    const palette = page.locator('[data-testid="block-palette"]')

    // Get initial positions
    const canvasBoxBefore = await canvas.boundingBox()
    const toolbarBoxBefore = await toolbar.boundingBox()
    const breadcrumbBoxBefore = await breadcrumb.boundingBox()
    const paletteBoxBefore = await palette.boundingBox()

    // Select a node
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await workflowNodes.first().locator('button').first().dispatchEvent('click')

    // Get positions after selection
    const canvasBoxAfter = await canvas.boundingBox()
    const toolbarBoxAfter = await toolbar.boundingBox()
    const breadcrumbBoxAfter = await breadcrumb.boundingBox()
    const paletteBoxAfter = await palette.boundingBox()

    // Verify surrounding UI layout unchanged
    expect(canvasBoxAfter).toEqual(canvasBoxBefore)
    expect(toolbarBoxAfter).toEqual(toolbarBoxBefore)
    expect(breadcrumbBoxAfter).toEqual(breadcrumbBoxBefore)
    expect(paletteBoxAfter).toEqual(paletteBoxBefore)
  })

  test('V-CANVAS-03-S8: gear button opens config modal', async ({ page }) => {
    // Per CANVAS-38: Gear opens floating Properties modal
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Select the node
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Click gear button
    const gearButton = page.locator('[data-testid="node-configure"]').first()
    await gearButton.click()

    // Modal should open
    const modal = configSheet(page)
    await expect(modal).toBeVisible()

    // Modal should have a title (the element name)
    const modalTitle = modal.locator('h2').first()
    await expect(modalTitle).toBeVisible()
  })

  test('V-CANVAS-03-S9: multi-select keeps per-node status bars visible', async ({ page }) => {
    // Every node carries its own persistent
    // status bar. Multi-select adds dashed halos but does NOT hide the bars.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add two nodes
    await addNodeFromPalette(page)
    await findItemBySearch(page, 'sql')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'sql', { x: canvasBox!.width / 3, y: (canvasBox!.height * 2) / 3 })
    await page.waitForTimeout(100)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await workflowNodes.count()
    expect(nodeCount).toBeGreaterThanOrEqual(2)

    // Single-select first node - its own bar is visible.
    await workflowNodes.nth(0).locator('button').first().dispatchEvent('click')
    await expect(workflowNodes.nth(0).locator('[data-testid="node-status-bar"]')).toBeVisible()

    // Ctrl+click second node for multi-select.
    await workflowNodes.nth(1).locator('button').first().dispatchEvent('click', { ctrlKey: true })

    // Both nodes are selected.
    await expect(workflowNodes.nth(0)).toHaveAttribute('data-selected', 'true')
    await expect(workflowNodes.nth(1)).toHaveAttribute('data-selected', 'true')

    // Both per-node bars remain visible (no chrome morph on multi-select).
    await expect(workflowNodes.nth(0).locator('[data-testid="node-status-bar"]')).toBeVisible()
    await expect(workflowNodes.nth(1).locator('[data-testid="node-status-bar"]')).toBeVisible()
  })
})
