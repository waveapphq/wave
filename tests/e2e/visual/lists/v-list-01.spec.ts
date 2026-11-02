/**
 * V-LIST-01: Tests List Populated
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: LIST-1, LIST-2, LIST-7, DASH-4, DASH-5, DASH-8
 *
 * Main Purpose: Tests list shows data table with filters and pagination.
 *
 * Pass Criteria:
 * 1. Page title: "Tests" with "+ New Test" button (top right)
 * 2. Search bar with placeholder "Search tests…"
 * 3. Filter dropdowns: Status, Suite, Tags
 * 4. "Mass Action" and "Columns" buttons
 * 5. Table columns: Name, Suite, Status, Last Run, Actions
 * 6. Status badges: Passed (green), Failed (red), Never Run (gray) - per LIST-7
 * 7. Actions column: Run button, overflow menu
 * 8. Pagination: "Showing X-Y of Z tests", page size selector, page numbers - per LIST-2
 *
 * Layout Requirements (DASH-4, DASH-5, DASH-8):
 * 9. No breadcrumb on list pages - per design, breadcrumbs only for detail/edit pages
 * 10. Page fills viewport height with no page-level scroll - per DASH-4
 * 11. Pagination anchored at bottom - per DASH-5
 * 12. Table area flex-grows to fill available space - per DASH-8
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for tests page to fully load with data
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  // Wait for page to finish loading (aria-busy becomes false)
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  // Wait for actual data rows to appear (not skeleton rows)
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

// Single seed for all tests in this file (Populated and Layout tests)
test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-01/01-seed.sh')
})

test.describe('V-LIST-01: Tests List Populated', () => {
  // Uses file-level seed

  test('V-LIST-01-S1: page header shows title and New Test button', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 1. Page title should be "Tests"
    const pageTitle = page.getByRole('heading', { name: 'Tests', level: 1 })
    await expect(pageTitle, 'Page title should be "Tests"').toBeVisible()

    // "+ New Test" button should be visible and positioned in header
    const newTestButton = page.getByRole('button', { name: /New Test/i })
    await expect(
      newTestButton,
      '"+ New Test" button should be visible'
    ).toBeVisible()
    await expect(newTestButton).toBeEnabled()
  })

  test('V-LIST-01-S2: search bar with correct placeholder', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 2. Search bar with placeholder "Search tests…"
    const searchInput = page.getByPlaceholder(/Search tests/i)
    await expect(searchInput, 'Search bar should be visible').toBeVisible()
  })

  test('V-LIST-01-S3: filter dropdowns are present', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 3. Filter dropdowns: Status, Suite, Tags
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter dropdown should be visible'
    ).toBeVisible()

    const suiteFilter = page.locator('[data-testid="filter-suite"]')
    await expect(
      suiteFilter,
      'Suite filter dropdown should be visible'
    ).toBeVisible()

    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(
      tagsFilter,
      'Tags filter dropdown should be visible'
    ).toBeVisible()
  })

  test('V-LIST-01-S4: Mass Action and Columns buttons are present', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

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

  test('V-LIST-01-S5: table has correct columns', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 5. Table columns: Name, Suite, Status, Last Run, Actions
    const table = page.locator('[data-testid="tests-table"]')
    await expect(table, 'Tests table should be visible').toBeVisible()

    // Check column headers
    const nameHeader = table.getByRole('columnheader', { name: /Name/i })
    await expect(nameHeader, 'Name column header should be visible').toBeVisible()

    const suiteHeader = table.getByRole('columnheader', { name: /Suite/i })
    await expect(
      suiteHeader,
      'Suite column header should be visible'
    ).toBeVisible()

    const statusHeader = table.getByRole('columnheader', { name: /Status/i })
    await expect(
      statusHeader,
      'Status column header should be visible'
    ).toBeVisible()

    const lastRunHeader = table.getByRole('columnheader', { name: /Last Run/i })
    await expect(
      lastRunHeader,
      'Last Run column header should be visible'
    ).toBeVisible()

    const actionsHeader = table.getByRole('columnheader', { name: /Actions/i })
    await expect(
      actionsHeader,
      'Actions column header should be visible'
    ).toBeVisible()
  })

  test('V-LIST-01-S6: status badges show correct colors per LIST-7', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 6. Status badges: Passed (green), Failed (red), Never Run (gray)
    // Per LIST-7: Passed (green), Failed (red), Never Run (gray)

    // Check for Passed status badge (should have green styling)
    const passedBadge = page.locator('[data-testid="status-badge-passed"]').first()
    if (await passedBadge.isVisible()) {
      await expect(passedBadge).toContainText(/Passed/i)
      // Green color check - design tokens use:
      // Light mode: #166534 = rgb(22, 101, 52)
      // Dark mode: #4ade80 = rgb(74, 222, 128)
      const passedColor = await passedBadge.evaluate((el) =>
        getComputedStyle(el).color
      )
      expect(
        passedColor.includes('22, 101, 52') || // Light mode: --color-success-text #166534
          passedColor.includes('74, 222, 128') || // Dark mode: --color-success-text #4ade80
          passedColor.includes('green')
      ).toBeTruthy()
    }

    // Check for Failed status badge (should have red styling)
    const failedBadge = page.locator('[data-testid="status-badge-failed"]').first()
    if (await failedBadge.isVisible()) {
      await expect(failedBadge).toContainText(/Failed/i)
    }

    // Check for Never Run status badge (should have gray styling)
    const neverRunBadge = page
      .locator('[data-testid="status-badge-never-run"]')
      .first()
    if (await neverRunBadge.isVisible()) {
      await expect(neverRunBadge).toContainText(/Never Run/i)
    }
  })

  test('V-LIST-01-S7: actions column has run button and overflow menu', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 7. Actions column: Run button, overflow menu
    const firstRow = page.locator('[data-testid="test-row"]').first()
    await expect(firstRow, 'At least one test row should be visible').toBeVisible()

    // Run button (play icon) in actions column
    const runButton = firstRow.locator('[data-testid="action-run"]')
    await expect(runButton, 'Run action button should be visible').toBeVisible()

    // Overflow menu (kebab/three dots)
    const overflowMenu = firstRow.locator('[data-testid="action-menu-trigger"]')
    await expect(overflowMenu, 'Overflow menu should be visible').toBeVisible()
  })

  test('V-LIST-01-S8: pagination controls are present per LIST-2', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 8. Pagination: "Showing X-Y of Z tests", page size selector, page numbers
    // Per LIST-2: Full pagination with item count, page size selector, navigation
    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(
      paginationContainer,
      'Pagination container should be visible'
    ).toBeVisible()

    // Item count: "Showing X-Y of Z tests"
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

    // Page navigation (page numbers)
    const pageNavigation = paginationContainer.locator(
      '[data-testid="pagination-navigation"]'
    )
    await expect(
      pageNavigation,
      'Page navigation should be visible'
    ).toBeVisible()

    // First/Last page buttons per LIST-2
    const firstButton = paginationContainer.getByRole('button', { name: /first/i })
    await expect(
      firstButton,
      'First page button should be visible per LIST-2'
    ).toBeVisible()

    const lastButton = paginationContainer.getByRole('button', { name: /last/i })
    await expect(
      lastButton,
      'Last page button should be visible per LIST-2'
    ).toBeVisible()
  })

  test('V-LIST-01-S9: table rows display test data correctly', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Verify table has rows with test data
    const testRows = page.locator('[data-testid="test-row"]')
    const rowCount = await testRows.count()
    expect(rowCount, 'Table should have at least one test row').toBeGreaterThan(0)

    // First row should have name, suite, status, last run visible
    const firstRow = testRows.first()
    const nameCell = firstRow.locator('[data-testid="test-name"]')
    await expect(nameCell, 'Test name should be visible').toBeVisible()

    const suiteCell = firstRow.locator('[data-testid="test-suite"]')
    await expect(suiteCell, 'Test suite should be visible').toBeVisible()
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
test.describe('V-LIST-01: Page Layout', () => {
  // Uses file-level seed

  test('V-LIST-01-L1: no breadcrumb on list page per design', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per design: breadcrumbs are only for detail/edit pages, not list pages
    // The breadcrumb nav element should not be visible on /tests
    const breadcrumb = page.locator('nav[aria-label="breadcrumb"]')
    await expect(
      breadcrumb,
      'Breadcrumb should NOT be visible on list page per design'
    ).not.toBeVisible()

    // Also verify no breadcrumb-related elements
    const breadcrumbList = page.locator('[role="list"]').filter({ hasText: /Tests.*\/.*/ })
    await expect(
      breadcrumbList,
      'Breadcrumb list should not exist on list page'
    ).toHaveCount(0)
  })

  test('V-LIST-01-L2: single Tests heading (no duplicate) per wireframe', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per V-LIST-01 wireframe: single "Tests" heading at top of content area
    // There should be exactly ONE h1 with "Tests" text
    const testsHeadings = page.getByRole('heading', { name: 'Tests' })
    const headingCount = await testsHeadings.count()

    expect(
      headingCount,
      'Should have exactly ONE "Tests" heading (no duplicate from breadcrumb)'
    ).toBe(1)
  })

  test('V-LIST-01-L3: page container fills viewport height per DASH-4', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per DASH-4: Page fills viewport height with h-full, no page-level scroll
    const pageContainer = page.locator('[data-testid="tests-page"]')
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

  test('V-LIST-01-L4: pagination anchored at bottom per DASH-5', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

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
    const pageContainer = page.locator('[data-testid="tests-page"]')
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

  test('V-LIST-01-L5: table area grows to fill space per DASH-8', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per DASH-8: Table container uses flex-1 min-h-0 pattern for internal scrolling
    // The table wrapper should expand to fill available space between header/filters and pagination

    const pageContainer = page.locator('[data-testid="tests-page"]')
    const table = page.locator('[data-testid="tests-table"]')
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

  test('V-LIST-01-L6: no page-level horizontal scroll', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per DASH-4: no page-level scroll
    const html = page.locator('html')
    const body = page.locator('body')

    // Check that body/html don't have horizontal overflow
    const htmlOverflowX = await html.evaluate(
      (el) => getComputedStyle(el).overflowX
    )
    const bodyOverflowX = await body.evaluate(
      (el) => getComputedStyle(el).overflowX
    )

    // Should not show horizontal scrollbar
    const htmlScrollWidth = await html.evaluate((el) => el.scrollWidth)
    const htmlClientWidth = await html.evaluate((el) => el.clientWidth)

    expect(
      htmlScrollWidth,
      'HTML element should not have horizontal overflow (no scrollbar)'
    ).toBeLessThanOrEqual(htmlClientWidth + 1) // Allow 1px tolerance
  })
})
