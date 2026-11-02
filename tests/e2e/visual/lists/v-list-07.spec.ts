/**
 * V-LIST-07: Suites List Populated
 *
 * REQ: REQ-5.2.1.36
 * Design Decisions: LIST-1, LIST-2, LIST-7, BULK-1, BULK-2, BULK-3, BULK-4
 *
 * Main Purpose: Suites list shows data table with filters and pagination.
 *
 * Pass Criteria:
 * 1. Page title: "Suites" with "+ New Suite" button (top right)
 * 2. Search bar with placeholder "Search suites…"
 * 3. Filter dropdowns: Status, Tags (NO Suite filter - suites have no parent)
 * 4. "Mass Action" and "Columns" buttons
 * 5. Table columns: Name, Tests (count), Status, Last Run, Actions
 * 6. Status badges: Passed (green), Failed (red), Never Run (gray) - per LIST-7
 * 7. Actions column: Run button, overflow menu
 * 8. Pagination: "Showing X-Y of Z suites", page size selector, page numbers - per LIST-2
 *
 * Layout Requirements:
 * 9. No breadcrumb on list pages - per design
 * 10. Page fills viewport height with no page-level scroll
 * 11. Pagination anchored at bottom
 * 12. Table area flex-grows to fill available space
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for suites page to fully load with data
async function waitForSuitesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suites-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="suites-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="suite-row"]', { state: 'visible' })
}

// Single seed for all tests in this file (Populated and Layout tests)
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-07/01-seed.sh')
})

test.describe('V-LIST-07: Suites List Populated', () => {
  // Uses file-level seed

  test('V-LIST-07-S1: page header shows title and New Suite button', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 1. Page title should be "Suites"
    const pageTitle = page.getByRole('heading', { name: 'Suites', level: 1 })
    await expect(pageTitle, 'Page title should be "Suites"').toBeVisible()

    // "+ New Suite" button should be visible and positioned in header
    const newSuiteButton = page.getByRole('button', { name: /New Suite/i })
    await expect(
      newSuiteButton,
      '"+ New Suite" button should be visible'
    ).toBeVisible()
    await expect(newSuiteButton).toBeEnabled()
  })

  test('V-LIST-07-S2: search bar with correct placeholder', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 2. Search bar with placeholder "Search suites…"
    const searchInput = page.getByPlaceholder(/Search suites/i)
    await expect(searchInput, 'Search bar should be visible').toBeVisible()
  })

  test('V-LIST-07-S3: filter dropdowns are present (no Suite filter)', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 3. Filter dropdowns: Status, Tags (NO Suite filter - suites have no parent)
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter dropdown should be visible'
    ).toBeVisible()

    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(
      tagsFilter,
      'Tags filter dropdown should be visible'
    ).toBeVisible()

    // Suite filter should NOT exist - suites have no parent entity
    const suiteFilter = page.locator('[data-testid="filter-suite"]')
    await expect(
      suiteFilter,
      'Suite filter should NOT be present for suites list'
    ).not.toBeVisible()
  })

  test('V-LIST-07-S4: Mass Action and Columns buttons are present', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 4. "Mass Action" and "Columns" buttons
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await expect(
      massActionButton,
      'Mass Action button should be visible'
    ).toBeVisible()

    const columnsButton = page.getByRole('button', { name: /Columns/i })
    await expect(
      columnsButton,
      'Columns button should be visible'
    ).toBeVisible()
  })

  test('V-LIST-07-S5: table has correct columns per LIST-1', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 5. Table columns: Name, Tests (count), Status, Last Run, Actions
    const table = page.locator('[data-testid="suites-table"]')
    await expect(table, 'Table should be visible').toBeVisible()

    // Check column headers
    const nameHeader = table.locator('th', { hasText: 'Name' })
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const testsHeader = table.locator('th', { hasText: 'Tests' })
    await expect(testsHeader, 'Tests column header should be visible').toBeVisible()

    const statusHeader = table.locator('th', { hasText: 'Status' })
    await expect(statusHeader, 'Status column header should be visible').toBeVisible()

    const lastRunHeader = table.locator('th', { hasText: 'Last Run' })
    await expect(lastRunHeader, 'Last Run column header should be visible').toBeVisible()

    const actionsHeader = table.locator('th', { hasText: 'Actions' })
    await expect(actionsHeader, 'Actions column header should be visible').toBeVisible()
  })

  test('V-LIST-07-S6: status badges follow LIST-7 color scheme', async ({ page }) => {
    // Load all suites on one page to guarantee all status types are visible.
    // Fixture seeds 30 suites; default 25/page may push never_run to page 2.
    await page.goto('/suites?per_page=50')
    await waitForSuitesPageLoad(page)

    // 6. Status badges: Passed (green), Failed (red), Never Run (gray) - per LIST-7
    const passedBadge = page.locator('[data-testid="status-badge-passed"]').first()
    await expect(passedBadge, 'Passed badge should be visible').toBeVisible()

    const failedBadge = page.locator('[data-testid="status-badge-failed"]').first()
    await expect(failedBadge, 'Failed badge should be visible').toBeVisible()

    const neverRunBadge = page.locator('[data-testid="status-badge-never-run"]').first()
    await expect(neverRunBadge, 'Never Run badge should be visible').toBeVisible()
  })

  test('V-LIST-07-S7: row actions show Run button and menu', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 7. Actions column: Run button, overflow menu
    const firstRowActions = page.locator('[data-testid="suites-table"] tbody tr').first()

    const runButton = firstRowActions.locator('[data-testid="row-action-run"]')
    await expect(runButton, 'Run button should be visible').toBeVisible()

    const menuButton = firstRowActions.locator('[data-testid="row-actions-menu"]')
    await expect(menuButton, 'Actions menu button should be visible').toBeVisible()
  })

  test('V-LIST-07-S8: pagination controls are present per LIST-2', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 8. Pagination: "Showing X-Y of Z suites", page size selector, page numbers
    const pagination = page.locator('[data-testid="pagination"]')
    await expect(pagination, 'Pagination should be visible').toBeVisible()

    // "Showing X-Y of Z suites" text
    const paginationInfo = page.locator('[data-testid="pagination-item-count"]')
    await expect(paginationInfo, 'Pagination info should be visible').toBeVisible()
    await expect(paginationInfo).toContainText(/Showing \d+-\d+ of \d+ suites/i)

    // Page size selector
    const pageSizeSelector = page.locator('[data-testid="page-size-selector"]')
    await expect(pageSizeSelector, 'Page size selector should be visible').toBeVisible()
  })

  test('V-LIST-07-S9: Tests column shows test count', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Tests column should show count (e.g., "5 tests" or just "5")
    const testsCell = page.locator('[data-testid="suites-table"] tbody tr').first()
      .locator('[data-testid="suite-tests-count"]')
    await expect(testsCell, 'Tests count cell should be visible').toBeVisible()
    await expect(testsCell).toContainText(/\d+/)
  })

  test('V-LIST-07-S10: table rows have data per wireframe', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Verify table has data rows
    const tableRows = page.locator('[data-testid="suites-table"] tbody tr')
    const rowCount = await tableRows.count()
    expect(rowCount, 'Table should have at least 1 row').toBeGreaterThan(0)
  })
})

/**
 * Layout Tests (DASH-4, DASH-5, DASH-8)
 *
 * These tests verify the viewport-filling layout pattern:
 * - DASH-4: Page fills viewport height with no page-level scroll
 * - DASH-5: Pagination anchored at bottom
 * - DASH-8: Table area flex-grows to fill available space
 */
