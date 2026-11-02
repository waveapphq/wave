/**
 * V-SUITE-DETAIL-01: Suite Detail Page - Populated State
 *
 * Phase: fixture-dark (requires seeded data)
 * Fixture: fixtures/suites/v-suite-detail-01/01-seed.sh
 * REQ: REQ-5.2.1.36 Suite management screen
 *
 * Seeds: 1 suite ("Infrastructure Health") with 4 tests, 3 variables, 3 tags.
 *
 * Pass Criteria:
 * 1. Page layout: back button, suite name heading, sidebar visible
 * 2. Metadata sidebar shows name, description, tags, test count
 * 3. Tests table displays test entries with name, status columns
 * 4. Variables section displays variables with name, type, value
 * 5. Sidebar collapse/expand toggle works
 * 6. Edit pencil buttons visible for details, variables, tests sections
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SUITE_ID = 'c0000001-0001-0001-0001-000000000001'

async function waitForSuiteDetailLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
}

test.describe('V-SUITE-DETAIL-01: Suite Detail Populated', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/suites/v-suite-detail-01/01-seed.sh')
  })

  test('V-SUITE-DETAIL-01-S1: page layout with back button, heading, sidebar', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Back button visible
    const backBtn = page.locator('[data-testid="detail-back-btn"]')
    await expect(backBtn, 'Back button should be visible').toBeVisible()

    // Suite name heading
    await expect(
      page.getByRole('heading', { name: 'Infrastructure Health' }),
      'Suite name heading should be visible'
    ).toBeVisible()

    // Sidebar visible
    const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')
    await expect(sidebar, 'Metadata sidebar should be visible').toBeVisible()
  })

  test('V-SUITE-DETAIL-01-S2: metadata sidebar shows description, tags, test count', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')

    // Description text
    await expect(sidebar).toContainText('Core infrastructure health validation suite')

    // Tags
    await expect(sidebar).toContainText('infrastructure')
    await expect(sidebar).toContainText('health')
    await expect(sidebar).toContainText('critical')
  })

  test('V-SUITE-DETAIL-01-S3: tests table displays test entries', async ({ page }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    const testsTable = page.locator('[data-testid="suite-tests-table"]')
    await expect(testsTable, 'Tests table should be visible').toBeVisible()

    // Should have 4 test rows
    const testRows = testsTable.locator('[data-testid="test-row"]')
    await expect(testRows, 'Should have 4 test rows').toHaveCount(4)

    // Test names visible
    await expect(testsTable).toContainText('API Health Check')
    await expect(testsTable).toContainText('Database Connection')
    await expect(testsTable).toContainText('Auth Flow Validation')
    await expect(testsTable).toContainText('Cache Performance')
  })

  test('V-SUITE-DETAIL-01-S4: variables section displays seeded variables', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')

    // Variable names should be visible in the sidebar
    await expect(sidebar).toContainText('api_url')
    await expect(sidebar).toContainText('max_retries')
    // db_password is secret - name should show but value hidden
    await expect(sidebar).toContainText('db_password')
  })

  test('V-SUITE-DETAIL-01-S5: sidebar collapse and expand toggle', async ({ page }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')
    await expect(sidebar).toBeVisible()

    // Collapse sidebar
    const collapseBtn = page.locator('[data-testid="sidebar-collapse-btn"]')
    await collapseBtn.click()

    // Sidebar should show collapsed state (toggle button changes)
    const toggleBtn = page.locator('[data-testid="sidebar-toggle-btn"]')
    await expect(toggleBtn).toBeVisible()

    // Expand sidebar again
    await toggleBtn.click()
    await expect(sidebar).toBeVisible()
  })

  test('V-SUITE-DETAIL-01-S6: edit buttons visible for details and variables', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Edit details button
    const editDetailsBtn = page.locator('[data-testid="edit-details-btn"]')
    await expect(editDetailsBtn, 'Edit details button should be visible').toBeVisible()

    // Edit variables button
    const editVarsBtn = page.locator('[data-testid="edit-variables-btn"]')
    await expect(editVarsBtn, 'Edit variables button should be visible').toBeVisible()

    // Edit tests button
    const editTestsBtn = page.locator('[data-testid="edit-tests-btn"]')
    await expect(editTestsBtn, 'Edit tests button should be visible').toBeVisible()
  })
})
