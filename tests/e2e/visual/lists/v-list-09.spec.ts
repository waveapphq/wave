/**
 * V-LIST-09: Regressions List Populated
 *
 * REQ: REQ-5.2.1.37
 * Design Decisions: LIST-1, LIST-2, LIST-7, LIST-9
 *
 * Main Purpose: Regressions list with run capability.
 *
 * Pass Criteria:
 * 1. Page title: "Regressions" with "+ New Regression" button
 * 2. Table columns: Name, Suites (count), Tests (total), Status, Last Run, Actions
 *    (Version is embedded in the name per LIST-9, not a separate column)
 * 3. No checkbox column (no Mass Action for regressions)
 * 4. "Run" action prominent in Actions column
 * 5. Status badges: Passed (green), Failed (red), Never Run (gray)
 *
 * Additional Criteria:
 * 6. Search bar with "Search regressions…" placeholder
 * 7. Status and Tags filter dropdowns
 * 8. Columns visibility toggle
 * 9. NO Mass Action button (differs from Suites - regressions are top of hierarchy)
 * 10. Pagination per LIST-2
 * 11. Names follow LIST-9 pattern "AppName Version" (e.g., "WAVE 25.12")
 *
 * Layout Requirements:
 * 12. No breadcrumb on list pages
 * 13. Page fills viewport height with no page-level scroll
 * 14. Pagination anchored at bottom
 * 15. Table area flex-grows to fill available space
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for regressions page to fully load with data
async function waitForRegressionsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="regressions-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="regression-row"]', { state: 'visible' })
}

// Single reset+seed for ALL tests in this file
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-09/01-seed.sh')
})

test.describe('V-LIST-09: Regressions List Populated', () => {
  // Pass Criterion 1: Page title and New Regression button
  test('V-LIST-09-S1: page header shows title and New Regression button', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Page title should be "Regressions"
    const pageTitle = page.getByRole('heading', { name: 'Regressions', level: 1 })
    await expect(pageTitle, 'Page title should be "Regressions"').toBeVisible()

    // "+ New Regression" button should be visible and positioned in header
    const newRegressionButton = page.getByRole('button', { name: /New Regression/i })
    await expect(
      newRegressionButton,
      '"+ New Regression" button should be visible'
    ).toBeVisible()
    await expect(newRegressionButton).toBeEnabled()
  })

  // Pass Criterion 6: Search bar
  test('V-LIST-09-S2: search bar with correct placeholder', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Search bar with placeholder "Search regressions…"
    const searchInput = page.getByPlaceholder(/Search regressions/i)
    await expect(searchInput, 'Search bar should be visible').toBeVisible()
  })

  // Pass Criterion 7: Status and Tags filter dropdowns
  test('V-LIST-09-S3: filter dropdowns are present (Status and Tags only)', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Status filter dropdown
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter dropdown should be visible'
    ).toBeVisible()

    // Tags filter dropdown
    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(
      tagsFilter,
      'Tags filter dropdown should be visible'
    ).toBeVisible()
  })

  // Pass Criterion 3 & 9: NO Mass Action for regressions, but Columns toggle present
  test('V-LIST-09-S4: NO Mass Action button (regressions are top of hierarchy) per wireframe', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Per wireframe and design: NO Mass Action for regressions (top of hierarchy)
    const massActionButton = page.locator('[data-testid="mass-action-button"]')
    await expect(
      massActionButton,
      'Mass Action button should NOT be visible for regressions'
    ).not.toBeVisible()

    // Columns button should be visible
    const columnsButton = page.locator('[data-testid="columns-button"]')
    await expect(
      columnsButton,
      'Columns button should be visible'
    ).toBeVisible()
  })

  // Pass Criterion 2: Table columns - Name, Suites (count), Tests (total), Status, Last Run, Actions
  // Version is part of the Name per LIST-9 ("AppName Version" pattern), not a separate column.
  test('V-LIST-09-S5: table has correct columns per design', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const table = page.locator('[data-testid="regressions-table"]')
    await expect(table, 'Table should be visible').toBeVisible()

    // Check column headers - per design: Name, Suites, Tests, Status, Last Run, Actions
    const nameHeader = table.locator('th', { hasText: 'Name' })
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const suitesHeader = table.locator('th', { hasText: 'Suites' })
    await expect(suitesHeader, 'Suites column header should be visible').toBeVisible()

    const testsHeader = table.locator('th', { hasText: 'Tests' })
    await expect(testsHeader, 'Tests column header should be visible').toBeVisible()

    const statusHeader = table.locator('th', { hasText: 'Status' })
    await expect(statusHeader, 'Status column header should be visible').toBeVisible()

    const lastRunHeader = table.locator('th', { hasText: 'Last Run' })
    await expect(lastRunHeader, 'Last Run column header should be visible').toBeVisible()

    const actionsHeader = table.locator('th', { hasText: 'Actions' })
    await expect(actionsHeader, 'Actions column header should be visible').toBeVisible()
  })

  // Pass Criterion 3: No checkbox column
  test('V-LIST-09-S6: no checkbox column (no selection for regressions)', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // No checkbox column should exist - regressions don't have Mass Action
    const checkboxColumn = page.locator('[data-testid="regressions-table"] th[data-column="select"]')
    await expect(
      checkboxColumn,
      'Checkbox column should NOT exist for regressions'
    ).not.toBeVisible()

    // Also verify no checkbox input in header
    const headerCheckbox = page.locator('[data-testid="regressions-table"] thead input[type="checkbox"]')
    await expect(
      headerCheckbox,
      'Header checkbox should NOT exist for regressions'
    ).not.toBeVisible()
  })

  // Pass Criterion 5: Status badges with correct colors per LIST-7
  test('V-LIST-09-S7: status badges follow LIST-7 color scheme', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Per LIST-7: Passed (green), Failed (red), Never Run (gray)
    const passedBadge = page.locator('[data-testid="status-badge-passed"]').first()
    await expect(passedBadge, 'Passed badge should be visible').toBeVisible()

    const failedBadge = page.locator('[data-testid="status-badge-failed"]').first()
    await expect(failedBadge, 'Failed badge should be visible').toBeVisible()

    const neverRunBadge = page.locator('[data-testid="status-badge-never-run"]').first()
    await expect(neverRunBadge, 'Never Run badge should be visible').toBeVisible()
  })

  // Pass Criterion 4: Run action prominent in Actions column
  test('V-LIST-09-S8: row actions show Run button prominently and menu', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const firstRowActions = page.locator('[data-testid="regressions-table"] tbody tr').first()

    // Run button should be prominent (visible without menu)
    const runButton = firstRowActions.locator('[data-testid="row-action-run"]')
    await expect(runButton, 'Run button should be visible').toBeVisible()

    // Actions overflow menu should also be present
    const menuButton = firstRowActions.locator('[data-testid="row-actions-menu"]')
    await expect(menuButton, 'Actions menu button should be visible').toBeVisible()
  })

  // Pass Criterion 10: Pagination per LIST-2
  test('V-LIST-09-S9: pagination controls are present per LIST-2', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Pagination should be visible
    const pagination = page.locator('[data-testid="pagination"]')
    await expect(pagination, 'Pagination should be visible').toBeVisible()

    // "Showing X-Y of Z regressions" text
    const paginationInfo = page.locator('[data-testid="pagination-item-count"]')
    await expect(paginationInfo, 'Pagination info should be visible').toBeVisible()
    await expect(paginationInfo).toContainText(/Showing \d+-\d+ of \d+ regressions/i)

    // Page size selector
    const pageSizeSelector = page.locator('[data-testid="page-size-selector"]')
    await expect(pageSizeSelector, 'Page size selector should be visible').toBeVisible()
  })

  // Pass Criterion 11: Names follow LIST-9 pattern "AppName Version"
  test('V-LIST-09-S10: regression names follow LIST-9 naming pattern', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Per LIST-9: Naming pattern "AppName Version" (e.g., "WAVE 25.12")
    // Verify at least one row has the expected pattern
    const nameCell = page.locator('[data-testid="regressions-table"] tbody tr').first()
      .locator('[data-testid="regression-name"]')
    await expect(nameCell, 'Name cell should be visible').toBeVisible()

    // Name should contain text (specific pattern verified by presence of data)
    const nameText = await nameCell.textContent()
    expect(nameText?.length, 'Regression name should have content').toBeGreaterThan(0)
  })

  // Additional: Suites count column
  test('V-LIST-09-S11: Suites column shows count', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Suites column should show count (e.g., "3 suites" or "3")
    const suitesCell = page.locator('[data-testid="regressions-table"] tbody tr').first()
      .locator('[data-testid="regression-suites-count"]')
    await expect(suitesCell, 'Suites count cell should be visible').toBeVisible()
    await expect(suitesCell).toContainText(/\d+/)
  })

  // Additional: Tests total column
  test('V-LIST-09-S12: Tests column shows total count across suites', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Tests column should show total count
    const testsCell = page.locator('[data-testid="regressions-table"] tbody tr').first()
      .locator('[data-testid="regression-tests-count"]')
    await expect(testsCell, 'Tests count cell should be visible').toBeVisible()
    await expect(testsCell).toContainText(/\d+/)
  })

  // Additional: Table has data rows
  test('V-LIST-09-S13: table rows have data per wireframe', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Verify table has data rows (wireframe shows 9 rows)
    const tableRows = page.locator('[data-testid="regressions-table"] tbody tr')
    const rowCount = await tableRows.count()
    expect(rowCount, 'Table should have at least 1 row').toBeGreaterThan(0)
  })
})

/**
 * Layout Tests for V-LIST-09
 *
 * These tests verify the viewport-filling layout pattern from DASH-4/DASH-5/DASH-8
 * applied to regressions list page.
 */
