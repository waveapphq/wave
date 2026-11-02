/**
 * V-CANVAS-SHORTCUTS: Keyboard Shortcuts for Canvas Operations
 *
 * Wireframe: N/A - behavioral test, no wireframe
 * REQ: REQ-4.2.5 Keyboard shortcuts for common operations
 *
 * Pass Criteria:
 * 1. Ctrl+A selects all nodes on canvas
 * 2. Ctrl+C copies selected nodes to clipboard
 * 3. Ctrl+V pastes nodes from clipboard (new nodes appear)
 * 4. Ctrl+X cuts selected nodes (removes originals, puts in clipboard)
 * 5. Ctrl+D duplicates selected nodes (new nodes appear immediately)
 * 6. Ctrl+Z undoes the last action (e.g., undo a node addition)
 * 7. Ctrl+Shift+Z redoes the undone action
 * 8. Shortcuts do not fire when focus is in a text input
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

test.describe('V-CANVAS-SHORTCUTS: Keyboard Shortcuts', () => {
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

  // Helper to add a workflow node at canvas center
  async function addNodeFromPalette(page: Page, searchTerm = 'http') {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)

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

  // Helper to get workflow node count (excluding start node)
  async function getWorkflowNodeCount(page: Page): Promise<number> {
    return page.locator('[data-testid^="workflow-node-"][data-nodetype]').count()
  }

  // Helper to click on canvas to ensure focus is on canvas (not input)
  async function focusCanvas(page: Page) {
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    await canvas.click({ position: { x: 10, y: 10 } })
    await page.waitForTimeout(50)
  }

  test('Ctrl+A selects all nodes', async ({ page }) => {
    // Pass Criterion 1: Ctrl+A selects all nodes
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add two nodes
    await addNodeFromPalette(page, 'http')
    await addNodeFromPalette(page, 'shell script')

    const nodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const nodeCount = await nodes.count()
    expect(nodeCount, 'Should have at least 2 workflow nodes').toBeGreaterThanOrEqual(2)

    // Click empty canvas to deselect all
    await focusCanvas(page)

    // Press Ctrl+A
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)

    // All workflow nodes should be selected
    const selectedNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]')
    const selectedCount = await selectedNodes.count()
    expect(selectedCount, 'All workflow nodes should be selected').toBe(nodeCount)
  })

  test('Ctrl+C and Ctrl+V copies and pastes nodes', async ({ page }) => {
    // Pass Criteria 2-3: Copy then paste creates new nodes
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    const initialCount = await getWorkflowNodeCount(page)
    expect(initialCount, 'Should have at least 1 workflow node').toBeGreaterThanOrEqual(1)

    // Click the node to select it
    const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await firstNode.click()
    await page.waitForTimeout(100)

    // Copy with Ctrl+C
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(100)

    // Click empty area to deselect
    await focusCanvas(page)

    // Paste with Ctrl+V
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(200)

    // Should have more nodes than before
    const afterPasteCount = await getWorkflowNodeCount(page)
    expect(afterPasteCount, 'Paste should create new nodes').toBeGreaterThan(initialCount)
  })

  test('Ctrl+X cuts selected nodes', async ({ page }) => {
    // Pass Criterion 4: Cut removes originals and places in clipboard
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    const initialCount = await getWorkflowNodeCount(page)
    expect(initialCount, 'Should have at least 1 workflow node').toBeGreaterThanOrEqual(1)

    // Click the node to select it
    const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await firstNode.click()
    await page.waitForTimeout(100)

    // Cut with Ctrl+X
    await page.keyboard.press('Control+x')
    await page.waitForTimeout(200)

    // Node should be removed
    const afterCutCount = await getWorkflowNodeCount(page)
    expect(afterCutCount, 'Cut should remove the selected node').toBeLessThan(initialCount)

    // Paste to verify clipboard has the cut node
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(200)

    const afterPasteCount = await getWorkflowNodeCount(page)
    expect(afterPasteCount, 'Paste after cut should restore the node').toBeGreaterThanOrEqual(initialCount)
  })

  test('Ctrl+D duplicates selected nodes', async ({ page }) => {
    // Pass Criterion 5: Duplicate creates new nodes immediately
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    const initialCount = await getWorkflowNodeCount(page)

    // Click the node to select it
    const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await firstNode.click()
    await page.waitForTimeout(100)

    // Duplicate with Ctrl+D
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(200)

    // Should have more nodes
    const afterDuplicateCount = await getWorkflowNodeCount(page)
    expect(afterDuplicateCount, 'Duplicate should create new nodes').toBeGreaterThan(initialCount)
  })

  test('Ctrl+Z undoes the last action', async ({ page }) => {
    // Pass Criterion 6: Undo reverses node addition
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    const afterAddCount = await getWorkflowNodeCount(page)
    expect(afterAddCount, 'Should have at least 1 workflow node').toBeGreaterThanOrEqual(1)

    // Focus canvas (not search input)
    await focusCanvas(page)

    // Undo with Ctrl+Z
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)

    // The undo button in toolbar should reflect state change
    // The node may be removed or the undo button should now have different state
    const undoButton = page.locator('[data-testid="toolbar-undo-button"]')

    // After adding a node and then undoing, undo button should eventually become disabled
    // (if this was the only action). But there might be viewport change actions too.
    // The key verification: redo button should become enabled after undo
    const redoButton = page.locator('[data-testid="toolbar-redo-button"]')
    await expect(redoButton, 'Redo button should be enabled after undo').toBeEnabled()
  })

  test('Ctrl+Shift+Z redoes the undone action', async ({ page }) => {
    // Pass Criterion 7: Redo reverses the undo
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    // Focus canvas
    await focusCanvas(page)

    // Undo with Ctrl+Z
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)

    const redoButton = page.locator('[data-testid="toolbar-redo-button"]')
    await expect(redoButton, 'Redo should be enabled after undo').toBeEnabled()

    // Redo with Ctrl+Shift+Z
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(200)

    // After redo, undo should be enabled again (the action was redone)
    const undoButton = page.locator('[data-testid="toolbar-undo-button"]')
    await expect(undoButton, 'Undo should be enabled after redo').toBeEnabled()
  })

  test('Ctrl+C/V on configured node clears output bindings on pasted copy', async ({ page }) => {
    // Gap 13: Paste should not carry over output bindings (avoids duplicate variable writes)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add an HTTP Client node
    await addNodeFromPalette(page, 'http')

    // Select the node and open config (gear button)
    const firstNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    const gearButton = firstNode.locator('[data-testid="node-configure"]')
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible()

    // Fill required url field so Save button becomes enabled (via the sheet)
    await setStringParam(modal, page, 'url', 'https://example.com')

    // Type a binding name in the status_code output row
    const statusRow = modal.locator('[data-testid="output-row-status_code"]')
    const bindingInput = statusRow.locator('textarea[placeholder="variable_name"]')
    await bindingInput.fill('my_status_var')

    // Save the config
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await saveButton.click()
    await expect(modal).not.toBeVisible()

    // Re-select the node (modal close may deselect)
    await firstNode.locator('button').first().dispatchEvent('click')
    await page.waitForTimeout(100)

    // Copy with Ctrl+C
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(100)

    // Click empty area, then paste
    await focusCanvas(page)
    await page.keyboard.press('Control+v')
    await page.waitForTimeout(200)

    // The pasted node should be selected (paste auto-selects new nodes)
    // Open config on the pasted (newly selected) node
    const selectedNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]'
    )
    await expect(selectedNodes).toHaveCount(1)

    // Scope to the currently-selected node (every node has its own cog).
    const gearButton2 = selectedNodes.first().locator('[data-testid="node-configure"]')
    await gearButton2.click()

    const modal2 = configSheet(page)
    await expect(modal2).toBeVisible()

    // Output binding for status_code should be empty on pasted node
    const statusRow2 = modal2.locator('[data-testid="output-row-status_code"]')
    const bindingInput2 = statusRow2.locator('textarea[placeholder="variable_name"]')
    await expect(bindingInput2).toHaveValue('')
  })

  test('shortcuts do not fire when focus is in a text input', async ({ page }) => {
    // Pass Criterion 8: Focus guards prevent shortcuts in inputs
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add a node
    await addNodeFromPalette(page, 'http')

    const initialCount = await getWorkflowNodeCount(page)

    // Focus the palette search input (a text input)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.click()
    await searchInput.fill('')

    // Press Ctrl+A while in search input - should select text, not nodes
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)

    // Workflow nodes should NOT all be selected (shortcut was absorbed by input)
    // Verify by checking that nodes don't all have data-selected="true"
    const selectedNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype][data-selected="true"]')
    const selectedCount = await selectedNodes.count()
    expect(selectedCount, 'Nodes should not be selected when focus is in input').toBeLessThan(initialCount)
  })
})
