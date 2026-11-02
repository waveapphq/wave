/**
 * V-CANVAS-03-S44/S45: Pill-Shaped Connection Handles
 *
 * REQ: REQ-3.1.1.2 Pill-shaped connection handles
 *
 * Pass Criteria:
 * S44:
 *   1. All nodes show pill-shaped handles (16px wide × 8px tall, rounded capsule)
 *   2. Regular nodes use solid zinc-600 fill
 *   3. Start node uses green-500 fill matching its color scheme
 *   4. Hover shows 2px ring outline (zinc-400 for regular, green-400 for Start)
 *   5. React Flow's default 6px circle CSS is overridden with !important
 *   6. Handle colors are solid (no alpha) - bg-border has alpha in dark theme
 *
 * S45:
 *   1. Egress (output) handle contains a downward chevron (▾) indicating flow direction
 *   2. Ingress (input) handle is a plain pill with no icon
 *   3. Chevron is rendered as ChevronDown from lucide-react
 *   4. Start node's output handle also has the chevron
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-CANVAS-03-S44/S45: Pill-Shaped Handles & Chevron', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  // Helper to expand palette and add a node
  async function addNodeFromPalette(page: import('@playwright/test').Page, searchTerm = 'http') {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }

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

  // ============================================================================
  // V-CANVAS-03-S44: Pill-shaped handles visible on all nodes
  // ============================================================================

  test('S44: Start node has pill-shaped output handle', async ({ page }) => {
    // Per design: Start node output handle is pill-shaped (16×8px) with green-500 fill
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const startNode = page.locator('[data-testid="start-node"]')
    await expect(startNode).toBeVisible()

    // Start node has a source handle (output) - use .react-flow__handle which is the
    // base class React Flow applies to all Handle components
    const outputHandle = startNode.locator('.react-flow__handle')
    await expect(outputHandle).toBeVisible()

    // Verify pill shape CSS overrides (React Flow default is 6px circle)
    // The handle should have !w-4 (16px) and !h-2 (8px) and !rounded-full
    await expect(outputHandle).toHaveClass(/!w-4/)
    await expect(outputHandle).toHaveClass(/!h-2/)
    await expect(outputHandle).toHaveClass(/!rounded-full/)

    // Start node handle should be green-500
    await expect(outputHandle).toHaveClass(/!bg-green-500/)
  })

  test('S44: workflow node has pill-shaped input and output handles', async ({ page }) => {
    // Per design: Regular nodes have zinc-600 pill handles
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    await expect(workflowNode.first()).toBeVisible()

    // Check input (target) handle
    const inputHandle = workflowNode.first().locator('[data-testid="handle-input"]')
    await expect(inputHandle).toBeVisible()
    await expect(inputHandle).toHaveClass(/!w-4/)
    await expect(inputHandle).toHaveClass(/!h-2/)
    await expect(inputHandle).toHaveClass(/!rounded-full/)
    await expect(inputHandle).toHaveClass(/!bg-zinc-600/)

    // Check output (source) handle
    const outputHandle = workflowNode.first().locator('[data-testid="handle-output"]')
    await expect(outputHandle).toBeVisible()
    await expect(outputHandle).toHaveClass(/!w-4/)
    await expect(outputHandle).toHaveClass(/!h-2/)
    await expect(outputHandle).toHaveClass(/!rounded-full/)
    await expect(outputHandle).toHaveClass(/!bg-zinc-600/)
  })

  test('S44: multiple nodes all show pill handles', async ({ page }) => {
    // Per design: All node types have pill-shaped handles
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Add two different node types
    await addNodeFromPalette(page, 'http')

    // Clear search and add another
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.clear()
    await searchInput.fill('shell script')
    await page.waitForTimeout(100)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'shell script', { x: canvasBox!.width / 2 + 150, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)

    // Verify all workflow nodes have pill handles
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const count = await workflowNodes.count()
    expect(count, 'Should have at least 2 workflow nodes').toBeGreaterThanOrEqual(2)

    for (let i = 0; i < count; i++) {
      const node = workflowNodes.nth(i)
      const input = node.locator('[data-testid="handle-input"]')
      const output = node.locator('[data-testid="handle-output"]')
      await expect(input).toHaveClass(/!w-4/)
      await expect(output).toHaveClass(/!w-4/)
    }
  })

  // ============================================================================
  // V-CANVAS-03-S45: Egress handle shows directional chevron
  // ============================================================================

  test('S45: output handle has chevron (▾) inside', async ({ page }) => {
    // Per design: Egress handle contains ChevronDown indicating flow direction
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const outputHandle = workflowNode.first().locator('[data-testid="handle-output"]')

    // Chevron should be inside the output handle
    const chevron = outputHandle.locator('[data-testid="handle-chevron"]')
    await expect(chevron).toBeVisible()
  })

  test('S45: input handle has NO chevron', async ({ page }) => {
    // Per design: Ingress handle is a plain pill with no icon
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const inputHandle = workflowNode.first().locator('[data-testid="handle-input"]')

    // Input handle should NOT have a chevron
    const chevron = inputHandle.locator('[data-testid="handle-chevron"]')
    await expect(chevron).toHaveCount(0)
  })

  test('S45: Start node output handle also has chevron', async ({ page }) => {
    // Per design: Start node's egress pill also has directional chevron
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const startNode = page.locator('[data-testid="start-node"]')
    const outputHandle = startNode.locator('.react-flow__handle')

    // Start node's output handle should have a chevron
    const chevron = outputHandle.locator('[data-testid="handle-chevron"]')
    await expect(chevron).toBeVisible()
  })

  test('S45: exactly one chevron per output handle', async ({ page }) => {
    // Per design: Each output handle has exactly one chevron
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addNodeFromPalette(page)

    const workflowNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const outputHandle = workflowNode.first().locator('[data-testid="handle-output"]')

    // Exactly one chevron inside
    const chevrons = outputHandle.locator('[data-testid="handle-chevron"]')
    await expect(chevrons).toHaveCount(1)
  })
})
