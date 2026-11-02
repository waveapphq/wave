/**
 * V-SUITE-DETAIL-03: Suite Detail Page - Empty & Error States
 *
 * Phase: parallel-dark (no seeded data needed)
 * REQ: REQ-5.2.1.36 Suite management screen
 *
 * Pass Criteria:
 * 1. Error state when suite not found shows error message with retry button
 * 2. Empty suite (created via API, no tests) shows empty tests section
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'

const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

async function waitForSuiteDetailPage(page: import('@playwright/test').Page) {
  // Wait for either the loaded page or an error state
  await page.waitForSelector(
    '[data-testid="suite-detail-page"], [data-testid="suite-detail-error"]',
    { state: 'visible', timeout: 10000 }
  )
}

test.describe('V-SUITE-DETAIL-03: Suite Detail Empty & Error States', () => {
  test('V-SUITE-DETAIL-03-S1: error state when suite not found', async ({ page }) => {
    // Navigate to a non-existent suite ID
    await page.goto('/suites/00000000-0000-0000-0000-000000000000')
    await waitForSuiteDetailPage(page)

    // Error state should be visible
    const errorState = page.locator('[data-testid="suite-detail-error"]')
    await expect(errorState, 'Error state should be visible for missing suite').toBeVisible()

    // Should show an error message
    await expect(errorState).toContainText(/fail|error|not found/i)
  })

  test('V-SUITE-DETAIL-03-S2: empty suite shows empty tests section', async ({ page, request }) => {
    // Create an empty suite via API
    const createResponse = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: 'Empty Visual Test Suite',
        description: 'Suite with no tests for visual testing',
        tags: [],
      },
    })
    expect(createResponse.ok(), 'Suite creation should succeed').toBeTruthy()

    const body = await createResponse.json()
    const suiteId = body.data?.id ?? body.id

    // Navigate to the empty suite
    await page.goto(`/suites/${suiteId}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    // Suite name should be visible
    await expect(
      page.getByRole('heading', { name: 'Empty Visual Test Suite' })
    ).toBeVisible()

    // Empty tests section - DataTable shows empty state with message
    const testsTable = page.locator('[data-testid="suite-tests-table"]')
    await expect(testsTable, 'Tests table area should be visible').toBeVisible()
    await expect(testsTable).toContainText(/no tests/i)

    // Clean up: delete the suite
    await request.delete(`${BACKEND_URL}/suites/${suiteId}`)
  })
})
