/**
 * V-NAV-01: Navigation Structure (Expanded)
 *
 * Main Purpose: Sidebar shows complete navigation structure with 4 sections and 12 items.
 *
 * Pass Criteria:
 * 1. No search field between the brand and the first nav item (SHELL-8)
 * 2. Top-level items: Dashboard, Executions (in order)
 * 3. BUILD section header with: Regressions, Suites, Tests, Workbench
 * 4. LIBRARY section header with: Functions, Profiles
 * 5. RESULTS section header with: Reports, Artifacts
 * 6. ACCOUNT section header with: Settings, User
 * 7. Footer: Theme toggle (left), Collapse button (right)
 * 8. Sidebar width: 240px expanded
 *
 * Design Decisions: SHELL-1, SHELL-3, SHELL-4, SHELL-6
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-NAV-01: Navigation Structure (Expanded)', () => {
  test('V-NAV-01: sidebar shows complete navigation structure', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // shadcn sidebar uses data-sidebar="sidebar" attribute on a div
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    // Verify sidebar is in expanded state
    const sidebarWrapper = page.locator('.group.peer[data-state]')
    await expect(sidebarWrapper).toHaveAttribute('data-state', 'expanded')

    // 1. SHELL-8: the search field is gone. Assert the absence explicitly -
    // a nav-item count would pass for the wrong reason.
    await expect(
      sidebar.locator('input[type="search"], [role="search"]'),
      'the sidebar search field is deleted'
    ).toHaveCount(0)
    await expect(
      sidebar.locator('kbd'),
      'its Ctrl+K badge goes with it'
    ).toHaveCount(0)

    // 2. Top-level items: Dashboard, Executions (in order)
    // These should be the FIRST two navigation items before any section headers
    const dashboardNav = sidebar.getByRole('link', { name: /dashboard/i })
    const executionsNav = sidebar.getByRole('link', { name: /executions/i })

    await expect(
      dashboardNav,
      'Dashboard nav item should be visible'
    ).toBeVisible()
    await expect(
      executionsNav,
      'Executions nav item should be visible'
    ).toBeVisible()

    // Verify Dashboard comes before Executions
    const dashboardBox = await dashboardNav.boundingBox()
    const executionsBox = await executionsNav.boundingBox()
    expect(
      dashboardBox && executionsBox && dashboardBox.y < executionsBox.y,
      'Dashboard should appear before Executions'
    ).toBe(true)

    // 3. BUILD section header with: Regressions, Suites, Tests, Workbench
    const buildSection = sidebar.getByText('BUILD', { exact: true })
    await expect(
      buildSection,
      'BUILD section header should be visible'
    ).toBeVisible()

    const regressionsNav = sidebar.getByRole('link', { name: /regressions/i })
    const suitesNav = sidebar.getByRole('link', { name: /suites/i })
    const testsNav = sidebar.getByRole('link', { name: /tests/i })
    const workbenchNav = sidebar.getByRole('link', { name: /workbench/i })

    await expect(
      regressionsNav,
      'Regressions nav item should be visible'
    ).toBeVisible()
    await expect(suitesNav, 'Suites nav item should be visible').toBeVisible()
    await expect(testsNav, 'Tests nav item should be visible').toBeVisible()
    await expect(
      workbenchNav,
      'Workbench nav item should be visible'
    ).toBeVisible()

    // 4. LIBRARY section header with: Functions, Profiles
    const librarySection = sidebar.getByText('LIBRARY', { exact: true })
    await expect(
      librarySection,
      'LIBRARY section header should be visible'
    ).toBeVisible()

    const functionsNav = sidebar.getByRole('link', { name: /functions/i })
    const profilesNav = sidebar.getByRole('link', { name: /profiles/i })

    await expect(
      functionsNav,
      'Functions nav item should be visible'
    ).toBeVisible()
    await expect(
      profilesNav,
      'Profiles nav item should be visible'
    ).toBeVisible()
    await expect(
      sidebar.getByRole('link', { name: /plugins/i }),
      'Plugins nav item should not be present'
    ).toHaveCount(0)

    // 5. RESULTS section header with: Reports, Artifacts
    const resultsSection = sidebar.getByText('RESULTS', { exact: true })
    await expect(
      resultsSection,
      'RESULTS section header should be visible'
    ).toBeVisible()

    const reportsNav = sidebar.getByRole('link', { name: /reports/i })
    const artifactsNav = sidebar.getByRole('link', { name: /artifacts/i })

    await expect(
      reportsNav,
      'Reports nav item should be visible'
    ).toBeVisible()
    await expect(
      artifactsNav,
      'Artifacts nav item should be visible'
    ).toBeVisible()

    // 6. ACCOUNT section header with: Settings, User
    const accountSection = sidebar.getByText('ACCOUNT', { exact: true })
    await expect(
      accountSection,
      'ACCOUNT section header should be visible'
    ).toBeVisible()

    const settingsNav = sidebar.getByRole('link', { name: /settings/i })
    const userNav = sidebar.getByRole('link', { name: /user/i })

    await expect(
      settingsNav,
      'Settings nav item should be visible'
    ).toBeVisible()
    await expect(userNav, 'User nav item should be visible').toBeVisible()

    // 7. Footer: Theme toggle (left), Collapse button (right)
    const themeToggle = sidebar.getByRole('button', { name: /mode/i })
    const collapseButton = sidebar.getByRole('button', { name: /sidebar/i })

    await expect(themeToggle, 'Theme toggle should be visible').toBeVisible()
    await expect(
      collapseButton,
      'Collapse button should be visible'
    ).toBeVisible()

    // Verify theme toggle is on the left, collapse button is on the right
    const themeBox = await themeToggle.boundingBox()
    const collapseBox = await collapseButton.boundingBox()
    expect(
      themeBox && collapseBox && themeBox.x < collapseBox.x,
      'Theme toggle should be positioned to the left of collapse button'
    ).toBe(true)
  })

  test('V-NAV-01-S1: verify navigation item vertical ordering', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // shadcn sidebar uses data-sidebar="sidebar" attribute on a div
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    // Expected order from top to bottom (SHELL-8: no search field, so focus
    // runs brand -> first nav item):
    // 1. Dashboard
    // 2. Executions
    // 3. BUILD section (Regressions, Suites, Tests, Workbench)
    // 4. LIBRARY section (Functions, Profiles)
    // 5. RESULTS section (Reports, Artifacts)
    // 6. ACCOUNT section (Settings, User)
    // 7. Footer (Theme toggle, Collapse button)

    // First, verify all elements exist (fail fast if any are missing)
    const dashboardNav = sidebar.getByRole('link', { name: /dashboard/i })
    const executionsNav = sidebar.getByRole('link', { name: /executions/i })
    const buildSection = sidebar.getByText('BUILD', { exact: true })
    const librarySection = sidebar.getByText('LIBRARY', { exact: true })
    const resultsSection = sidebar.getByText('RESULTS', { exact: true })
    const accountSection = sidebar.getByText('ACCOUNT', { exact: true })

    // Fail fast if any element is missing
    await expect(
      sidebar.locator('input[type="search"], [role="search"]'),
      'Search field must NOT exist (SHELL-8)'
    ).toHaveCount(0)
    await expect(dashboardNav, 'Dashboard nav must exist').toBeVisible()
    await expect(executionsNav, 'Executions nav must exist').toBeVisible()
    await expect(buildSection, 'BUILD section must exist').toBeVisible()
    await expect(librarySection, 'LIBRARY section must exist').toBeVisible()
    await expect(resultsSection, 'RESULTS section must exist').toBeVisible()
    await expect(accountSection, 'ACCOUNT section must exist').toBeVisible()

    // Get bounding boxes to verify vertical order
    const dashboardY = (await dashboardNav.boundingBox())?.y ?? -1
    const executionsY = (await executionsNav.boundingBox())?.y ?? -1
    const buildY = (await buildSection.boundingBox())?.y ?? -1
    const libraryY = (await librarySection.boundingBox())?.y ?? -1
    const resultsY = (await resultsSection.boundingBox())?.y ?? -1
    const accountY = (await accountSection.boundingBox())?.y ?? -1

    // Verify vertical ordering
    expect(
      dashboardY,
      'Dashboard should be above Executions'
    ).toBeLessThan(executionsY)
    expect(
      executionsY,
      'Executions should be above BUILD section'
    ).toBeLessThan(buildY)
    expect(
      buildY,
      'BUILD section should be above LIBRARY section'
    ).toBeLessThan(libraryY)
    expect(
      libraryY,
      'LIBRARY section should be above RESULTS section'
    ).toBeLessThan(resultsY)
    expect(
      resultsY,
      'RESULTS section should be above ACCOUNT section'
    ).toBeLessThan(accountY)
  })
})
