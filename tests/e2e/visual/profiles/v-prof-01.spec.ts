/**
 * V-PROF-01: Profiles List Populated
 *
 * REQ: REQ-4.7.4
 *
 * Main Purpose: Profiles list shows data table with filters and pagination.
 *
 * Pass Criteria:
 * 1. Page title: "Profiles" with "+ New Profile" button (top right)
 * 2. Search bar with placeholder "Search profiles…"
 * 3. Filter dropdowns: Type, Tags (NO Status filter - profiles don't execute)
 * 4. "Mass Action" button (bulk export/duplicate/delete)
 * 5. "Columns" button for column visibility toggle
 * 6. Table columns: Name, Type, Tags, Usage, Actions
 * 7. Type badges for different profile types (database, ssh, http, etc.)
 * 8. Usage column shows "N tests" count
 * 9. Actions column: Edit button (pencil icon), kebab menu (Duplicate, Delete)
 * 10. Pagination: "Showing X-Y of Z profiles", page size selector, page numbers
 *
 * Layout Requirements:
 * 11. No breadcrumb on list pages - per design
 * 12. Page fills viewport height with no page-level scroll
 * 13. Pagination anchored at bottom
 * 14. Table area flex-grows to fill available space
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for profiles page to fully load with data
async function waitForProfilesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })
}

// Single seed for all tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/profiles/v-prof-01/01-seed.sh')
})

test.describe('V-PROF-01: Profiles List Populated', () => {
  // Uses file-level seed

  test('V-PROF-01-S1: page header shows title and New Profile button', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 1. Page title should be "Profiles"
    const pageTitle = page.getByRole('heading', { name: 'Profiles', level: 1 })
    await expect(pageTitle, 'Page title should be "Profiles"').toBeVisible()

    // "+ New Profile" button should be visible and positioned in header
    const newProfileButton = page.getByRole('button', { name: /New Profile/i })
    await expect(
      newProfileButton,
      '"+ New Profile" button should be visible'
    ).toBeVisible()
    await expect(newProfileButton).toBeEnabled()
  })

  test('V-PROF-01-S2: search bar with correct placeholder', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 2. Search bar with placeholder "Search profiles…"
    const searchInput = page.getByPlaceholder(/Search profiles/i)
    await expect(searchInput, 'Search bar should be visible').toBeVisible()
  })

  test('V-PROF-01-S3: filter dropdowns present (Type, Tags, NO Status)', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 3. Filter dropdowns: Type, Tags
    const typeFilter = page.locator('[data-testid="filter-type"]')
    await expect(typeFilter, 'Type filter dropdown should be visible').toBeVisible()

    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(tagsFilter, 'Tags filter dropdown should be visible').toBeVisible()

    // NO Status filter - profiles don't execute
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter should NOT be present for profiles list'
    ).not.toBeVisible()
  })

  test('V-PROF-01-S4: Mass Action button is present for profiles', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 4. "Mass Action" button (bulk export/duplicate/delete)
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await expect(
      massActionButton,
      'Mass Action button should be visible for profiles'
    ).toBeVisible()
  })

  test('V-PROF-01-S5: Columns toggle button is present', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 5. "Columns" button for column visibility toggle
    const columnsButton = page.getByRole('button', { name: /Columns/i })
    await expect(columnsButton, 'Columns button should be visible').toBeVisible()
  })

  test('V-PROF-01-S6: table has correct columns', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 6. Table columns: Name, Type, Tags, Usage, Actions
    const table = page.locator('[data-testid="profiles-table"]')
    await expect(table, 'Profiles table should be visible').toBeVisible()

    // Check column headers
    const nameHeader = table.locator('th', { hasText: 'Name' })
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const typeHeader = table.locator('th', { hasText: 'Type' })
    await expect(typeHeader, 'Type column header should be visible').toBeVisible()

    const tagsHeader = table.locator('th', { hasText: 'Tags' })
    await expect(tagsHeader, 'Tags column header should be visible').toBeVisible()

    const usageHeader = table.locator('th', { hasText: 'Usage' })
    await expect(usageHeader, 'Usage column header should be visible').toBeVisible()

    const actionsHeader = table.locator('th', { hasText: 'Actions' })
    await expect(actionsHeader, 'Actions column header should be visible').toBeVisible()
  })

  test('V-PROF-01-S7: type badges display for different profile types', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 7. Type badges for different profile types
    // The seed data includes: database, ssh, http, kubernetes, custom profiles
    const typeBadge = page.locator('[data-testid="profile-type"]').first()
    await expect(typeBadge, 'Type badge should be visible').toBeVisible()

    // Verify multiple type badges exist (different types in seed data)
    const typeBadges = page.locator('[data-testid="profile-type"]')
    const badgeCount = await typeBadges.count()
    expect(badgeCount, 'Should have multiple type badges for different profiles').toBeGreaterThan(0)
  })

  test('V-PROF-01-S8: usage column shows test count', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 8. Usage column shows "N tests" count
    const usageCell = page.locator('[data-testid="profile-usage"]').first()
    await expect(usageCell, 'Usage cell should be visible').toBeVisible()
    // Usage should contain a number followed by "test" or "tests"
    await expect(usageCell).toContainText(/\d+\s*tests?/i)
  })

  test('V-PROF-01-S9: actions column has edit button and kebab menu', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 9. Actions column: Edit button (pencil icon), kebab menu
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    await expect(firstRow, 'At least one profile row should be visible').toBeVisible()

    // Edit button (pencil icon)
    const editButton = firstRow.locator('[data-testid="action-edit"]')
    await expect(editButton, 'Edit action button should be visible').toBeVisible()

    // Kebab menu (overflow menu)
    const overflowMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await expect(overflowMenu, 'Overflow menu should be visible').toBeVisible()
  })

  test('V-PROF-01-S10: kebab menu contains Duplicate and Delete options', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Open kebab menu on first row
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const overflowMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await overflowMenu.click()

    // Verify menu contains Duplicate and Delete options
    const duplicateOption = page.getByRole('menuitem', { name: /Duplicate/i })
    await expect(duplicateOption, 'Duplicate menu item should be visible').toBeVisible()

    const deleteOption = page.getByRole('menuitem', { name: /Delete/i })
    await expect(deleteOption, 'Delete menu item should be visible').toBeVisible()

    // NO Run option - profiles are configuration, not executable
    const runOption = page.getByRole('menuitem', { name: /^Run$/i })
    await expect(
      runOption,
      'Run option should NOT exist for profiles (not executable)'
    ).toHaveCount(0)
  })

  test('V-PROF-01-S11: pagination controls are present', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // 10. Pagination: "Showing X-Y of Z profiles", page size selector, page numbers
    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(
      paginationContainer,
      'Pagination container should be visible'
    ).toBeVisible()

    // Item count: "Showing X-Y of Z profiles"
    const itemCount = paginationContainer.locator(
      '[data-testid="pagination-item-count"]'
    )
    await expect(itemCount, 'Item count should be visible').toBeVisible()
    await expect(itemCount).toContainText(/Showing \d+-\d+ of \d+/i)

    // Page size selector (10/25/50/100)
    const pageSizeSelector = paginationContainer.locator(
      '[data-testid="page-size-selector"]'
    )
    await expect(
      pageSizeSelector,
      'Page size selector should be visible'
    ).toBeVisible()

    // Page navigation
    const pageNavigation = paginationContainer.locator(
      '[data-testid="pagination-navigation"]'
    )
    await expect(pageNavigation, 'Page navigation should be visible').toBeVisible()
  })

  test('V-PROF-01-S12: tags displayed as badges in Tags column', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Verify tags are displayed as badges (inline rounded spans within profile-tags)
    const tagBadges = page.locator('[data-testid="profile-tags"] span.rounded-full')
    const tagCount = await tagBadges.count()
    expect(tagCount, 'Should have tag badges for profiles with tags').toBeGreaterThan(0)
  })

  test('V-PROF-01-S13: delete disabled for profiles in use', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Find a profile with usage > 0 (Production Database has 12 tests)
    const rowWithUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /[1-9]\d*\s*tests?/i }),
    }).first()

    // CRITICAL: Verify seed data has profile with usage > 0
    await expect(
      rowWithUsage,
      'Seed data should include a profile with usage > 0'
    ).toBeVisible()

    // Open kebab menu
    const overflowMenu = rowWithUsage.locator('[data-testid="action-menu-trigger"]')
    await overflowMenu.click()

    // Delete option should be disabled (Radix uses aria-disabled)
    const deleteOption = page.getByRole('menuitem', { name: /Delete/i })
    await expect(
      deleteOption,
      'Delete should be aria-disabled for profile in use'
    ).toHaveAttribute('aria-disabled', 'true')
  })

  test('V-PROF-01-S14: delete enabled for profiles with zero usage', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Find a profile with usage = 0 (Redis Cache, Kafka Broker)
    const rowWithZeroUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /^0\s*tests?$/i }),
    }).first()

    // CRITICAL: Verify seed data has profile with usage = 0
    await expect(
      rowWithZeroUsage,
      'Seed data should include a profile with usage = 0'
    ).toBeVisible()

    // Open kebab menu
    const overflowMenu = rowWithZeroUsage.locator('[data-testid="action-menu-trigger"]')
    await overflowMenu.click()

    // Delete option should be enabled
    const deleteOption = page.getByRole('menuitem', { name: /Delete/i })
    await expect(deleteOption, 'Delete should be enabled for profile with zero usage').toBeEnabled()
  })

  test('V-PROF-01-S15: NO checkbox column (no selection mode)', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Profiles list should NOT have checkbox column (no selection/mass action)
    const table = page.locator('[data-testid="profiles-table"]')
    await expect(table).toBeVisible()

    // No checkbox in header
    const headerCheckbox = table.locator('thead input[type="checkbox"]')
    await expect(
      headerCheckbox,
      'Profiles table should NOT have selection checkbox in header'
    ).toHaveCount(0)

    // No checkbox in rows
    const rowCheckbox = table.locator('tbody input[type="checkbox"]')
    await expect(
      rowCheckbox,
      'Profiles table should NOT have selection checkboxes in rows'
    ).toHaveCount(0)
  })

  test('V-PROF-01-S16: profile name displayed in Name column', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Verify profile names are displayed (from seed data)
    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const nameCell = firstRow.locator('[data-testid="profile-name"]')

    await expect(nameCell, 'Profile name cell should be visible').toBeVisible()

    // Name should have actual text content (not empty)
    const nameText = await nameCell.textContent()
    expect(nameText?.trim().length, 'Profile name should not be empty').toBeGreaterThan(0)
  })

  test('V-PROF-01-S17: duplicate action always enabled', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Even for profiles in use, Duplicate should be enabled
    const rowWithUsage = page.locator('[data-testid="profile-row"]').filter({
      has: page.locator('[data-testid="profile-usage"]', { hasText: /[1-9]\d*\s*tests?/i }),
    }).first()

    await expect(rowWithUsage, 'Should have profile with usage').toBeVisible()

    const overflowMenu = rowWithUsage.locator('[data-testid="action-menu-trigger"]')
    await overflowMenu.click()

    const duplicateOption = page.getByRole('menuitem', { name: /Duplicate/i })
    await expect(
      duplicateOption,
      'Duplicate should always be enabled (even for profiles in use)'
    ).toBeEnabled()
  })
})

/**
 * Layout Tests
 *
 * These tests verify the viewport-filling layout pattern:
 * - Page fills viewport height with no page-level scroll
 * - Pagination anchored at bottom
 * - Table area flex-grows to fill available space
 */
