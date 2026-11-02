/**
 * V-LIST-08: Suites List Empty
 *
 * REQ: REQ-5.2.1.36
 * Design Decisions: LIST-6
 *
 * Main Purpose: Empty state with call-to-action.
 *
 * Pass Criteria:
 * 1. Empty state illustration/icon (folder icon per wireframe - FolderKanban)
 * 2. "No suites yet" message
 * 3. "Create Your First Suite" CTA button with primary styling
 * 4. Per LIST-6: Entity-specific icon, encouraging message, primary CTA
 * 5. Filters are visible but muted
 * 6. No table rows visible
 * 7. Columns button visible, Mass Action hidden in empty state
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

// Helper to wait for suites page to load (empty state)
async function waitForSuitesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suites-page"]', { state: 'visible' })
  // Wait for loading to complete (aria-busy becomes false)
  await page.waitForSelector('[data-testid="suites-page"][aria-busy="false"]', {
    state: 'attached',
    timeout: 10000,
  })
}

test.describe('V-LIST-08: Suites List Empty', () => {
  // Mock API to return empty data to ensure test isolation
  // This allows tests to verify empty state behavior regardless of actual database contents
  test.beforeEach(async ({ page }) => {
    // Mock suites API to return empty list
    await page.route(`**/localhost:${BACKEND_PORT}/suites**`, async (route) => {
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
  })

  test('V-LIST-08-S1: empty state displays icon and message per LIST-6', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 1. Empty state illustration/icon (folder per wireframe)
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

    // 2. "No suites yet" message
    const emptyStateTitle = emptyStateContainer.locator(
      '[data-testid="empty-state-title"]'
    )
    await expect(emptyStateTitle, 'Empty state title should be visible').toBeVisible()
    await expect(emptyStateTitle).toContainText(/No suites yet/i)
  })

  test('V-LIST-08-S2: empty state has encouraging description per LIST-6', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Per LIST-6: Encouraging message
    const emptyStateDescription = page.locator(
      '[data-testid="empty-state-description"]'
    )
    await expect(
      emptyStateDescription,
      'Empty state description should be visible'
    ).toBeVisible()
  })

  test('V-LIST-08-S3: empty state has primary CTA button per LIST-6', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 3. "Create Your First Suite" CTA button
    // Per LIST-6: Primary CTA
    const ctaButton = page.getByRole('button', {
      name: /Create Your First Suite|Create Suite/i,
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

  test('V-LIST-08-S4: filters are visible in empty state', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 5. Filters are visible but muted
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter should be visible even in empty state'
    ).toBeVisible()

    const tagsFilter = page.locator('[data-testid="filter-tags"]')
    await expect(
      tagsFilter,
      'Tags filter should be visible even in empty state'
    ).toBeVisible()
  })

  test('V-LIST-08-S5: no table rows in empty state', async ({ page }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // 6. No table rows visible
    const tableRows = page.locator('[data-testid="suites-table"] tbody tr')
    const rowCount = await tableRows.count()
    expect(rowCount, 'Table should have no data rows').toBe(0)
  })

  test('V-LIST-08-S6: page header still shows title and New Suite button', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

    // Page title should still be "Suites"
    const pageTitle = page.getByRole('heading', { name: 'Suites', level: 1 })
    await expect(pageTitle, 'Page title should be "Suites"').toBeVisible()

    // "+ New Suite" button should still be visible
    const newSuiteButton = page.getByRole('button', { name: /New Suite/i })
    await expect(
      newSuiteButton,
      '"+ New Suite" button should be visible'
    ).toBeVisible()
  })

  test('V-LIST-08-S7: Columns button visible but Mass Action hidden in empty state', async ({
    page,
  }) => {
    await page.goto('/suites')
    await waitForSuitesPageLoad(page)

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