test.describe('V-LIST-07: Page Layout', () => {
  // Uses file-level seed

  test('V-LIST-07-L1: no breadcrumb on list page per design', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per design: breadcrumbs are only for detail/edit pages, not list pages
    // The breadcrumb nav element should not be visible on /suites
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(
      breadcrumb,
      'Breadcrumb should NOT be visible on list page per design'
    ).not.toBeVisible()

    // Also verify no breadcrumb-related elements
    const breadcrumbList = page.locator('[role="list"]').filter({ hasText: /Suites.*\/.*/ })
    await expect(
      breadcrumbList,
      'Breadcrumb list should not exist on list page'
    ).toHaveCount(0)
  })

  test('V-LIST-07-L2: single Suites heading (no duplicate) per wireframe', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per V-LIST-07 wireframe: single "Suites" heading at top of content area
    // There should be exactly ONE h1 with "Suites" text
    const suitesHeadings = page.getByRole('heading', { name: 'Suites' })
    const headingCount = await suitesHeadings.count()

    expect(
      headingCount,
      'Should have exactly ONE "Suites" heading (no duplicate from breadcrumb)'
    ).toBe(1)
  })

  test('V-LIST-07-L3: page container fills viewport height per DASH-4', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per DASH-4: Page fills viewport height with h-full, no page-level scroll
    const pageContainer = page.locator('[data-testid="suites-page"]')
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

    // Container should fill most of the viewport (accounting for sidebar offset)
    // Should be at least 70% of viewport height
    expect(
      containerBox!.height,
      'Page container should fill significant portion of viewport'
    ).toBeGreaterThan(viewportHeight * 0.7)
  })

  test('V-LIST-07-L4: pagination anchored at bottom per DASH-5', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per DASH-5: Pagination uses flex-shrink-0 to stay anchored at bottom
    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(paginationContainer).toBeVisible()

    // Verify flex-shrink-0 class is present
    const paginationClass = await paginationContainer.getAttribute('class')
    expect(
      paginationClass,
      'Pagination should have flex-shrink-0 to anchor at bottom per DASH-5'
    ).toContain('flex-shrink-0')

    // Verify pagination is near the bottom of the page container
    const pageContainer = page.locator('[data-testid="suites-page"]')
    const containerBox = await pageContainer.boundingBox()
    const paginationBox = await paginationContainer.boundingBox()

    expect(containerBox).toBeTruthy()
    expect(paginationBox).toBeTruthy()

    // Pagination bottom should be close to container bottom (within 30px for padding)
    const containerBottom = containerBox!.y + containerBox!.height
    const paginationBottom = paginationBox!.y + paginationBox!.height

    expect(
      containerBottom - paginationBottom,
      'Pagination should be anchored near bottom of page container'
    ).toBeLessThan(40) // Account for page padding
  })

  test('V-LIST-07-L5: table area grows to fill space per DASH-8', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per DASH-8: Table container uses flex-1 min-h-0 pattern for internal scrolling
    // The table wrapper should expand to fill available space between header/filters and pagination

    const pageContainer = page.locator('[data-testid="suites-page"]')
    const table = page.locator('[data-testid="suites-table"]')
    const pagination = page.locator('[data-testid="pagination"]')

    const containerBox = await pageContainer.boundingBox()
    const tableBox = await table.boundingBox()
    const paginationBox = await pagination.boundingBox()

    expect(containerBox).toBeTruthy()
    expect(tableBox).toBeTruthy()
    expect(paginationBox).toBeTruthy()

    // Table should have significant height (more than pagination)
    expect(
      tableBox!.height,
      'Table area should have significant height (filling available space)'
    ).toBeGreaterThan(paginationBox!.height * 2)

    // There should be minimal gap between table bottom and pagination top
    // (The table wrapper should fill the space, not leave empty area)
    const gapBetweenTableAndPagination = paginationBox!.y - (tableBox!.y + tableBox!.height)

    // Allow for some gap (flex gap), but not excessive empty space
    expect(
      gapBetweenTableAndPagination,
      'Gap between table and pagination should be minimal (no large empty area)'
    ).toBeLessThan(50)
  })

  test('V-LIST-07-L6: no page-level horizontal scroll', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per DASH-4: no page-level scroll
    const html = page.locator('html')

    // Check that body/html don't have horizontal overflow
    // Should not show horizontal scrollbar
    const htmlScrollWidth = await html.evaluate((el) => el.scrollWidth)
    const htmlClientWidth = await html.evaluate((el) => el.clientWidth)

    expect(
      htmlScrollWidth,
      'HTML element should not have horizontal overflow (no scrollbar)'
    ).toBeLessThanOrEqual(htmlClientWidth + 1) // Allow 1px tolerance
  })
})
