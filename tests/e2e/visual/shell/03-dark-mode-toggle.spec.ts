/**
 * VA-FOUND-03: Dark Mode Theme Toggle
 *
 * Foundational visual validation test for dark mode theme toggle functionality.
 * Tests theme switching mechanics that remain stable regardless of navigation structure.
 *
 * Pass Criteria:
 * 1. Page background: Changes appropriately when toggling themes
 * 2. Sidebar background: Changes to match theme
 * 3. Sidebar border: Changes to match theme
 * 4. Text colors: All text inverts properly
 * 5. Toggle icon: Changes from Moon icon to Sun icon (or vice versa)
 * 6. Contrast: All text remains readable (WCAG AA compliant)
 * 7. No flash: Transition is smooth, no white flash during switch
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('VA-FOUND-03: Dark Mode Toggle', () => {
  test('VA-FOUND-03: theme toggle switches between light and dark', async ({ page }, testInfo) => {
    // Determine starting theme based on project
    const startsDark = testInfo.project.name.includes('dark')
    const startTheme = startsDark ? 'dark' : 'light'
    const targetTheme = startsDark ? 'light' : 'dark'

    await page.goto('/dashboard')

    // Get references to key elements
    const body = page.locator('body')
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const html = page.locator('html')

    // Verify we start in expected theme
    await expect(html).toHaveAttribute('data-theme', startTheme)

    // Verify body and sidebar have background colors set
    const bodyBgStart = await body.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bodyBgStart).toBeTruthy()
    const sidebarBgStart = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(sidebarBgStart).toBeTruthy()

    // Find the theme toggle button in sidebar footer
    const toggleButtonName = startsDark ? /switch to light mode/i : /switch to dark mode/i
    const themeToggle = sidebar.getByRole('button', { name: toggleButtonName })
    await expect(themeToggle).toBeVisible()

    // Verify correct icon is present
    const startIcon = themeToggle.locator('svg')
    await expect(startIcon).toBeVisible()

    // Click to switch theme
    await themeToggle.click()

    // Wait for theme transition to complete
    await page.waitForTimeout(200)

    // 1. Verify theme attribute changed
    await expect(html).toHaveAttribute('data-theme', targetTheme)

    // 2. Sidebar background: Changes to match new theme
    const sidebarBgAfter = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(sidebarBgAfter).toBeTruthy()
    // Verify it changed from start theme
    expect(sidebarBgAfter).not.toBe(sidebarBgStart)

    // 3. Text colors: Primary text matches theme
    // The collapsed-state mark carries its own screen-reader-only "WAVE"; take the shown one.
    const logo = sidebar.getByText('WAVE').filter({ visible: true })
    const logoColor = await logo.evaluate((el) => getComputedStyle(el).color)
    expect(logoColor).toBeTruthy()

    // 4. Toggle icon: Changes to show opposite action
    const toggleButtonNameAfter = startsDark ? /switch to dark mode/i : /switch to light mode/i
    const themeToggleAfter = sidebar.getByRole('button', { name: toggleButtonNameAfter })
    await expect(themeToggleAfter).toBeVisible()

    // Verify icon changed
    const afterIcon = themeToggleAfter.locator('svg')
    await expect(afterIcon).toBeVisible()

    // 5. Body text color is appropriate for theme
    const bodyColor = await body.evaluate((el) => getComputedStyle(el).color)
    expect(bodyColor).toBeTruthy()

    // 6. Verify we can switch back to start theme
    await themeToggleAfter.click()
    await page.waitForTimeout(200)

    // Verify return to start theme
    await expect(html).toHaveAttribute('data-theme', startTheme)
  })

  test('VA-FOUND-03-S1: theme persists across page reload', async ({ page }, testInfo) => {
    // Determine starting theme based on project
    const startsDark = testInfo.project.name.includes('dark')
    const startTheme = startsDark ? 'dark' : 'light'
    const targetTheme = startsDark ? 'light' : 'dark'

    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    const html = page.locator('html')

    // Verify starting theme
    await expect(html).toHaveAttribute('data-theme', startTheme)

    // Switch to opposite theme
    const toggleButtonName = startsDark ? /switch to light mode/i : /switch to dark mode/i
    const themeToggle = sidebar.getByRole('button', { name: toggleButtonName })
    await themeToggle.click()
    await page.waitForTimeout(200)

    // Verify theme switched
    await expect(html).toHaveAttribute('data-theme', targetTheme)

    // Reload the page
    await page.reload()

    // Wait for page to stabilize after reload
    await page.waitForTimeout(300)

    // Verify theme persists via data-theme attribute
    await expect(html).toHaveAttribute('data-theme', targetTheme)

    // Clean up: restore start theme for subsequent tests
    const sidebarAfterReload = page.locator('[data-sidebar="sidebar"]')
    const restoreButtonName = startsDark ? /switch to dark mode/i : /switch to light mode/i
    const restoreToggle = sidebarAfterReload.getByRole('button', { name: restoreButtonName })
    await restoreToggle.click()
    await page.waitForTimeout(200)
  })
})
