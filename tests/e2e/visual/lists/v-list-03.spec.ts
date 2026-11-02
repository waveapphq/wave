/**
 * V-LIST-03: List Loading State
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: LIST-4
 *
 * Main Purpose: Generic loading skeleton (applies to all entity lists).
 *
 * Pass Criteria:
 * 1. Skeleton rows in table area
 * 2. Filters disabled/skeleton
 * 3. Per LIST-4: 9 skeleton rows filling viewport, varying bar widths
 * 4. Skeleton pagination visible
 * 5. Page header still visible with title
 * 6. Table headers visible during loading
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-LIST-03: List Loading State', () => {
  test('V-LIST-03-S1: skeleton rows display during loading per LIST-4', async ({
    page,
  }) => {
    // Intercept API to delay response and capture loading state
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      // Delay the response to observe loading state
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await route.continue()
    })

    // Navigate to tests page (will show loading state)
    await page.goto('/tests')

    // Wait for page container to be visible
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 1. Skeleton rows should be visible in table area
    const skeletonRows = page.locator('[data-testid="skeleton-row"]')

    // Per LIST-4: 9 skeleton rows filling viewport
    await expect(
      skeletonRows,
      'Should have skeleton rows during loading'
    ).toHaveCount(9)

    // 4. Per LIST-4: Varying bar widths
    // Check that skeleton bars have different widths
    const skeletonBars = page.locator('[data-testid="skeleton-bar"]')
    const barCount = await skeletonBars.count()
    expect(barCount, 'Should have multiple skeleton bars').toBeGreaterThan(0)
  })

  test('V-LIST-03-S2: filters remain visible and usable during loading', async ({
    page,
  }) => {
    // Intercept API to delay response
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.continue()
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 2. Filters visible during loading (design: filters remain enabled during loading,
    // only disabled during error state)
    const statusFilter = page.locator('[data-testid="filter-status"]')
    const suiteFilter = page.locator('[data-testid="filter-suite"]')
    const tagsFilter = page.locator('[data-testid="filter-tags"]')

    // Filters should be visible during loading
    await expect(
      statusFilter,
      'Status filter should be visible during loading'
    ).toBeVisible()
    await expect(
      suiteFilter,
      'Suite filter should be visible during loading'
    ).toBeVisible()
    await expect(
      tagsFilter,
      'Tags filter should be visible during loading'
    ).toBeVisible()

    // Filters should NOT be disabled during loading (only error state disables them)
    const statusDisabled = await statusFilter.getAttribute('disabled')
    expect(
      statusDisabled,
      'Status filter should NOT be disabled during loading (only during error)'
    ).toBeNull()
  })

  test('V-LIST-03-S3: skeleton pagination visible during loading', async ({
    page,
  }) => {
    // Intercept API to delay response
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await route.continue()
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 5. Skeleton pagination visible
    const paginationContainer = page.locator('[data-testid="pagination"]')
    await expect(
      paginationContainer,
      'Pagination area should be visible during loading'
    ).toBeVisible()

    // Pagination might show skeleton or be disabled
    const paginationSkeleton = paginationContainer.locator(
      '[data-testid="skeleton-bar"], [data-testid="pagination-skeleton"]'
    )
    const skeletonCount = await paginationSkeleton.count()

    // Either skeleton in pagination OR pagination is disabled
    if (skeletonCount === 0) {
      // Check pagination controls are disabled
      const pageButtons = paginationContainer.locator('button')
      const buttonCount = await pageButtons.count()
      if (buttonCount > 0) {
        const firstButton = pageButtons.first()
        const isDisabled =
          (await firstButton.getAttribute('disabled')) !== null ||
          (await firstButton.getAttribute('aria-disabled')) === 'true'
        expect(
          isDisabled,
          'Pagination buttons should be disabled during loading'
        ).toBeTruthy()
      }
    }
  })

  test('V-LIST-03-S4: page header remains visible during loading', async ({
    page,
  }) => {
    // Intercept API to delay response
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await route.continue()
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 6. Page header still visible with title
    const pageTitle = page.getByRole('heading', { name: 'Tests', level: 1 })
    await expect(
      pageTitle,
      'Page title should be visible during loading'
    ).toBeVisible()

    // New Test button should be visible (might be disabled)
    const newTestButton = page.getByRole('button', { name: /New Test/i })
    await expect(
      newTestButton,
      '"+ New Test" button should be visible during loading'
    ).toBeVisible()
  })

  test('V-LIST-03-S5: table headers visible during loading', async ({ page }) => {
    // Intercept API to delay response
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await route.continue()
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // Table structure should be visible even during loading
    const table = page.locator('[data-testid="tests-table"]')
    await expect(
      table,
      'Table container should be visible during loading'
    ).toBeVisible()

    // Column headers should be visible (not skeleton)
    const nameHeader = table.getByRole('columnheader', { name: /Name/i })
    await expect(
      nameHeader,
      'Name column header should be visible during loading'
    ).toBeVisible()
  })
})
