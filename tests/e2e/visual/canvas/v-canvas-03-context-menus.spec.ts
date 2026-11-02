/**
 * V-CANVAS-03 Extended: Right-Click Context Menus
 *
 * Design Decisions: CANVAS-39 (kebab mirrors right-click), CANVAS-40 (menu groups)
 *
 * Three right-click targets:
 * 1. Node: Same grouped menu as kebab (CANVAS-39)
 * 2. Canvas pane: Paste, Select All, Fit View, Unskip All, Enable All
 * 3. Edge: Delete
 *
 * Pass Criteria:
 * 1. Right-clicking a node opens context menu with all action groups
 * 2. Right-clicking an unselected node auto-selects it
 * 3. Right-clicking empty canvas opens canvas context menu
 * 4. Canvas context menu items have correct enabled/disabled states
 * 5. Right-clicking an edge opens edge context menu with Delete
 * 6. Edge Delete removes the edge
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03: Right-Click Context Menus', () => {
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

  // Helper to add a workflow node at specific canvas position
  async function addNodeFromPalette(
    page: import('@playwright/test').Page,
    searchTerm = 'http',
    position?: { x: number; y: number }
  ) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)

    const testIdMap: Record<string, string> = {
      'http': 'palette-item-http-client',
      'sql': 'palette-item-sql-client',
      'if': 'palette-item-if-else',
      'shell script': 'palette-item-shell-script',
    }

    const testId = testIdMap[searchTerm] ?? `palette-item-${searchTerm}`
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    const targetPos = position ?? { x: canvasBox!.width / 2, y: canvasBox!.height / 2 }
    await dragPaletteItemToCanvas(page, { term: searchTerm, testId }, targetPos)
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

    // Drop below Start node within auto-connect threshold
    const dropX = startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2
    const dropY = startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60

    await dragPaletteItemToCanvas(page, 'if', { x: dropX, y: dropY })
    // Wait for the node to actually appear (drag-drop can fail silently under load)
    await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()).toBeVisible({ timeout: 5000 })
  }

  // ============================================================================
  // Node Right-Click Context Menu (CANVAS-39)
  // ============================================================================

  test('right-click on node opens context menu with all action groups', async ({ page }) => {
    // Per CANVAS-39: Right-click mirrors kebab menu
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Right-click on the node
    await firstNode.click({ button: 'right' })

    // Radix ContextMenu should appear with role="menu"
    // Wait for the Radix context menu (distinct from any dropdown menu)
    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Verify Execution group: Run Current at the top of the group, Run from Here below
    await expect(contextMenu.getByText('Run Current')).toBeVisible()
    await expect(contextMenu.getByText('Run from Here')).toBeVisible()

    // Verify Debug group: Debug Current + Debug from Here above Toggle Breakpoint
    await expect(contextMenu.getByText('Debug Current')).toBeVisible()
    await expect(contextMenu.getByText('Debug from Here')).toBeVisible()
    await expect(contextMenu.getByText('Toggle Breakpoint')).toBeVisible()

    // Verify Clipboard/Edit group
    await expect(contextMenu.getByText('Duplicate')).toBeVisible()
    await expect(contextMenu.getByText('Copy')).toBeVisible()
    await expect(contextMenu.getByText('Cut')).toBeVisible()
    await expect(contextMenu.getByText('Unlink')).toBeVisible()

    // Verify State group
    await expect(contextMenu.getByText('Disable')).toBeVisible()
    await expect(contextMenu.getByText('Skip')).toBeVisible()

    // Verify Destructive group
    await expect(contextMenu.getByText('Delete')).toBeVisible()
  })

  test('right-click auto-selects unselected node', async ({ page }) => {
    // Per implementation: onContextMenu selects node if not already selected
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Node should not be selected initially
    await expect(firstNode).not.toHaveAttribute('data-selected', 'true')

    // Right-click the node
    await firstNode.click({ button: 'right' })

    // Node should now be selected
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Dismiss context menu
    await page.keyboard.press('Escape')
  })

  // ============================================================================
  // Canvas Pane Right-Click Context Menu
  // ============================================================================

  test('right-click on empty canvas opens canvas context menu', async ({ page }) => {
    // Per design: Canvas pane right-click shows Paste, Select All, Fit View, Unskip All, Enable All
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Right-click on empty canvas area (far from Start node)
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

    // Canvas context menu should appear
    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Verify all canvas menu items present
    await expect(contextMenu.getByText('Paste')).toBeVisible()
    await expect(contextMenu.getByText('Select All')).toBeVisible()
    await expect(contextMenu.getByText('Fit View')).toBeVisible()
    await expect(contextMenu.getByText('Unskip All')).toBeVisible()
    await expect(contextMenu.getByText('Enable All')).toBeVisible()
  })

  test('canvas context menu Paste is disabled when clipboard is empty', async ({ page }) => {
    // Per design: Paste disabled with empty clipboard
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Right-click on empty canvas
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Paste should be disabled (aria-disabled on the menuitem div directly)
    const pasteItem = contextMenu.getByText('Paste')
    await expect(pasteItem).toHaveAttribute('aria-disabled', 'true')
  })

  test('canvas context menu Unskip All and Enable All disabled when no nodes affected', async ({ page }) => {
    // Per design: Unskip All disabled when 0 skipped, Enable All disabled when 0 disabled
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Right-click on empty canvas
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Unskip All should be disabled (no skipped nodes)
    const unskipItem = contextMenu.getByText('Unskip All')
    await expect(unskipItem).toHaveAttribute('aria-disabled', 'true')

    // Enable All should be disabled (no disabled nodes)
    const enableItem = contextMenu.getByText('Enable All')
    await expect(enableItem).toHaveAttribute('aria-disabled', 'true')
  })

  test('canvas context menu closes on outside click', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Open canvas context menu
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Click outside (left-click on canvas)
    await page.mouse.click(canvasBox!.x + 20, canvasBox!.y + canvasBox!.height - 20)

    // Menu should close
    await expect(contextMenu).not.toBeVisible()
  })

  // ============================================================================
  // Edge Right-Click Context Menu
  // ============================================================================

  test('right-click on edge opens context menu with Delete', async ({ page }) => {
    // Per design: Edge context menu has single Delete action
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop node near Start to create auto-connected edge
    await addConnectedNode(page)

    // Find the edge (React Flow renders edges as SVG paths)
    const edges = page.locator('.react-flow__edge')
    const edgeCount = await edges.count()
    expect(edgeCount, 'Should have at least one edge from auto-connect').toBeGreaterThanOrEqual(1)

    // Right-click on the first non-ghost edge
    // Use the edge interaction path which is wider for easier clicking
    const edgePath = edges.first().locator('.react-flow__edge-interaction')
    const edgeBox = await edgePath.boundingBox()

    if (edgeBox) {
      await page.mouse.click(
        edgeBox.x + edgeBox.width / 2,
        edgeBox.y + edgeBox.height / 2,
        { button: 'right' }
      )
    } else {
      // Fallback: right-click the edge group element
      await edges.first().click({ button: 'right' })
    }

    // Edge context menu should appear with Delete
    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()
    await expect(contextMenu.getByText('Delete')).toBeVisible()
  })

  test('edge Delete removes the edge', async ({ page }) => {
    // Per design: Clicking Delete in edge context menu removes the edge
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop node near Start to create auto-connected edge
    await addConnectedNode(page)

    // Count edges before delete
    const edges = page.locator('.react-flow__edge')
    const edgeCountBefore = await edges.count()
    expect(edgeCountBefore, 'Should have at least one edge').toBeGreaterThanOrEqual(1)

    // Right-click edge to open context menu
    const edgePath = edges.first().locator('.react-flow__edge-interaction')
    const edgeBox = await edgePath.boundingBox()

    if (edgeBox) {
      await page.mouse.click(
        edgeBox.x + edgeBox.width / 2,
        edgeBox.y + edgeBox.height / 2,
        { button: 'right' }
      )
    } else {
      await edges.first().click({ button: 'right' })
    }

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Click Delete
    await contextMenu.getByText('Delete').click()

    // Edge count should decrease
    await page.waitForTimeout(100)
    const edgeCountAfter = await edges.count()
    expect(edgeCountAfter, 'Edge should be removed').toBeLessThan(edgeCountBefore)
  })
})