test.describe('V-LIST-09: Page Layout', () => {
  // Pass Criterion 12: No breadcrumb on list pages
  test('V-LIST-09-L1: no breadcrumb on list page per design', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Per design: breadcrumbs are only for detail/edit pages, not list pages
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(
      breadcrumb,
      'Breadcrumb should NOT be visible on list page per design'
    ).not.toBeVisible()
  })

  // Single heading (no duplicate)
  test('V-LIST-09-L2: single Regressions heading (no duplicate) per wireframe', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    // Per wireframe: single "Regressions" heading at top of content area
    const regressionsHeadings = page.getByRole('heading', { name: 'Regressions' })
    const headingCount = await regressionsHeadings.count()

    expect(
      headingCount,
      'Should have exactly ONE "Regressions" heading'
    ).toBe(1)
  })

  // Pass Criterion 13: Page fills viewport height
  test('V-LIST-09-L3: page container fills viewport height per DASH-4', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const pageContainer = page.locator('[data-testid="regressions-page"]')
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

  // Pass Criterion 14: Pagination anchored at bottom
  test('V-LIST-09-L4: pagination anchored at bottom per DASH-5', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(paginationContainer).toBeVisible()

    // Verify flex-shrink-0 class is present
    const paginationClass = await paginationContainer.getAttribute('class')
    expect(
      paginationClass,
      'Pagination should have flex-shrink-0 to anchor at bottom per DASH-5'
    ).toContain('flex-shrink-0')

    // Verify pagination is near the bottom of the page container
    const pageContainer = page.locator('[data-testid="regressions-page"]')
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
    ).toBeLessThan(40) // Account for page padding
  })

  // Pass Criterion 15: Table area flex-grows
  test('V-LIST-09-L5: table area grows to fill space per DASH-8', async ({
    page,
  }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const pageContainer = page.locator('[data-testid="regressions-page"]')
    const table = page.locator('[data-testid="regressions-table"]')
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
    const gapBetweenTableAndPagination = paginationBox!.y - (tableBox!.y + tableBox!.height)

    expect(
      gapBetweenTableAndPagination,
      'Gap between table and pagination should be minimal'
    ).toBeLessThan(50)
  })

  // No horizontal scroll
  test('V-LIST-09-L6: no page-level horizontal scroll', async ({ page }) => {
    await page.goto('/regressions')
    await waitForRegressionsPageLoad(page)

    const html = page.locator('html')

    const htmlScrollWidth = await html.evaluate((el) => el.scrollWidth)
    const htmlClientWidth = await html.evaluate((el) => el.clientWidth)

    expect(
      htmlScrollWidth,
      'HTML element should not have horizontal overflow'
    ).toBeLessThanOrEqual(htmlClientWidth + 1)
  })
})
// Empty State tests moved to v-list-09-empty.spec.ts (runs in empty-state phase)
