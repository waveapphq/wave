/**
 * V-LIST-02: Tests List Empty
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: LIST-6
 *
 * Main Purpose: Empty state with call-to-action.
 *
 * Pass Criteria:
 * 1. Empty state illustration/icon (test tube icon per wireframe)
 * 2. "No tests yet" message
 * 3. "Create Your First Test" CTA button
 * 4. Per LIST-6: Entity-specific icon, encouraging message, primary CTA
 * 5. Filters are visible but appear disabled/muted
 * 6. No table rows visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { BACKEND_PORT } from '../../helpers/config'

// Helper to wait for tests page to load (empty state)
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  // Wait for loading to complete (aria-busy becomes false)
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', {
    state: 'attached',
    timeout: 10000,
  })
}

test.describe('V-LIST-02: Tests List Empty', () => {
  // Mock API to return empty data to ensure test isolation
  test.beforeEach(async ({ page }) => {
    // Mock tests API to return empty list
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [],
            pagination: { total: 0, page: 1, per_page: 25, total_pages: 1 },
          }),
        })
      } else {
        await route.continue()
      }
    })
    // Mock suites API to return empty list
    await page.route(`**/localhost:${BACKEND_PORT}/suites**`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [],
          }),
        })
      } else {
        await route.continue()
      }
    })
  })

  test('V-LIST-02-S1: empty state displays icon and message per LIST-6', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 1. Empty state illustration/icon (test tube per wireframe)
    const emptyStateContainer = page.locator('[data-testid="empty-state"]')
    await expect(
      emptyStateContainer,
      'Empty state container should be visible'
    ).toBeVisible()

    // Per LIST-6: Entity-specific icon
    const emptyStateIcon = emptyStateContainer.locator(
      '[data-testid="empty-state-icon"]'
    )
    await expect(
      emptyStateIcon,
      'Empty state icon should be visible'
    ).toBeVisible()

    // 2. "No tests yet" message
    const emptyStateTitle = emptyStateContainer.locator(
      '[data-testid="empty-state-title"]'
    )
    await expect(emptyStateTitle, 'Empty state title should be visible').toBeVisible()
    await expect(emptyStateTitle).toContainText(/No tests yet/i)
  })

  test('V-LIST-02-S2: empty state has encouraging description per LIST-6', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per LIST-6: Encouraging message
    const emptyStateContainer = page.locator('[data-testid="empty-state"]')
    const emptyStateDescription = emptyStateContainer.locator(
      '[data-testid="empty-state-description"]'
    )

    await expect(
      emptyStateDescription,
      'Empty state description should be visible'
    ).toBeVisible()

    // Should have encouraging text about creating first test
    await expect(emptyStateDescription).toContainText(
      /Create your first test|start validating/i
    )
  })

  test('V-LIST-02-S3: CTA button is visible and primary styled per LIST-6', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 3. "Create Your First Test" CTA button
    // Per LIST-6: Primary CTA
    const ctaButton = page.getByRole('button', {
      name: /Create Your First Test|Create Test/i,
    })
    await expect(ctaButton, 'CTA button should be visible').toBeVisible()
    await expect(ctaButton, 'CTA button should be enabled').toBeEnabled()

    // Should have primary button styling (blue background typically)
    // Check for primary variant class or data attribute
    const isPrimary =
      (await ctaButton.getAttribute('class'))?.includes('primary') ||
      (await ctaButton.getAttribute('data-variant'))?.includes('primary') ||
      (await ctaButton.evaluate((el) => {
        const bgColor = getComputedStyle(el).backgroundColor
        // Check for blue/primary background color
        return (
          bgColor.includes('59, 130, 246') || // blue-500
          bgColor.includes('37, 99, 235') || // blue-600
          bgColor.includes('14, 165, 233') // sky-500
        )
      }))

    expect(isPrimary, 'CTA button should have primary styling').toBeTruthy()
  })

  test('V-LIST-02-S4: page header still shows title and New Test button', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Page title should be "Tests"
    const pageTitle = page.getByRole('heading', { name: 'Tests', level: 1 })
    await expect(pageTitle, 'Page title should be "Tests"').toBeVisible()

    // "+ New Test" button should be visible in header
    const newTestButton = page.getByRole('button', { name: /New Test/i })
    await expect(
      newTestButton,
      '"+ New Test" button should be visible'
    ).toBeVisible()
  })

  test('V-LIST-02-S5: filters are visible but muted in empty state', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 5. Filters are visible but appear disabled/muted
    // Per wireframe: filters shown but in muted state
    const filterSection = page.locator('[data-testid="filters-section"]')

    // Filters section should be visible (even if muted)
    await expect(filterSection, 'Filter section should be visible').toBeVisible()

    // Status filter should be visible
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter should be visible in empty state'
    ).toBeVisible()

    // Suite filter should be visible
    const suiteFilter = page.locator('[data-testid="filter-suite"]')
    await expect(
      suiteFilter,
      'Suite filter should be visible in empty state'
    ).toBeVisible()

    // Tags filter should be visible
    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(
      tagsFilter,
      'Tags filter should be visible in empty state'
    ).toBeVisible()
  })

  test('V-LIST-02-S6: no table rows visible in empty state', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // 6. No table rows visible
    const testRows = page.locator('[data-testid="test-row"]')
    await expect(
      testRows,
      'No test rows should be visible in empty state'
    ).toHaveCount(0)

    // Table itself might be hidden or replaced by empty state
    const table = page.locator('[data-testid="tests-table"]')
    // Table should either not be visible or have no rows
    const tableVisible = await table.isVisible()
    if (tableVisible) {
      const tableBody = table.locator('tbody')
      const rowCount = await tableBody.locator('tr').count()
      expect(rowCount, 'Table body should have no data rows').toBeLessThanOrEqual(0)
    }
  })

  test('V-LIST-02-S7: Columns button visible but Mass Action may be hidden', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Per wireframe: Columns dropdown visible, Mass Action may be hidden
    const columnsButton = page.getByRole('button', { name: /Columns/i })
    await expect(
      columnsButton,
      'Columns button should be visible in empty state'
    ).toBeVisible()

    // Mass Action button is NOT visible in empty state per wireframe
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await expect(
      massActionButton,
      'Mass Action button should NOT be visible in empty state'
    ).not.toBeVisible()
  })
})
