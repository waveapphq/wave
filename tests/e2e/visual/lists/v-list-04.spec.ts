/**
 * V-LIST-04: List Error State
 *
 * REQ: REQ-5.2.1.35
 * Design Decisions: LIST-5
 *
 * Main Purpose: Generic error state (applies to all entity lists).
 *
 * Pass Criteria:
 * 1. Error message displayed
 * 2. "Try Again" button available
 * 3. Maintains page layout structure
 * 4. Per LIST-5: Empathetic tone ("Unable to load X"), red alert icon
 * 5. Filters appear disabled/muted
 * 6. Page header still visible with title
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-LIST-04: List Error State', () => {
  test('V-LIST-04-S1: error message displays with empathetic tone per LIST-5', async ({
    page,
  }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 1. Error message displayed
    const errorContainer = page.locator('[data-testid="error-state"]')
    await expect(
      errorContainer,
      'Error state container should be visible'
    ).toBeVisible()

    // Per LIST-5: Empathetic tone ("Unable to load X")
    const errorTitle = errorContainer.locator('[data-testid="error-state-title"]')
    await expect(errorTitle, 'Error title should be visible').toBeVisible()
    await expect(errorTitle).toContainText(/Unable to load|Something went wrong/i)

    // Error description with empathetic message
    const errorDescription = errorContainer.locator(
      '[data-testid="error-state-description"]'
    )
    await expect(
      errorDescription,
      'Error description should be visible'
    ).toBeVisible()
    await expect(errorDescription).toContainText(/try again|please try/i)
  })

  test('V-LIST-04-S2: red alert icon visible per LIST-5', async ({ page }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 4. Per LIST-5: Red alert icon
    const errorContainer = page.locator('[data-testid="error-state"]')
    await expect(errorContainer).toBeVisible()

    // Error icon should be visible (warning triangle per wireframe)
    const errorIcon = errorContainer.locator('[data-testid="error-state-icon"]')
    await expect(errorIcon, 'Error icon should be visible').toBeVisible()

    // Check for red/error color on icon
    const iconColor = await errorIcon.evaluate((el) => {
      const style = getComputedStyle(el)
      return style.color || style.fill
    })

    // Should have red/error color (various red shades)
    const hasRedColor =
      iconColor.includes('239, 68, 68') || // red-500
      iconColor.includes('220, 38, 38') || // red-600
      iconColor.includes('248, 113, 113') || // red-400
      iconColor.includes('red') ||
      iconColor.includes('f87171') || // red-400 hex
      iconColor.includes('ef4444') // red-500 hex

    expect(hasRedColor, 'Error icon should have red color').toBeTruthy()
  })

  test('V-LIST-04-S3: Try Again button available and functional', async ({
    page,
  }) => {
    let apiCallCount = 0

    // Intercept API to return error initially
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      apiCallCount++
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 2. "Try Again" button available
    const tryAgainButton = page.getByRole('button', { name: /Try Again/i })
    await expect(
      tryAgainButton,
      '"Try Again" button should be visible'
    ).toBeVisible()
    await expect(
      tryAgainButton,
      '"Try Again" button should be enabled'
    ).toBeEnabled()

    // Click should trigger retry (API call)
    const initialCallCount = apiCallCount
    await tryAgainButton.click()

    // Wait a moment for the retry to be triggered
    await page.waitForTimeout(500)

    // Verify retry was attempted (API was called again)
    expect(
      apiCallCount,
      'Clicking Try Again should trigger API retry'
    ).toBeGreaterThan(initialCallCount)
  })

  test('V-LIST-04-S4: page layout structure maintained during error', async ({
    page,
  }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 3. Maintains page layout structure
    // 6. Page header still visible with title
    const pageTitle = page.getByRole('heading', { name: 'Tests', level: 1 })
    await expect(
      pageTitle,
      'Page title should be visible during error'
    ).toBeVisible()

    // New Test button should be visible in header
    const newTestButton = page.getByRole('button', { name: /New Test/i })
    await expect(
      newTestButton,
      '"+ New Test" button should be visible during error'
    ).toBeVisible()

    // Page container structure maintained
    const pageContainer = page.locator('[data-testid="tests-page"]')
    await expect(pageContainer).toBeVisible()
  })

  test('V-LIST-04-S5: filters appear disabled during error state', async ({
    page,
  }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // 5. Filters appear disabled/muted
    const filterSection = page.locator('[data-testid="filters-section"]')
    await expect(
      filterSection,
      'Filter section should be visible during error'
    ).toBeVisible()

    // Status filter should be visible but disabled
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(
      statusFilter,
      'Status filter should be visible during error'
    ).toBeVisible()

    // Check if disabled via attribute, aria-disabled, or visual indication
    const isStatusDisabled =
      (await statusFilter.getAttribute('disabled')) !== null ||
      (await statusFilter.getAttribute('aria-disabled')) === 'true' ||
      (await statusFilter.getAttribute('data-disabled')) === 'true' ||
      (await statusFilter.locator('button, select').getAttribute('disabled')) !==
        null

    expect(
      isStatusDisabled,
      'Status filter should be disabled during error'
    ).toBeTruthy()
  })

  test('V-LIST-04-S6: no table or table rows visible during error', async ({
    page,
  }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // Table and test rows should not be visible during error
    const testRows = page.locator('[data-testid="test-row"]')
    await expect(
      testRows,
      'No test rows should be visible during error'
    ).toHaveCount(0)

    // Error state should replace table content
    const errorState = page.locator('[data-testid="error-state"]')
    await expect(
      errorState,
      'Error state should be visible instead of table'
    ).toBeVisible()
  })

  test('V-LIST-04-S7: Columns button may be visible but disabled', async ({
    page,
  }) => {
    // Intercept API to return error
    await page.route(`**/localhost:${BACKEND_PORT}/tests**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    // Per wireframe: Columns button may be visible but disabled
    const columnsButton = page.getByRole('button', { name: /Columns/i })

    if (await columnsButton.isVisible()) {
      // If visible, it should be disabled
      const isDisabled =
        (await columnsButton.getAttribute('disabled')) !== null ||
        (await columnsButton.getAttribute('aria-disabled')) === 'true'

      expect(
        isDisabled,
        'Columns button should be disabled during error'
      ).toBeTruthy()
    }
  })
})
