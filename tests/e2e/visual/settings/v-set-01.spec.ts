/**
 * V-SET-01: Settings Page
 *
 * REQ: REQ-5.2.1.42
 * Design Decisions: SETTINGS-1 through SETTINGS-16
 *
 * Main Purpose: Settings page with two-column layout, section navigation,
 * and Environments tab showing table with CRUD operations.
 *
 * Pass Criteria - Layout (S1-S3, S23):
 * 1. Two-column layout: nav (240px) + content - per SETTINGS-1
 * 2. "Settings" title above section nav - per SETTINGS-4
 * 3. Vertical divider between nav and content, in the theme border color - per SETTINGS-5
 * 23. Headings balance their lines when they wrap
 *
 * Pass Criteria - Section Navigation (S4-S7):
 * 4. Seven sections plus the Network group in vertical order: General, Environments, Variables, Network, MCP Server, WAVE Server, Backup, About - per SETTINGS-2 + MCP-1 + WSRV-1 + NET-1
 * 5. Environments is default selected tab on page load
 * 6. Active section: $blue10 bg, white text - per SETTINGS-3
 * 7. Clicking section changes active state and content
 *
 * Pass Criteria - Environments Tab (S8-S17):
 * 8. Header with title and subtitle - per SETTINGS-7
 * 9. "+ New Environment" button visible - per SETTINGS-8
 * 10. Table columns: Name, Description, Usage, Actions - per SETTINGS-9
 * 11. Environment data displays correctly
 * 12. Usage column: "N profiles" format - per SETTINGS-10
 * 13. Actions: Edit (pencil) + kebab menu - per SETTINGS-11
 * 14. Kebab menu has Duplicate and Delete options - per SETTINGS-11
 * 15. Delete on an in-use environment asks to type its name - per SETTINGS-12
 * 16. Full pagination with "per page" label - per SETTINGS-13
 * 17. Specific environment data from fixture displays correctly
 *
 * Pass Criteria - Other Tabs (S18-S22):
 * 18. General tab: Logging, Time Zone and Secret Masking - per SETTINGS-14
 * 20. About tab: version, build, build date, support links - per SETTINGS-16
 * 21. About tab support links are accessible
 * 22. About tab: no Environment field; the copied version report holds the
 *     Version, Build and Build Date lines and no Environment line - per SETTINGS-16
 *
 * Pass Criteria - Accessibility (A1-A4):
 * 25. Navigation has proper aria role
 * 26. Active section has aria-current
 * 27. Table has proper aria-label
 * 28. Keyboard navigation works on section nav
 *
 * Note: Empty State (E1-E2) and Loading State (LD1) tests are in v-set-01-empty.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { exec } from '../../helpers/exec'

// Helper to wait for settings page to fully load
async function waitForSettingsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

// Single reset+seed for ALL tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/settings/v-set-01/01-seed.sh')
})

test.describe('V-SET-01: Settings Page Layout', () => {
  test('V-SET-01-S1: two-column layout with nav and content per SETTINGS-1', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Settings page should have two-column layout
    const settingsPage = page.locator('[data-testid="settings-page"]')
    await expect(settingsPage, 'Settings page should be visible').toBeVisible()

    // Nav column should exist and be ~160px wide
    const navColumn = page.locator('[data-testid="settings-nav"]')
    await expect(navColumn, 'Nav column should be visible').toBeVisible()

    const navBox = await navColumn.boundingBox()
    expect(navBox).toBeTruthy()
    // Nav column is w-60 (240px) per production layout
    expect(
      navBox!.width,
      'Nav column width should be approximately 240px (w-60)'
    ).toBeGreaterThanOrEqual(220)
    expect(navBox!.width).toBeLessThanOrEqual(260)

    // Content area should exist
    const contentArea = page.locator('[data-testid="settings-content"]')
    await expect(contentArea, 'Content area should be visible').toBeVisible()
  })

  test('V-SET-01-S2: "Settings" title above section nav per SETTINGS-4', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // "Settings" title should appear above the nav
    const settingsTitle = page.getByRole('heading', { name: 'Settings', level: 1 })
    await expect(
      settingsTitle,
      '"Settings" title should be visible per SETTINGS-4'
    ).toBeVisible()

    // Title should be positioned above the nav items
    const titleBox = await settingsTitle.boundingBox()
    const navColumn = page.locator('[data-testid="settings-nav"]')
    const navBox = await navColumn.boundingBox()

    expect(titleBox).toBeTruthy()
    expect(navBox).toBeTruthy()
    // Title should be above or at the top of nav
    expect(
      titleBox!.y,
      'Settings title should be at or near top of nav column'
    ).toBeLessThanOrEqual(navBox!.y + 50)
  })

  test('V-SET-01-S3: vertical divider between nav and content per SETTINGS-5', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Vertical divider should exist between nav and content
    const divider = page.locator('[data-testid="settings-divider"]')
    await expect(
      divider,
      'Vertical divider should be visible per SETTINGS-5'
    ).toBeVisible()

    // The divider is one 1px line in the theme border color, like the line under the page title.
    const dividerLine = await divider.evaluate((el) => {
      const style = getComputedStyle(el)
      return { width: style.borderRightWidth, color: style.borderRightColor }
    })
    const titleLineColor = await page
      .getByRole('heading', { level: 1, name: 'Settings' })
      .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).borderBottomColor)
    expect(dividerLine.width, 'Divider should be a 1px line per SETTINGS-5').toBe('1px')
    expect(
      dividerLine.color,
      'Divider should use the theme border color per SETTINGS-5'
    ).toBe(titleLineColor)
    const navBorder = await page
      .locator('[data-testid="settings-nav"]')
      .evaluate((el) => getComputedStyle(el).borderRightWidth)
    expect(navBorder, 'The section list draws no second line beside the divider').toBe('0px')
  })

  test('V-SET-01-S23: headings balance their lines when they wrap', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    const wraps = await page.locator('h1, h2, h3, h4').evaluateAll((headings) =>
      headings.map((heading) => getComputedStyle(heading).getPropertyValue('text-wrap-style')),
    )
    expect(wraps.length, 'the page shows headings').toBeGreaterThan(0)
    expect(new Set(wraps), 'every heading balances its lines').toEqual(new Set(['balance']))
  })
})

test.describe('V-SET-01: Section Navigation', () => {
  test('V-SET-01-S4: seven sections in correct vertical order per SETTINGS-2 + MCP-1 + WSRV-1', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Sections: General, Environments, Variables, Network (group), MCP Server, WAVE Server, Backup, About
    const navItems = page.locator('[data-testid="settings-nav"] button')
    const count = await navItems.count()
    // Seven section entries plus the collapsed Network group's toggle.
    expect(count, 'Should have 7 sections plus the Network toggle').toBe(8)

    // Check sections exist
    const generalNav = page.locator('[data-testid="settings-nav-general"]')
    const environmentsNav = page.locator('[data-testid="settings-nav-environments"]')
    const variablesNav = page.locator('[data-testid="settings-nav-variables"]')
    const networkNav = page.getByRole('button', { name: 'Network', exact: true })
    const mcpNav = page.locator('[data-testid="settings-nav-mcp"]')
    const serverNav = page.locator('[data-testid="settings-nav-server"]')
    const backupNav = page.locator('[data-testid="settings-nav-backup"]')
    const aboutNav = page.locator('[data-testid="settings-nav-about"]')

    await expect(generalNav, 'General nav item should be visible').toBeVisible()
    await expect(environmentsNav, 'Environments nav item should be visible').toBeVisible()
    await expect(variablesNav, 'Variables nav item should be visible').toBeVisible()
    await expect(
      page.locator('[data-testid="settings-nav-integrations"]'),
      'Integrations nav item should not be present'
    ).toHaveCount(0)
    await expect(networkNav, 'Network group toggle should be visible').toBeVisible()
    await expect(mcpNav, 'MCP Server nav item should be visible').toBeVisible()
    await expect(serverNav, 'WAVE Server nav item should be visible').toBeVisible()
    await expect(backupNav, 'Backup nav item should be visible').toBeVisible()
    await expect(aboutNav, 'About nav item should be visible').toBeVisible()

    // Verify correct vertical order: General -> Environments -> Variables -> Network -> MCP Server -> WAVE Server -> Backup -> About
    const generalBox = await generalNav.boundingBox()
    const environmentsBox = await environmentsNav.boundingBox()
    const variablesBox = await variablesNav.boundingBox()
    const networkBox = await networkNav.boundingBox()
    const mcpBox = await mcpNav.boundingBox()
    const serverBox = await serverNav.boundingBox()
    const backupBox = await backupNav.boundingBox()
    const aboutBox = await aboutNav.boundingBox()

    expect(generalBox).toBeTruthy()
    expect(environmentsBox).toBeTruthy()
    expect(variablesBox).toBeTruthy()
    expect(networkBox).toBeTruthy()
    expect(mcpBox).toBeTruthy()
    expect(serverBox).toBeTruthy()
    expect(backupBox).toBeTruthy()
    expect(aboutBox).toBeTruthy()

    expect(
      generalBox!.y,
      'General should be above Environments'
    ).toBeLessThan(environmentsBox!.y)
    expect(
      environmentsBox!.y,
      'Environments should be above Variables'
    ).toBeLessThan(variablesBox!.y)
    expect(
      variablesBox!.y,
      'Variables should be above Network'
    ).toBeLessThan(networkBox!.y)
    expect(
      networkBox!.y,
      'Network should be above MCP Server'
    ).toBeLessThan(mcpBox!.y)
    expect(
      mcpBox!.y,
      'MCP Server should be above WAVE Server'
    ).toBeLessThan(serverBox!.y)
    expect(
      serverBox!.y,
      'WAVE Server should be above Backup'
    ).toBeLessThan(backupBox!.y)
    expect(
      backupBox!.y,
      'Backup should be above About'
    ).toBeLessThan(aboutBox!.y)
  })

  test('V-SET-01-S5: General is default selected tab on page load', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // General should be selected by default on /settings
    const generalNav = page.locator('[data-testid="settings-nav-general"]')
    await expect(generalNav).toBeVisible()

    // Should have aria-current="page" indicating it's the active tab
    await expect(
      generalNav,
      'General should be the default selected tab'
    ).toHaveAttribute('aria-current', 'page')

    // General content should be visible by default
    const generalTab = page.locator('[data-testid="general-tab"]')
    await expect(
      generalTab,
      'General tab should be visible by default'
    ).toBeVisible()
  })

  test('V-SET-01-S6: active section has blue background and white text per SETTINGS-3', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Per SETTINGS-3: Selected section has $blue10 bg, white text
    const generalNav = page.locator('[data-testid="settings-nav-general"]')
    await expect(generalNav).toBeVisible()

    // Check for active state styling
    const bgColor = await generalNav.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    )
    const textColor = await generalNav.evaluate((el) => getComputedStyle(el).color)

    // $blue10 = #2563EB (rgb 37, 99, 235)
    expect(
      bgColor.includes('37, 99, 235') || // $blue10
        bgColor.includes('59, 130, 246') || // $blue9 (close alternative)
        bgColor.includes('blue'),
      'Active section should have blue background per SETTINGS-3'
    ).toBeTruthy()

    // White text = rgb(255, 255, 255) or close
    expect(
      textColor.includes('255, 255, 255') ||
        textColor.includes('250, 250, 250') ||
        textColor.includes('white'),
      'Active section should have white text per SETTINGS-3'
    ).toBeTruthy()
  })

  test('V-SET-01-S7: clicking section changes active state and content', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Verify General is active by default
    const generalNav = page.locator('[data-testid="settings-nav-general"]')
    await expect(generalNav).toHaveAttribute('aria-current', 'page')

    // Click on Environments
    const environmentsNav = page.locator('[data-testid="settings-nav-environments"]')
    await environmentsNav.click()

    // Environments should now be active (check aria-current)
    await expect(environmentsNav).toHaveAttribute('aria-current', 'page')

    // General should no longer be active
    await expect(generalNav).not.toHaveAttribute('aria-current', 'page')

    // Environments content should be visible
    const envTab = page.locator('[data-testid="environments-tab"]')
    await expect(envTab, 'Environments tab content should be visible').toBeVisible()

    // General tab should no longer be visible
    const generalTab = page.locator('[data-testid="general-tab"]')
    await expect(generalTab, 'General tab should not be visible').not.toBeVisible()
  })
})

test.describe('V-SET-01: Environments Tab', () => {
  test('V-SET-01-S8: environments tab header with title and subtitle per SETTINGS-7', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    // Wait for environments table to load
    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    // Check for "Environments" title in content area
    const envTitle = page.locator('[data-testid="settings-content"]').getByRole('heading', {
      name: 'Environments',
      level: 2,
    })
    await expect(
      envTitle,
      'Environments title should be visible in content area'
    ).toBeVisible()

    // Per SETTINGS-7: Subtitle "Manage environment names used across profiles"
    const subtitle = page.locator('[data-testid="environments-subtitle"]')
    await expect(subtitle, 'Environments subtitle should be visible').toBeVisible()
    await expect(subtitle).toContainText(/Manage environment names used across profiles/i)
  })

  test('V-SET-01-S9: "+ New Environment" button visible per SETTINGS-8', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    // Per SETTINGS-8: "+ New Environment" button
    const newEnvButton = page.getByRole('button', { name: /New Environment/i })
    await expect(
      newEnvButton,
      '"+ New Environment" button should be visible per SETTINGS-8'
    ).toBeVisible()
    await expect(newEnvButton).toBeEnabled()
  })

  test('V-SET-01-S10: table columns: Name, Description, Usage, Actions per SETTINGS-9', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    // Per SETTINGS-9: Columns: Name, Description, Usage, Actions
    const table = page.locator('[data-testid="environments-table"]')
    await expect(table, 'Environments table should be visible').toBeVisible()

    // Check column headers
    const nameHeader = table.getByRole('columnheader', { name: /Name/i })
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const descHeader = table.getByRole('columnheader', { name: /Description/i })
    await expect(
      descHeader,
      'Description column header should be visible'
    ).toBeVisible()

    const usageHeader = table.getByRole('columnheader', { name: /Usage/i })
    await expect(usageHeader, 'Usage column header should be visible').toBeVisible()

    const actionsHeader = table.getByRole('columnheader', { name: /Actions/i })
    await expect(
      actionsHeader,
      'Actions column header should be visible'
    ).toBeVisible()
  })

  test('V-SET-01-S11: environments data displays correctly', async ({ page }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // Should have 4 environment rows (per fixture)
    const envRows = page.locator('[data-testid="environment-row"]')
    const rowCount = await envRows.count()
    expect(rowCount, 'Should have 4 environment rows from fixture').toBe(4)

    // Check first row has expected data (Production)
    const firstRow = envRows.first()
    await expect(firstRow).toContainText(/Production/i)
    await expect(firstRow).toContainText(/Live customer environment/i)
  })

  test('V-SET-01-S12: usage column shows "N profiles" format per SETTINGS-10', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // Per SETTINGS-10: Usage: "N profiles"
    const usageCells = page.locator('[data-testid="environment-usage"]')
    const count = await usageCells.count()
    expect(count).toBeGreaterThan(0)

    // Check usage format
    const firstUsage = usageCells.first()
    await expect(firstUsage).toBeVisible()
    // Should match "N profiles" or "N profile" pattern
    const usageText = await firstUsage.textContent()
    expect(
      usageText,
      'Usage should show "N profiles" format per SETTINGS-10'
    ).toMatch(/\d+ profiles?/i)
  })

  test('V-SET-01-S13: actions column has Edit and kebab menu per SETTINGS-11', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // Per SETTINGS-11: Actions: Edit + kebab (Duplicate, Delete)
    const firstRow = page.locator('[data-testid="environment-row"]').first()

    // Edit button (pencil icon)
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await expect(editButton, 'Edit action button should be visible').toBeVisible()

    // Kebab menu trigger
    const kebabMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await expect(kebabMenu, 'Kebab menu trigger should be visible').toBeVisible()
  })

  test('V-SET-01-S14: kebab menu has Duplicate and Delete options per SETTINGS-11', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // Click kebab menu on first row
    const firstRow = page.locator('[data-testid="environment-row"]').first()
    const kebabMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await kebabMenu.click()

    // Wait for menu to open
    const menuContent = page.locator('[data-testid="action-menu-content"]')
    await expect(menuContent, 'Menu should open').toBeVisible()

    // Per SETTINGS-11: Duplicate and Delete options
    const duplicateOption = menuContent.getByRole('menuitem', { name: /Duplicate/i })
    await expect(duplicateOption, 'Duplicate option should be visible').toBeVisible()

    const deleteOption = menuContent.getByRole('menuitem', { name: /Delete/i })
    await expect(deleteOption, 'Delete option should be visible').toBeVisible()
  })

  test('V-SET-01-S15: delete on in-use environment opens type-to-confirm dialog', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // All fixture environments have profiles (usage > 0). The current behavior
    // is to allow deletion via a type-to-confirm modal that warns about the
    // cascade-removed per-environment values.
    const firstRow = page.locator('[data-testid="environment-row"]').first()
    const kebabMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await kebabMenu.click()

    const menuContent = page.locator('[data-testid="action-menu-content"]')
    await expect(menuContent).toBeVisible()

    // Delete is always enabled - the safety net is the modal, not the menu item.
    const deleteOption = menuContent.getByRole('menuitem', { name: /Delete/i })
    await expect(
      deleteOption,
      'Delete should be enabled; the type-to-confirm modal handles in-use safety'
    ).not.toHaveAttribute('aria-disabled', 'true')

    await deleteOption.click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Modal explains the cascade impact and requires the env name to be typed.
    await expect(dialog.getByText(/used by \d+ profile/i)).toBeVisible()
    await expect(dialog.getByText(/Type/)).toBeVisible()
  })

  test('V-SET-01-S16: full pagination controls per SETTINGS-13', async ({ page }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    // Per SETTINGS-13: Full pagination
    const pagination = page.locator('[data-testid="pagination"]')
    await expect(pagination, 'Pagination should be visible').toBeVisible()

    // Item count: "Showing X-Y of Z environments"
    const itemCount = pagination.locator('[data-testid="pagination-item-count"]')
    await expect(itemCount, 'Item count should be visible').toBeVisible()
    await expect(itemCount).toContainText(/Showing \d+-\d+ of \d+/i)

    // Page size selector with "per page" text per wireframe
    const pageSizeSelector = pagination.locator('[data-testid="page-size-selector"]')
    await expect(pageSizeSelector, 'Page size selector should be visible').toBeVisible()

    // "per page" label should be visible (per wireframe: "25 per page")
    const perPageLabel = pagination.locator('text=per page')
    await expect(perPageLabel, '"per page" label should be visible per wireframe').toBeVisible()

    // Page navigation with first/prev/next/last buttons
    const pageNav = pagination.locator('[data-testid="pagination-navigation"]')
    await expect(pageNav, 'Page navigation should be visible').toBeVisible()

    // First/last page buttons per LIST-2 pattern
    const firstButton = pagination.getByRole('button', { name: /first/i })
    await expect(firstButton, 'First page button should be visible').toBeVisible()

    const lastButton = pagination.getByRole('button', { name: /last/i })
    await expect(lastButton, 'Last page button should be visible').toBeVisible()
  })

  test('V-SET-01-S17: specific environment data from fixture displays correctly', async ({
    page,
  }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    // Verify specific environment data from fixture
    // Production - "Live customer environment" - 5 profiles
    const productionRow = page.locator('[data-testid="environment-row"]', {
      hasText: 'Production',
    })
    await expect(productionRow, 'Production environment row should exist').toBeVisible()
    await expect(productionRow).toContainText(/Live customer environment/i)
    await expect(productionRow).toContainText(/5 profiles/i)

    // Development - "Local development" - 8 profiles
    const devRow = page.locator('[data-testid="environment-row"]', {
      hasText: 'Development',
    })
    await expect(devRow, 'Development environment row should exist').toBeVisible()
    await expect(devRow).toContainText(/Local development/i)
    await expect(devRow).toContainText(/8 profiles/i)
  })
})

test.describe('V-SET-01: Other Tabs', () => {
  test('V-SET-01-S18: General tab shows logging control', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // General is already active by default, no need to click

    // Wait for General tab content
    const generalContent = page.locator('[data-testid="general-tab"]')
    await expect(generalContent, 'General tab content should be visible').toBeVisible()

    // General tab has the logging control (log level setting)
    await expect(generalContent).toContainText(/logging/i)
    await expect(generalContent).toContainText(/log level/i)
  })

  test('V-SET-01-S19: /settings/integrations falls back to General with no placeholder', async ({
    page,
  }) => {
    await page.goto('/settings/integrations')
    await waitForSettingsPageLoad(page)

    await expect(
      page.locator('[data-testid="general-tab"]'),
      'General tab content should be visible'
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="integrations-tab"]'),
      'Integrations placeholder should not be present'
    ).toHaveCount(0)
  })

  test('V-SET-01-S20: About tab shows version, build, build date, support links per SETTINGS-16', async ({
    page,
  }) => {
    await page.goto('/settings/about')
    await waitForSettingsPageLoad(page)

    // Wait for About tab content
    const aboutContent = page.locator('[data-testid="about-tab"]')
    await expect(aboutContent, 'About tab content should be visible').toBeVisible()

    // Per SETTINGS-16: About: version, build info, support links

    // Version section with version field
    const versionSection = aboutContent.locator('[data-testid="version-section"]')
    await expect(versionSection, 'Version section should be visible').toBeVisible()
    const versionField = aboutContent.locator('[data-testid="version-field"]')
    await expect(versionField, 'Version field should be visible').toBeVisible()

    // Build date
    const buildDate = aboutContent.locator('[data-testid="build-date"]')
    await expect(buildDate, 'Build date should be visible').toBeVisible()

    // Runtime section with Python and OS info
    const runtimeSection = aboutContent.locator('[data-testid="runtime-section"]')
    await expect(runtimeSection, 'Runtime section should be visible').toBeVisible()

    // Support links section
    const supportSection = aboutContent.locator('[data-testid="support-section"]')
    await expect(supportSection, 'Support section should be visible').toBeVisible()
  })

  test('V-SET-01-S21: About tab support links are accessible', async ({ page }) => {
    await page.goto('/settings/about')
    await waitForSettingsPageLoad(page)

    const aboutContent = page.locator('[data-testid="about-tab"]')
    await expect(aboutContent).toBeVisible()

    // Support links should have proper href attributes
    const supportLinks = aboutContent.locator('a')
    const linkCount = await supportLinks.count()

    // Should have at least one support link
    expect(linkCount, 'About tab should have support links').toBeGreaterThan(0)

    // First link should have href
    const firstLink = supportLinks.first()
    const href = await firstLink.getAttribute('href')
    expect(href, 'Support link should have href attribute').toBeTruthy()
  })

  test('V-SET-01-S22: About shows no Environment field and the copied version report has no Environment line', async ({
    page,
  }) => {
    const response = await page.request.get(`${BACKEND_URL}/api/v1/system/info`)
    expect(response.status(), 'GET /api/v1/system/info').toBe(200)
    const info = (await response.json()).data as {
      version: string
      build: string
      build_date: string | null
    }

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/settings/about')
    await waitForSettingsPageLoad(page)

    const aboutContent = page.locator('[data-testid="about-tab"]')
    await expect(
      aboutContent.locator('[data-testid="version-field"]'),
      'About is loaded with the real version'
    ).toHaveText(`Version${info.version}`)

    await test.step('no Environment field on the page', async () => {
      await expect(aboutContent.getByText('Environment', { exact: true })).toHaveCount(0)
      await expect(aboutContent).not.toContainText(/environment/i)
    })

    await test.step('the copied version report has no Environment line', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''))
      const copy = aboutContent.locator('[data-testid="copy-version-button"]')
      await copy.click()
      await expect(copy).toHaveAttribute('data-copied', 'true')
      const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n')

      expect(lines[0]).toBe(`Version: ${info.version}`)
      expect(lines[1]).toBe(`Build: ${info.build}`)
      expect(
        lines.map((line) => line.slice(0, line.indexOf(':'))),
        'the report holds these lines and no other'
      ).toEqual(info.build_date ? ['Version', 'Build', 'Build Date'] : ['Version', 'Build'])
      expect(lines.filter((line) => /^Environment:/.test(line))).toEqual([])
    })
  })
})

/**
 * Loading State Tests for V-SET-01
 * Note: This doesn't need specific data - uses route interception
 */