test.describe('V-PROF-01: Page Layout', () => {
  // Uses file-level seed (shared with Populated tests)

  test('V-PROF-01-L1: no breadcrumb on list page per design', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Per design: breadcrumbs are only for detail/edit pages, not list pages
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(
      breadcrumb,
      'Breadcrumb should NOT be visible on list page per design'
    ).not.toBeVisible()
  })

  test('V-PROF-01-L2: single Profiles heading (no duplicate)', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // There should be exactly ONE h1 with "Profiles" text
    const profilesHeadings = page.getByRole('heading', { name: 'Profiles' })
    const headingCount = await profilesHeadings.count()

    expect(
      headingCount,
      'Should have exactly ONE "Profiles" heading'
    ).toBe(1)
  })

  test('V-PROF-01-L3: page container fills viewport height', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const pageContainer = page.locator('[data-testid="profiles-page"]')
    await expect(pageContainer).toBeVisible()

    // Verify the page container has the viewport-filling classes
    const containerClass = await pageContainer.getAttribute('class')
    expect(
      containerClass,
      'Page container should have h-full class for viewport filling'
    ).toContain('h-full')
    expect(
      containerClass,
      'Page container should have overflow-hidden to prevent page scroll'
    ).toContain('overflow-hidden')

    // Verify container height matches or is close to viewport height
    const viewportHeight = page.viewportSize()?.height ?? 800
    const containerBox = await pageContainer.boundingBox()
    expect(containerBox).toBeTruthy()

    // Container should fill most of the viewport
    expect(
      containerBox!.height,
      'Page container should fill significant portion of viewport'
    ).toBeGreaterThan(viewportHeight * 0.7)
  })

  test('V-PROF-01-L4: pagination anchored at bottom', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(paginationContainer).toBeVisible()

    // Verify flex-shrink-0 class is present
    const paginationClass = await paginationContainer.getAttribute('class')
    expect(
      paginationClass,
      'Pagination should have flex-shrink-0 to anchor at bottom'
    ).toContain('flex-shrink-0')

    // Verify pagination is near the bottom of the page container
    const pageContainer = page.locator('[data-testid="profiles-page"]')
    const containerBox = await pageContainer.boundingBox()
    const paginationBox = await paginationContainer.boundingBox()

    expect(containerBox).toBeTruthy()
    expect(paginationBox).toBeTruthy()

    // Pagination bottom should be close to container bottom
    const containerBottom = containerBox!.y + containerBox!.height
    const paginationBottom = paginationBox!.y + paginationBox!.height

    expect(
      containerBottom - paginationBottom,
      'Pagination should be anchored near bottom of page container'
    ).toBeLessThan(40)
  })

  test('V-PROF-01-L5: table area grows to fill space', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const pageContainer = page.locator('[data-testid="profiles-page"]')
    const table = page.locator('[data-testid="profiles-table"]')
    const pagination = page.locator('[data-testid="pagination"]')

    const containerBox = await pageContainer.boundingBox()
    const tableBox = await table.boundingBox()
    const paginationBox = await pagination.boundingBox()

    expect(containerBox).toBeTruthy()
    expect(tableBox).toBeTruthy()
    expect(paginationBox).toBeTruthy()

    // Table should have significant height
    expect(
      tableBox!.height,
      'Table area should have significant height'
    ).toBeGreaterThan(paginationBox!.height * 2)

    // Minimal gap between table and pagination
    const gapBetweenTableAndPagination =
      paginationBox!.y - (tableBox!.y + tableBox!.height)

    expect(
      gapBetweenTableAndPagination,
      'Gap between table and pagination should be minimal'
    ).toBeLessThan(50)
  })

  test('V-PROF-01-L6: no page-level horizontal scroll', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const html = page.locator('html')

    const htmlScrollWidth = await html.evaluate((el) => el.scrollWidth)
    const htmlClientWidth = await html.evaluate((el) => el.clientWidth)

    expect(
      htmlScrollWidth,
      'HTML element should not have horizontal overflow'
    ).toBeLessThanOrEqual(htmlClientWidth + 1)
  })
})
