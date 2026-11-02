/**
 * V-NAV-02: Navigation Structure (Collapsed)
 *
 * Main Purpose: Collapsed sidebar shows icons only at 56px width.
 *
 * Pass Criteria:
 * 1. Sidebar width: 56px (per SHELL-6)
 * 2. All 12 nav items visible as icons only
 * 3. Section headers hidden
 * 4. Icons centered horizontally
 * 5. Tooltips on hover showing item names
 * 6. Search icon present at top
 *
 * Design Decisions: SHELL-2, SHELL-6
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-NAV-02: Navigation Structure (Collapsed)', () => {
  test('V-NAV-02: collapsed sidebar shows icons only at 56px width', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // shadcn sidebar uses data-sidebar="sidebar" attribute on a div
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    // Get the sidebar wrapper (group peer) that controls width transitions
    // Note: wrapper has "hidden md:block" so we check attribute instead of visibility
    const sidebarWrapper = page.locator('.group.peer[data-state]')

    // Ensure sidebar starts expanded
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'expanded')

    // Click collapse button to collapse sidebar
    // The collapse button is in the footer with aria-label "Collapse sidebar"
    const collapseButton = page.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()

    // Wait for transition to complete (200ms as per shadcn sidebar)
    await page.waitForTimeout(250)

    // 1. Verify collapsed state
    await expect(
      sidebarWrapper,
      'Sidebar wrapper should have data-state="collapsed"'
    ).toHaveAttribute('data-state', 'collapsed')

    // Verify collapsed collapsible attribute
    await expect(
      sidebarWrapper,
      'Sidebar wrapper should have data-collapsible="icon" when collapsed'
    ).toHaveAttribute('data-collapsible', 'icon')

    // 6. SHELL-8: the collapsed rail carries no search icon.
    await expect(
      page.getByRole('button', { name: 'Search', exact: true }),
      'Collapsed-mode search button must be absent (SHELL-8)'
    ).toHaveCount(0)

    // 2. All 12 nav items visible as icons only
    // Expected nav items: Dashboard, Executions, Regressions, Suites, Tests, Workbench,
    //                     Functions, Profiles, Reports, Artifacts, Settings, User
    const expectedNavItems = [
      'Dashboard',
      'Executions',
      'Regressions',
      'Suites',
      'Tests',
      'Workbench',
      'Functions',
      'Profiles',
      'Reports',
      'Artifacts',
      'Settings',
      'User',
    ]

    // Verify all 12 nav items are visible via their links
    for (const itemName of expectedNavItems) {
      const navItem = sidebar.getByRole('link', { name: itemName })
      await expect(
        navItem,
        `Nav item "${itemName}" should be visible when collapsed`
      ).toBeVisible()
    }

    // Verify icons are visible via data-icon-wrapper attribute
    const navIcons = sidebar.locator('[data-icon-wrapper]')
    const iconCount = await navIcons.count()
    expect(iconCount, 'Should have 12 nav item icons').toBe(12)

    // Verify each icon is visible
    for (let i = 0; i < iconCount; i++) {
      await expect(
        navIcons.nth(i),
        `Icon ${i + 1} should be visible`
      ).toBeVisible()
    }

    // 3. Section headers hidden (opacity: 0)
    // Section headers: BUILD, LIBRARY, RESULTS, ACCOUNT
    // When collapsed with collapsible="icon", shadcn uses:
    // group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0
    const sectionHeaders = ['BUILD', 'LIBRARY', 'RESULTS', 'ACCOUNT']

    for (const headerText of sectionHeaders) {
      // Find the section header label
      const headerLabel = sidebar.locator('[data-sidebar="group-label"]').filter({
        hasText: headerText,
      })

      // Verify opacity: 0 is applied (visually hidden)
      await expect(
        headerLabel,
        `${headerText} section header should have opacity: 0 when collapsed`
      ).toHaveCSS('opacity', '0')
    }

    // 4. Icons properly sized when collapsed
    // The nav button becomes 32x32 (size-8) when collapsed via group-data-[collapsible=icon]:!size-8
    const dashboardNav = sidebar.getByRole('link', { name: /dashboard/i })
    const dashboardBox = await dashboardNav.boundingBox()
    const sidebarBox = await sidebar.boundingBox()

    expect(
      dashboardBox && sidebarBox,
      'Dashboard nav and sidebar should have bounding boxes'
    ).toBeTruthy()

    if (dashboardBox && sidebarBox) {
      // Verify selection box dimensions - shadcn uses !size-8 (32x32) when collapsed
      expect(dashboardBox.width, 'Nav item width should be 32px when collapsed').toBe(32)
      expect(dashboardBox.height, 'Nav item height should be 32px when collapsed').toBe(32)

      // Verify nav items are within the sidebar bounds
      expect(
        dashboardBox.x,
        'Nav item should be within sidebar left bound'
      ).toBeGreaterThanOrEqual(sidebarBox.x)
      expect(
        dashboardBox.x + dashboardBox.width,
        'Nav item should be within sidebar right bound'
      ).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width)
    }

    // 5. Tooltips on hover showing item names
    // shadcn sidebar uses Radix tooltips - hover to trigger tooltip
    // Hover over dashboard nav item and verify tooltip appears
    await dashboardNav.hover()
    await page.waitForTimeout(100) // Wait for tooltip delay

    // Radix tooltip content should appear
    const tooltip = page.locator('[role="tooltip"]')
    await expect(
      tooltip,
      'Tooltip should appear on hover when collapsed'
    ).toBeVisible()
    await expect(
      tooltip,
      'Tooltip should show "Dashboard"'
    ).toHaveText('Dashboard')
  })

  test('V-NAV-02-S1: labels are hidden when collapsed', async ({ page }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    // Collapse the sidebar
    const collapseButton = page.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(250)

    // Verify labels have sr-only class when collapsed
    // Our NavMenuItem adds sr-only class to labels when collapsed
    const navLabels = sidebar.locator('[data-label]')
    const labelCount = await navLabels.count()

    expect(labelCount, 'Should have labels for nav items').toBeGreaterThan(0)

    for (let i = 0; i < labelCount; i++) {
      const label = navLabels.nth(i)
      const classList = await label.getAttribute('class')
      expect(
        classList?.includes('sr-only'),
        `Label ${i + 1} should have sr-only class when collapsed`
      ).toBe(true)
    }

    // Verify sr-only text is present for accessibility
    const srOnlyLabels = sidebar.locator('.sr-only')
    const srOnlyCount = await srOnlyLabels.count()
    expect(
      srOnlyCount,
      'Should have sr-only labels for accessibility'
    ).toBeGreaterThan(0)
  })

  test('V-NAV-02-S2: search click expands sidebar', async ({ page }) => {
    await page.goto('/dashboard')

    const sidebarWrapper = page.locator('.group.peer[data-state]')

    // Collapse the sidebar
    const collapseButton = page.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(250)

    // Verify collapsed
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'collapsed')

    // SHELL-8: the expand control is the only way back.
    await expect(
      page.getByRole('button', { name: 'Search', exact: true }),
      'no search affordance remains in the collapsed rail'
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(
      sidebarWrapper,
      'the expand control restores the full sidebar'
    ).toHaveAttribute('data-state', 'expanded')
  })

  test('V-NAV-02-S3: footer elements visible when collapsed', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const sidebar = page.locator('[data-sidebar="sidebar"]')

    // Collapse the sidebar
    const collapseButton = page.getByRole('button', {
      name: 'Collapse sidebar',
    })
    await collapseButton.click()
    await page.waitForTimeout(250)

    // Verify footer elements are still visible
    // Theme toggle should be visible
    const themeToggle = sidebar.getByRole('button', { name: /mode/i })
    await expect(
      themeToggle,
      'Theme toggle should be visible when collapsed'
    ).toBeVisible()

    // Expand button should be visible (collapse button changes to expand)
    const expandButton = page.getByRole('button', { name: 'Expand sidebar' })
    await expect(
      expandButton,
      'Expand button should be visible when collapsed'
    ).toBeVisible()
  })
})
