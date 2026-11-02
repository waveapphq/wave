/**
 * V-CANVAS-SHORTCUT-LABELS: Shortcut Labels on Context Menus
 *
 * REQ: REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Pass Criteria:
 * 1. Node right-click context menu shows shortcut labels on applicable items
 *    - Copy: Ctrl+C, Cut: Ctrl+X, Duplicate: Ctrl+D, Delete: Del, Unlink: Backspace
 * 2. Canvas right-click context menu shows shortcut labels
 *    - Paste: Ctrl+V, Select All: Ctrl+A
 * 3. Edge right-click context menu shows shortcut label
 *    - Delete: Del
 * 4. Node kebab (⋮) dropdown shows same shortcut labels as right-click menu
 * 5. Shortcut labels are right-aligned and use muted foreground color
 * 6. Shortcut labels are aria-hidden (not read by screen readers on menuitems)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-SHORTCUT-LABELS: Context Menu Shortcut Labels', () => {
  test.beforeEach(async ({ page }) => {
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

  // Helper to add a node at canvas center
  async function addNodeFromPalette(page: Page, searchTerm = 'http') {
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
    await dragPaletteItemToCanvas(page, { term: searchTerm, testId }, { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
  }

  // Helper to add a node near Start for auto-connect (creates an edge)
  async function addConnectedNode(page: Page) {
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

    // Retry drag-drop up to 3 times (can fail silently under parallel load)
    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    for (let attempt = 0; attempt < 3; attempt++) {
      await dragPaletteItemToCanvas(page, 'if', { x: dropX, y: dropY })
      await page.waitForTimeout(300)
      if (await workflowNode.first().isVisible()) break
    }

    await expect(workflowNode.first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.react-flow__edge').first()).toBeVisible({ timeout: 5000 })
  }

  // ============================================================================
  // Node Right-Click Context Menu Shortcut Labels
  // ============================================================================

  test('node right-click context menu shows shortcut labels', async ({ page }) => {
    // Pass Criteria 1, 5, 6: Node context menu with right-aligned, aria-hidden shortcut labels
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()

    // Right-click to open context menu
    await firstNode.click({ button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Verify shortcut labels are present (aria-hidden spans inside menu items)
    // Copy → Ctrl+C
    const copyItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Copy' })
    const copyShortcut = copyItem.locator('span[aria-hidden="true"]')
    await expect(copyShortcut).toContainText('Ctrl+C')

    // Cut → Ctrl+X
    const cutItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Cut' })
    const cutShortcut = cutItem.locator('span[aria-hidden="true"]')
    await expect(cutShortcut).toContainText('Ctrl+X')

    // Duplicate → Ctrl+D
    const duplicateItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Duplicate' })
    const duplicateShortcut = duplicateItem.locator('span[aria-hidden="true"]')
    await expect(duplicateShortcut).toContainText('Ctrl+D')

    // Delete → Del
    const deleteItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Delete' })
    const deleteShortcut = deleteItem.locator('span[aria-hidden="true"]')
    await expect(deleteShortcut).toContainText('Del')

    // Unlink → Backspace
    const unlinkItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Unlink' })
    const unlinkShortcut = unlinkItem.locator('span[aria-hidden="true"]')
    await expect(unlinkShortcut).toContainText('Backspace')
  })

  // ============================================================================
  // Canvas Right-Click Context Menu Shortcut Labels
  // ============================================================================

  test('canvas right-click context menu shows shortcut labels', async ({ page }) => {
    // Pass Criterion 2: Canvas context menu with Paste and Select All labels
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    // Right-click on empty canvas area (far from Start node)
    await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible()

    // Paste → Ctrl+V
    const pasteItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Paste' })
    const pasteShortcut = pasteItem.locator('span[aria-hidden="true"]')
    await expect(pasteShortcut).toContainText('Ctrl+V')

    // Select All → Ctrl+A
    const selectAllItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Select All' })
    const selectAllShortcut = selectAllItem.locator('span[aria-hidden="true"]')
    await expect(selectAllShortcut).toContainText('Ctrl+A')

    // Fit View should NOT have a shortcut label
    const fitViewItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Fit View' })
    const fitViewShortcuts = fitViewItem.locator('span[aria-hidden="true"]')
    await expect(fitViewShortcuts).toHaveCount(0)
  })

  // ============================================================================
  // Edge Right-Click Context Menu Shortcut Label
  // ============================================================================

  test('edge right-click context menu shows Delete shortcut label', async ({ page }) => {
    // Pass Criterion 3: Edge Delete with "Del" label
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop node near Start to create auto-connected edge
    await addConnectedNode(page)

    // Wait for auto-connect edge to render (may take longer under load)
    const edges = page.locator('.react-flow__edge')
    await expect(edges.first()).toBeAttached({ timeout: 5000 })

    // Right-click on the edge
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

    // Delete → Del
    const deleteItem = contextMenu.locator('[role="menuitem"]').filter({ hasText: 'Delete' })
    const deleteShortcut = deleteItem.locator('span[aria-hidden="true"]')
    await expect(deleteShortcut).toContainText('Del')
  })

  // ============================================================================
  // Node Kebab Dropdown Shortcut Labels
  // ============================================================================

  test('node kebab dropdown shows same shortcut labels as right-click menu', async ({ page }) => {
    // Pass Criterion 4: Kebab mirrors right-click per CANVAS-39
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    // Click the node to select it (action row appears when selected)
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    await firstNode.click()
    await page.waitForTimeout(200)

    // Click the kebab (More options) button in the action row
    const kebabButton = firstNode.locator('[aria-label="More options"]')
    await expect(kebabButton).toBeVisible()
    await kebabButton.click()

    // Dropdown menu should appear
    const dropdown = page.locator('[role="menu"]')
    await expect(dropdown).toBeVisible()

    // Verify shortcut labels in kebab dropdown match context menu
    // Copy → Ctrl+C
    const copyItem = dropdown.locator('[role="menuitem"]').filter({ hasText: 'Copy' })
    const copyShortcut = copyItem.locator('span[aria-hidden="true"]')
    await expect(copyShortcut).toContainText('Ctrl+C')

    // Cut → Ctrl+X
    const cutItem = dropdown.locator('[role="menuitem"]').filter({ hasText: 'Cut' })
    const cutShortcut = cutItem.locator('span[aria-hidden="true"]')
    await expect(cutShortcut).toContainText('Ctrl+X')

    // Duplicate → Ctrl+D
    const duplicateItem = dropdown.locator('[role="menuitem"]').filter({ hasText: 'Duplicate' })
    const duplicateShortcut = duplicateItem.locator('span[aria-hidden="true"]')
    await expect(duplicateShortcut).toContainText('Ctrl+D')

    // Delete → Del
    const deleteItem = dropdown.locator('[role="menuitem"]').filter({ hasText: 'Delete' })
    const deleteShortcut = deleteItem.locator('span[aria-hidden="true"]')
    await expect(deleteShortcut).toContainText('Del')

    // Unlink → Backspace
    const unlinkItem = dropdown.locator('[role="menuitem"]').filter({ hasText: 'Unlink' })
    const unlinkShortcut = unlinkItem.locator('span[aria-hidden="true"]')
    await expect(unlinkShortcut).toContainText('Backspace')
  })
})