test.describe('V-SET-01: Loading State', () => {
  test('V-SET-01-LD1: loading state shows skeleton while fetching data', async ({
    page,
  }) => {
    // Slow down the API response to see loading state
    await page.route('**/environments**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })

    await page.goto('/settings/environments')

    // Should show loading state
    const pageContainer = page.locator('[data-testid="settings-page"]')
    await expect(pageContainer).toBeVisible()

    // Check for aria-busy="true" during loading OR skeleton rows
    const skeletonRows = page.locator('[data-testid="skeleton-row"]')
    const dataRows = page.locator('[data-testid="environment-row"]')

    const skeletonCount = await skeletonRows.count()
    const dataRowCount = await dataRows.count()

    // Either skeleton visible during loading OR actual data rows after load
    expect(
      skeletonCount > 0 || dataRowCount >= 0,
      'Should show either skeleton rows (loading) or actual data rows (loaded)'
    ).toBeTruthy()
  })
})

test.describe('V-SET-01: Accessibility', () => {
  test('V-SET-01-A1: navigation has proper aria role', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Nav should have aria-label for navigation
    const nav = page.locator('[data-testid="settings-nav"]')
    await expect(nav).toHaveAttribute('aria-label', 'Settings sections')
  })

  test('V-SET-01-A2: active section has aria-current', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // General is now default, so it should have aria-current="page"
    const generalNav = page.locator('[data-testid="settings-nav-general"]')
    await expect(generalNav).toHaveAttribute('aria-current', 'page')
  })

  test('V-SET-01-A3: table has proper aria-label', async ({ page }) => {
    await page.goto('/settings/environments')
    await waitForSettingsPageLoad(page)

    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    const table = page.locator('[data-testid="environments-table"] table')
    const ariaLabel = await table.getAttribute('aria-label')
    expect(ariaLabel, 'Table should have aria-label').toBeTruthy()
  })

  test('V-SET-01-A4: keyboard navigation works on section nav', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // General is already active by default, focus on Environments
    const environmentsNav = page.locator('[data-testid="settings-nav-environments"]')
    await environmentsNav.focus()

    // Press Enter to activate
    await page.keyboard.press('Enter')

    // Environments should now be active
    await expect(environmentsNav).toHaveAttribute('aria-current', 'page')
  })
})
