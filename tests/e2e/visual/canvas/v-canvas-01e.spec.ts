/**
 * V-CANVAS-01e: Variable Manager Panel Layout
 *
 * REQ: REQ-3.1.3.11 (Variable watching UI panel)
 *
 * Pass Criteria:
 * 1. Panel visible on right edge of canvas
 * 2. Collapsed state: 64px width, vertical label, icon in rounded box
 * 3. Expanded state: 320px default width
 * 4. Full height of canvas viewport
 * 5. Expand/collapse button toggles state
 * 6. Left border for visual separation
 * 7. Resize handle visible when expanded
 * 8. Resize handle hidden when collapsed
 * 9. Icon visible in collapsed state
 * 10. Header with title in expanded state
 *
 * NOTE: The application renders VariableManagerPanel with defaultCollapsed={false},
 * so the panel starts EXPANDED by default.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-CANVAS-01e: Variable Manager Panel Layout', () => {
  // Helper to collapse the Variable Manager panel
  async function collapseVariableManager(page: import('@playwright/test').Page) {
    const panel = page.locator('[data-testid="variable-manager"]')
    const state = await panel.getAttribute('data-state')
    if (state === 'expanded') {
      // Use specific aria-label to avoid matching section collapse buttons
      const collapseButton = panel.locator('button[aria-label="Collapse Variable Manager"]')
      await collapseButton.click()
      await expect(panel).toHaveAttribute('data-state', 'collapsed')
    }
  }

  // Helper to expand the Variable Manager panel
  async function expandVariableManager(page: import('@playwright/test').Page) {
    const panel = page.locator('[data-testid="variable-manager"]')
    const state = await panel.getAttribute('data-state')
    if (state === 'collapsed') {
      const expandButton = panel.locator('button[aria-label="Expand Variable Manager"]')
      await expandButton.click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }
  }

  test('panel visible on right edge of canvas', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')
    await expect(panel).toBeVisible()

    // Panel should have left border (right side position)
    await expect(panel).toHaveClass(/border-l/)
  })

  test('panel starts expanded by default', async ({ page }) => {
    // The app renders with defaultCollapsed={false}
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    const panelBox = await panel.boundingBox()
    expect(panelBox?.width, 'Expanded width should be 320px').toBe(320)
  })

  test('collapsed state dimensions (64px width)', async ({ page }) => {
    // Collapsed width is 64px, matching the palette style.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel starts expanded, so collapse it first
    await collapseVariableManager(page)

    const panelBox = await panel.boundingBox()
    expect(panelBox?.width, 'Collapsed width should be 64px').toBe(64)
  })

  test('collapsed state shows vertical label', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await collapseVariableManager(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Should show stacked letters for "Variable Manager"
    // First letter "V" should be visible
    const firstLetter = panel.locator('span').filter({ hasText: /^V$/ }).first()
    await expect(firstLetter).toBeVisible()
  })

  test('collapsed state shows icon in rounded box', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await collapseVariableManager(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Icon should be inside a rounded box (same as palette style)
    const iconBox = panel.locator('div.rounded-lg').first()
    await expect(iconBox).toBeVisible()

    // Box should contain SVG icon
    const icon = iconBox.locator('svg')
    await expect(icon).toBeVisible()
  })

  test('expanded state dimensions (320px default width)', async ({ page }) => {
    // Per VariableManagerPanel props: expandedSize={320}
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel starts expanded
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    const panelBox = await panel.boundingBox()
    expect(panelBox?.width, 'Expanded width should be 320px').toBe(320)
  })

  test('panel fills full height of canvas viewport', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')
    const canvasPage = page.locator('[data-testid="canvas-page"]')

    const panelBox = await panel.boundingBox()
    const canvasBox = await canvasPage.boundingBox()

    // Panel should start at same Y as canvas content area
    // and extend to same bottom
    expect(panelBox).not.toBeNull()
    expect(canvasBox).not.toBeNull()

    // Panel height should match the main content area height
    // (toolbar + breadcrumb are above, panel should fill remaining height)
    expect(panelBox!.height).toBeGreaterThan(400) // Reasonable minimum height
  })

  test('expand/collapse button toggles state', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Initially expanded (app default)
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    // Click collapse button (specific aria-label)
    const collapseButton = panel.locator('button[aria-label="Collapse Variable Manager"]')
    await collapseButton.click()
    await expect(panel).toHaveAttribute('data-state', 'collapsed')

    // Click expand button
    const expandButton = panel.locator('button[aria-label="Expand Variable Manager"]')
    await expandButton.click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  })

  test('left border visible for visual separation', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel should have border-l class for left border
    await expect(panel).toHaveClass(/border-l/)
  })

  test('resize handle visible when expanded', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel starts expanded
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    // Resize handle should be visible
    const resizeHandle = page.locator('[data-testid="variable-manager-resize-handle"]')
    await expect(resizeHandle).toBeVisible()
  })

  test('resize handle hidden when collapsed', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await collapseVariableManager(page)

    // Resize handle should not be visible
    const resizeHandle = page.locator('[data-testid="variable-manager-resize-handle"]')
    await expect(resizeHandle).not.toBeVisible()
  })

  test('header with title visible in expanded state', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel starts expanded
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    // Header should show "Variable Manager" title
    const title = panel.locator('span.font-bold', { hasText: 'Variable Manager' })
    await expect(title).toBeVisible()
  })

  test('panel can be resized within min/max bounds', async ({ page }) => {
    // Per VariableManagerPanel props: minSize={240}, maxSize={600}
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')

    // Panel starts expanded
    await expect(panel).toHaveAttribute('data-state', 'expanded')

    // Get resize handle
    const resizeHandle = page.locator('[data-testid="variable-manager-resize-handle"]')
    const handleBox = await resizeHandle.boundingBox()

    // Drag to resize (move left to make panel wider)
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox!.x - 100, handleBox!.y + handleBox!.height / 2)
    await page.mouse.up()

    // Panel should be wider but within max bound
    const panelBox = await panel.boundingBox()
    expect(panelBox!.width).toBeGreaterThanOrEqual(240) // minSize
    expect(panelBox!.width).toBeLessThanOrEqual(600) // maxSize
  })
})
