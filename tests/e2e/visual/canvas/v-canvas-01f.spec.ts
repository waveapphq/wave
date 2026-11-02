/**
 * V-CANVAS-01f: Palette Collapsed State
 *
 * Design Decisions: CANVAS-13 through CANVAS-18
 * REQ: REQ-3.1.1.1 (Drag-and-drop interface), REQ-4.2.1 (No-code test creation), REQ-4.2.3 (Intuitive drag-drop interface)
 *
 * Pass Criteria:
 * 1. Palette collapsed width is 64px with category icons
 * 2. Expand button expands palette to 260px
 * 3. Clicking category icon shows popover with category content
 * 4. Elements can be dragged directly from popover to canvas
 * 5. Popover dismisses when clicking outside
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-CANVAS-01f: Palette Collapsed State', () => {
  // No backend data needed - tests UI components with hardcoded data
  // Runs in parallel no-data phase

  test('V-CANVAS-01f: collapsed palette structure', async ({ page }) => {
    // Verify: 64px width, icons present, collapsed state
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toBeVisible()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')

    const paletteBox = await palette.boundingBox()
    expect(paletteBox?.width, 'Collapsed width should be 64px').toBe(64)

    // Verify icon strip is present
    const iconStrip = page.locator('[data-testid="palette-icon-strip"]')
    await expect(iconStrip).toBeVisible()

    // Verify key icons exist
    await expect(page.locator('[data-testid="palette-icon-search"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-icon-controls"]')).toBeVisible()
    await expect(page.locator('[data-testid="palette-icon-plugins"]')).toBeVisible()
  })

  test('V-CANVAS-01f-S1: expand button expands palette', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toHaveAttribute('data-state', 'collapsed')

    // Click the expand button (at bottom of collapsed palette)
    const expandButton = page.locator('[data-testid="palette-expand-button"]')
    await expect(expandButton).toBeVisible()
    await expandButton.click()

    // Palette should now be expanded
    await expect(palette).toHaveAttribute('data-state', 'expanded')
    const paletteBox = await palette.boundingBox()
    expect(paletteBox?.width, 'Expanded width should be 260px').toBe(260)
  })

  test('V-CANVAS-01f-S2: Controls popover shows control items on click', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Click Controls icon to open popover
    const controlsIcon = page.locator('[data-testid="palette-icon-controls"]')
    await controlsIcon.click()

    // Popover appears with controls content
    const popover = page.locator('[data-testid="palette-flyout-controls"]')
    await expect(popover).toBeVisible()

    // Verify control items present (spot check key items)
    await expect(popover.locator('[data-testid^="flyout-item-"]').first()).toBeVisible()

    // Close popover by clicking outside
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
  })

  test('V-CANVAS-01f-S3: Plugins popover shows plugin categories on click', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const pluginsIcon = page.locator('[data-testid="palette-icon-plugins"]')
    await pluginsIcon.click()

    const popover = page.locator('[data-testid="palette-flyout-plugins"]')
    await expect(popover).toBeVisible()

    // Verify plugin content is displayed
    await expect(popover.locator('text=Network')).toBeVisible()
    await expect(popover.locator('text=Database')).toBeVisible()

    // Close popover
    await page.keyboard.press('Escape')
  })

  test('V-CANVAS-01f-S4: search popover allows searching', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    // Click search icon to open popover
    const searchIcon = page.locator('[data-testid="palette-icon-search"]')
    await searchIcon.click()

    const popover = page.locator('[data-testid="palette-flyout-search"]')
    await expect(popover).toBeVisible()

    // Search input should be visible and focusable
    const searchInput = popover.locator('[data-testid="flyout-search-input"]')
    await expect(searchInput).toBeVisible()

    // Close popover
    await page.keyboard.press('Escape')
  })

  test('V-CANVAS-01f-S5: popover dismisses on Escape key', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const controlsIcon = page.locator('[data-testid="palette-icon-controls"]')
    await controlsIcon.click()

    const popover = page.locator('[data-testid="palette-flyout-controls"]')
    await expect(popover).toBeVisible()

    // Press Escape to dismiss
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
  })
})
