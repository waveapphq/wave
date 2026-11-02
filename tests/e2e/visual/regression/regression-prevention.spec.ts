/**
 * Regression Prevention Tests
 *
 * Guards:
 * - Sidebar auto-collapse threshold and localStorage persistence
 * - Action bar and breadcrumb bar heights
 * - Bar order (action bar above breadcrumb)
 * - Back arrow visibility in draft mode
 * - Close button always visible
 * - Reset button always visible (disabled when inactive)
 * - Variable manager panel content stays inside a narrow panel (min-w-0 on ResizablePanel)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'

test.describe('V-REGRESS: Regression Prevention Tests', () => {
  // ===========================================================================
  // V-REGRESS-01: Sidebar auto-collapse at 1200px threshold
  // ===========================================================================

  test('V-REGRESS-01: sidebar auto-collapses below 1200px viewport', async ({
    page,
  }) => {
    // Start with wide viewport (sidebar should be expanded)
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.goto('/dashboard')

    const sidebarWrapper = page.locator('.group.peer[data-state]')
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'expanded')

    // Shrink viewport below 1200px threshold
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.waitForTimeout(100) // Allow resize handler to fire

    // Sidebar should auto-collapse
    await expect(
      sidebarWrapper,
      'Sidebar should auto-collapse when viewport < 1200px'
    ).toHaveAttribute('data-state', 'collapsed')
  })

  test('V-REGRESS-01-S1: sidebar auto-expands above 1200px (if not manually toggled)', async ({
    page,
  }) => {
    // Start with narrow viewport (sidebar auto-collapsed)
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto('/dashboard')

    const sidebarWrapper = page.locator('.group.peer[data-state]')
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'collapsed')

    // Grow viewport above 1200px threshold
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.waitForTimeout(100) // Allow resize handler to fire

    // Sidebar should auto-expand (user hasn't manually toggled)
    await expect(
      sidebarWrapper,
      'Sidebar should auto-expand when viewport > 1200px (if not manually toggled)'
    ).toHaveAttribute('data-state', 'expanded')
  })

  // ===========================================================================
  // V-REGRESS-02: Sidebar state persists to localStorage
  // ===========================================================================

  test('V-REGRESS-02: sidebar toggle persists to localStorage', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.goto('/dashboard')

    const sidebarWrapper = page.locator('.group.peer[data-state]')
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'expanded')

    // Manually collapse sidebar
    const collapseButton = page.getByRole('button', { name: 'Collapse sidebar' })
    await collapseButton.click()
    await page.waitForTimeout(300)

    await expect(sidebarWrapper).toHaveAttribute('data-state', 'collapsed')

    // Verify localStorage was updated
    const storedValue = await page.evaluate(() =>
      localStorage.getItem('wave-sidebar-collapsed')
    )
    expect(storedValue, 'Sidebar state should persist to localStorage').toBe('true')

    // Reload and verify state persists
    await page.reload()
    await expect(
      sidebarWrapper,
      'Sidebar state should persist after reload'
    ).toHaveAttribute('data-state', 'collapsed')
  })

  // ===========================================================================
  // V-REGRESS-03: Action bar height 48px, breadcrumb 44px
  // ===========================================================================

  test('V-REGRESS-03: action bar height is 48px', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    await expect(toolbar).toBeVisible()

    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox?.height, 'Action bar height should be 48px (h-12)').toBe(48)

    // Also verify class
    const toolbarClass = await toolbar.getAttribute('class')
    expect(toolbarClass, 'Action bar should have h-12 class').toContain('h-12')
  })

  test('V-REGRESS-03-S1: breadcrumb bar height is 44px', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb).toBeVisible()

    const breadcrumbBox = await breadcrumb.boundingBox()
    expect(breadcrumbBox?.height, 'Breadcrumb bar height should be 44px (h-11)').toBe(44)

    // Also verify class
    const breadcrumbClass = await breadcrumb.getAttribute('class')
    expect(breadcrumbClass, 'Breadcrumb bar should have h-11 class').toContain('h-11')
  })

  // ===========================================================================
  // V-REGRESS-04: Bar order - Action bar above breadcrumb
  // ===========================================================================

  test('V-REGRESS-04: action bar renders above breadcrumb bar', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const toolbar = page.locator('[data-testid="canvas-toolbar"]')
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')

    await expect(toolbar).toBeVisible()
    await expect(breadcrumb).toBeVisible()

    const toolbarBox = await toolbar.boundingBox()
    const breadcrumbBox = await breadcrumb.boundingBox()

    expect(
      toolbarBox!.y,
      'Action bar should be positioned ABOVE breadcrumb bar (lower Y value)'
    ).toBeLessThan(breadcrumbBox!.y)
  })

  // ===========================================================================
  // V-REGRESS-05: Back arrow hidden in draft mode
  // ===========================================================================

  test('V-REGRESS-05: back arrow hidden on draft pages', async ({ page }) => {
    // /tests/new is a draft page (isDraft=true)
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(
      backArrow,
      'Back arrow should NOT be visible on draft pages'
    ).not.toBeVisible()
  })

  test('V-REGRESS-05-S1: back arrow hidden on workbench draft page', async ({
    page,
  }) => {
    // /workbench is also a draft page
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const backArrow = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(
      backArrow,
      'Back arrow should NOT be visible on workbench draft page'
    ).not.toBeVisible()
  })

  // ===========================================================================
  // V-REGRESS-06: Close button always visible (including drafts)
  // ===========================================================================

  test('V-REGRESS-06: close button visible on draft pages', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await expect(
      closeButton,
      'Close button should be visible on draft pages'
    ).toBeVisible()
  })

  test('V-REGRESS-06-S1: close button visible on workbench', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const closeButton = page.locator('[data-testid="toolbar-close-button"]')
    await expect(
      closeButton,
      'Close button should be visible on workbench'
    ).toBeVisible()
  })

  // ===========================================================================
  // V-REGRESS-07: Reset button always visible (disabled when inactive)
  // ===========================================================================

  test('V-REGRESS-07: reset button always visible', async ({ page }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const resetButton = page.locator('[data-testid="breadcrumb-reset-link"]')
    await expect(
      resetButton,
      'Reset button should always be visible'
    ).toBeVisible()
  })

  test('V-REGRESS-07-S1: reset button disabled when status is idle', async ({
    page,
  }) => {
    await page.goto('/tests/new')
    await waitForCanvasLoad(page)

    const resetButton = page.locator('[data-testid="breadcrumb-reset-link"]')
    await expect(resetButton).toBeVisible()

    // Check disabled attribute
    await expect(
      resetButton,
      'Reset button should be disabled when status is idle'
    ).toBeDisabled()
  })

  // ===========================================================================
  // V-REGRESS-09: Variable manager panel content stays within panel bounds
  // The min-w-0 on the ResizablePanel inner div keeps panel content (filter, sort,
  // Add button) inside a narrow panel.
  // ===========================================================================

  test('V-REGRESS-09: variable manager content stays within panel bounds', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Expand variable manager panel
    const panel = page.locator('[data-testid="variable-manager"]')
    const state = await panel.getAttribute('data-state')
    if (state === 'collapsed') {
      const expandButton = panel.locator('button[aria-label="Expand Variable Manager"]')
      await expandButton.click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }

    // Get the variable manager panel's bounding box
    const panelBox = await panel.boundingBox()
    expect(panelBox, 'Variable manager panel should have a bounding box').toBeTruthy()

    // The filter input should be fully within the panel bounds
    const filterInput = page.locator(
      '[data-testid="variable-manager-content"] input[aria-label="Filter variables"]'
    )
    await expect(filterInput).toBeVisible()
    const filterBox = await filterInput.boundingBox()
    expect(filterBox, 'Filter input should have a bounding box').toBeTruthy()

    // Filter input right edge must not exceed panel right edge
    expect(
      filterBox!.x + filterBox!.width,
      'Filter input right edge should be within panel bounds'
    ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)

    // Sort dropdown trigger sits in the toolbar with the filter input.
    const sortTrigger = page.locator(
      '[data-testid="variable-manager-content"]'
    ).getByRole('combobox', { name: /sort/i })
    await expect(sortTrigger).toBeVisible()
    const sortBox = await sortTrigger.boundingBox()
    expect(sortBox, 'Sort dropdown should have a bounding box').toBeTruthy()
    expect(
      sortBox!.x + sortBox!.width,
      'Sort dropdown right edge should be within panel bounds'
    ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)

    // Add button should be visible and within bounds
    const addButton = page.locator('[data-testid="add-variable-button"]')
    await expect(addButton).toBeVisible()
    const addButtonBox = await addButton.boundingBox()
    expect(addButtonBox, 'Add button should have a bounding box').toBeTruthy()

    expect(
      addButtonBox!.x + addButtonBox!.width,
      'Add button right edge should be within panel bounds'
    ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)
  })
})
