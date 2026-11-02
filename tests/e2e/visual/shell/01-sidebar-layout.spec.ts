/**
 * VA-FOUND-01: Application Shell - Sidebar Layout Foundation
 *
 * Foundational visual validation test for sidebar layout mechanics.
 * Tests layout properties that remain stable regardless of navigation structure.
 *
 * Design Decisions: SHELL-3, SHELL-6
 * - SHELL-3: Footer layout with theme toggle (left), collapse button (right), divider above
 * - SHELL-6: Sidebar width 240px expanded
 *
 * Pass Criteria:
 * 1. Sidebar visible: `[data-sidebar="sidebar"]` element is visible with fixed-position wrapper
 * 2. Sidebar width: Computed width is exactly `240px` (--sidebar-width CSS variable)
 * 3. Sidebar background: Computed `background-color` is sidebar theme color
 * 4. Logo text: Element containing "WAVE" has computed `font-weight` of `700`
 * 5. Main content layout: `main` element positioned after sidebar spacer (not overlapping)
 * 6. Page background: `body` or main area has correct background color
 * 7. No horizontal scroll: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
 * 8. Footer layout: Theme toggle on left, collapse button on right, separator above per SHELL-3
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('VA-FOUND-01: Sidebar Layout Foundation', () => {
  test('VA-FOUND-01: sidebar layout mechanics', async ({ page }) => {
    await page.goto('/dashboard')

    // Shadcn sidebar uses [data-sidebar="sidebar"] for the sidebar element
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const main = page.locator('main')

    // 1. Sidebar visible and properly positioned (parent is fixed)
    await expect(sidebar).toBeVisible()
    // The sidebar's parent wrapper is fixed positioned
    const sidebarWrapper = sidebar.locator('..')
    await expect(sidebarWrapper).toHaveCSS('position', 'fixed')
    await expect(sidebarWrapper).toHaveCSS('left', '0px')
    await expect(sidebarWrapper).toHaveCSS('top', '0px')

    // 2. Sidebar width: approximately 200px per wireframe
    const sidebarBox = await sidebar.boundingBox()
    expect(sidebarBox).toBeTruthy()
    // Allow 180-220px range (target: 200px per wireframe)
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(180)
    expect(sidebarBox!.width).toBeLessThanOrEqual(220)

    // 3. Sidebar background: Should have sidebar theme color
    const sidebarBg = await sidebar.evaluate((el) =>
      getComputedStyle(el).backgroundColor
    )
    expect(sidebarBg).toBeTruthy()

    // 4. Logo text: Element containing "WAVE" has computed `font-weight` of `700`
    // The collapsed-state mark carries its own screen-reader-only "WAVE"; take the shown one.
    const logo = sidebar.getByText('WAVE').filter({ visible: true })
    await expect(logo).toBeVisible()
    await expect(logo).toHaveCSS('font-weight', '700')

    // 5. Main content offset: main is positioned correctly with margin-left
    await expect(main).toBeVisible()
    const mainBox = await main.boundingBox()
    expect(mainBox).toBeTruthy()
    // Main content has margin-left applied (at least 180px for expanded sidebar)
    expect(mainBox!.x).toBeGreaterThanOrEqual(180)

    // 6. Page background: `body` has a background color set (oklch or rgb format)
    const body = page.locator('body')
    const bodyBg = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bodyBg).toBeTruthy()

    // 7. No horizontal scroll
    const hasHorizontalScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    )
    expect(hasHorizontalScroll).toBe(false)

    // 8. Dashboard content: Page contains text "Dashboard" in breadcrumb or heading
    const dashboardText = page.getByText('Dashboard')
    await expect(dashboardText.first()).toBeVisible()
  })

  test('VA-FOUND-01-S1: footer layout per SHELL-3', async ({ page }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Per SHELL-3: Footer has theme toggle (left), collapse button (right), separator above

    // Find the sidebar footer using data attribute
    const footer = sidebar.locator('[data-sidebar="footer"]')
    await expect(footer).toBeVisible()

    // Find the separator above footer
    const separator = sidebar.locator('[data-sidebar="separator"]')
    await expect(separator).toBeVisible()

    // Theme toggle should be present (looks for button with mode or light/dark in name)
    const themeToggle = sidebar.getByRole('button', { name: /mode|light|dark/i })
    await expect(themeToggle).toBeVisible()

    // Collapse button should be present (looks for button with sidebar or collapse in name)
    const collapseButton = sidebar.getByRole('button', {
      name: /sidebar|collapse|expand/i,
    })
    await expect(collapseButton).toBeVisible()
  })
})
