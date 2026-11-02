/**
 * V-REG-DETAIL-01: Regression Detail Page - Populated State
 *
 * Phase: fixture-dark (requires seeded data)
 * Fixture: fixtures/regression/v-reg-detail-01/01-seed.sh
 * REQ: REQ-5.2.1.37 Regression management
 *
 * Seeds: 1 regression ("Nightly Smoke") with 3 suites, 2 variables, 3 tags.
 *
 * Pass Criteria:
 * 1. Page layout: back button, regression name heading, sidebar visible
 * 2. Metadata sidebar shows name, description, tags
 * 3. Suites table displays suite entries
 * 4. Variables section displays variables
 * 5. Sidebar collapse/expand toggle works
 * 6. Edit buttons visible for details, variables, suites sections
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const REGRESSION_ID = 'd0000001-0001-0001-0001-000000000001'

async function waitForRegressionDetailLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="regression-detail-page"]', { state: 'visible' })
}

test.describe('V-REG-DETAIL-01: Regression Detail Populated', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/regression/v-reg-detail-01/01-seed.sh')
  })

  test('V-REG-DETAIL-01-S1: page layout with back button, heading, sidebar', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const backBtn = page.locator('[data-testid="detail-back-btn"]')
    await expect(backBtn, 'Back button should be visible').toBeVisible()

    await expect(
      page.getByRole('heading', { name: 'Nightly Smoke' }),
      'Regression name heading should be visible'
    ).toBeVisible()

    const sidebar = page.locator('[data-testid="regression-metadata-sidebar"]')
    await expect(sidebar, 'Metadata sidebar should be visible').toBeVisible()
  })

  test('V-REG-DETAIL-01-S2: metadata sidebar shows description, tags', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const sidebar = page.locator('[data-testid="regression-metadata-sidebar"]')

    await expect(sidebar).toContainText('Nightly smoke test regression')
    await expect(sidebar).toContainText('nightly')
    await expect(sidebar).toContainText('smoke')
    await expect(sidebar).toContainText('critical')
  })

  test('V-REG-DETAIL-01-S3: suites table displays suite entries', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const suitesTable = page.locator('[data-testid="regression-suites-table"]')
    await expect(suitesTable, 'Suites table should be visible').toBeVisible()

    await expect(suitesTable).toContainText('Infrastructure Suite')
    await expect(suitesTable).toContainText('Database Suite')
    await expect(suitesTable).toContainText('Security Suite')
  })

  test('V-REG-DETAIL-01-S4: variables section displays seeded variables', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const sidebar = page.locator('[data-testid="regression-metadata-sidebar"]')
    await expect(sidebar).toContainText('env_name')
    await expect(sidebar).toContainText('max_parallel')
  })

  test('V-REG-DETAIL-01-S5: sidebar collapse and expand toggle', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const sidebar = page.locator('[data-testid="regression-metadata-sidebar"]')
    await expect(sidebar).toBeVisible()

    const collapseBtn = page.locator('[data-testid="sidebar-collapse-btn"]')
    await collapseBtn.click()

    const toggleBtn = page.locator('[data-testid="sidebar-toggle-btn"]')
    await expect(toggleBtn).toBeVisible()

    await toggleBtn.click()
    await expect(sidebar).toBeVisible()
  })

  test('V-REG-DETAIL-01-S6: edit buttons visible for details and variables', async ({ page }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await waitForRegressionDetailLoad(page)

    const editDetailsBtn = page.locator('[data-testid="edit-details-btn"]')
    await expect(editDetailsBtn, 'Edit details button should be visible').toBeVisible()

    const editVarsBtn = page.locator('[data-testid="edit-variables-btn"]')
    await expect(editVarsBtn, 'Edit variables button should be visible').toBeVisible()
  })
})
