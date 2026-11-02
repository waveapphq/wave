/**
 * V-EXEC-01: Suite Execution Detail
 *
 * REQ: REQ-5.2.1.40 (execution history / detail view)
 *
 * Pass Criteria:
 * 1. Execution Detail page renders with DetailHeader, EXECUTION INFO panel,
 *    Components table, and Console panel.
 * 2. Terminal-state toolbar shows Re-run / Export / Delete (no Stop or
 *    View Running).
 * 3. EXECUTION INFO shows Status = Passed, Environment name = "Local"
 *    (not the UUID), Totals are present.
 * 4. TAGS & DESCRIPTION section exists separately below EXECUTION INFO.
 * 5. Components table lists the suite's three tests.
 * 6. App-level breadcrumb is hidden (execution detail uses its own header).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const EXECUTION_ID = 'd0000001-0000-0000-0000-000000000001'
const EXPECTED_TEST_NAMES = ['Login Flow', 'User Profile Update', 'Password Reset']

test.describe('V-EXEC-01: Suite Execution Detail', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
  })

  async function waitForDetail(page: import('@playwright/test').Page) {
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })
  }

  test('V-EXEC-01-S1: renders header, info panel, table and console', async ({ page }) => {
    await waitForDetail(page)

    const header = page.getByRole('heading', { name: /Authentication Suite/ })
    await expect(header, 'DetailHeader shows the execution name').toBeVisible()

    const backBtn = page.locator('[data-testid="detail-back-btn"]')
    await expect(backBtn, 'Back button is present').toBeVisible()

    const infoPanel = page.locator('[data-testid="execution-info-panel"]')
    await expect(infoPanel, 'Execution info panel visible').toBeVisible()

    const console_ = page.locator('[data-testid="execution-console"]')
    await expect(console_, 'Console visible').toBeVisible()
  })

  test('V-EXEC-01-S2: terminal-state toolbar shows Re-run / Export / Delete', async ({ page }) => {
    await waitForDetail(page)

    await expect(
      page.getByRole('button', { name: /re-run/i }),
      'Re-run button visible in terminal state',
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /export/i }).first(),
      'Export button visible',
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /delete/i }),
      'Delete button visible in terminal state',
    ).toBeVisible()

    await expect(
      page.getByRole('button', { name: /^Stop$/ }),
      'Stop not visible in terminal state',
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /view running/i }),
      'View Running not visible in terminal state',
    ).toHaveCount(0)
  })

  test('V-EXEC-01-S3: EXECUTION INFO and TAGS & DESCRIPTION are separate sections', async ({ page }) => {
    await waitForDetail(page)

    const infoPanel = page.locator('[data-testid="execution-info-panel"]')
    await expect(infoPanel.getByText(/EXECUTION INFO/i), 'Main section title').toBeVisible()
    await expect(infoPanel.getByText(/TAGS & DESCRIPTION/i), 'Tags section title').toBeVisible()

    await expect(infoPanel.getByText(/^Local$/), 'Environment shows name not UUID').toBeVisible()
    await expect(infoPanel.getByText(/Passed/i).first(), 'Status badge visible').toBeVisible()
  })

  test('V-EXEC-01-S4: components table lists the suite tests', async ({ page }) => {
    await waitForDetail(page)

    for (const name of EXPECTED_TEST_NAMES) {
      await expect(page.getByText(name, { exact: true }), `${name} row visible`).toBeVisible()
    }
  })

  test('V-EXEC-01-S5: app-level breadcrumb is hidden on execution detail', async ({ page }) => {
    await waitForDetail(page)
    // Main layout hides the breadcrumb for /executions/... paths.
    const breadcrumbNav = page.getByRole('navigation', { name: /breadcrumb/i })
    await expect(breadcrumbNav, 'App breadcrumb hidden').toHaveCount(0)
  })

  test('V-EXEC-01-S6: Totals grid includes an Excluded row', async ({
    page,
  }) => {
    // `excluded` is a distinct status from `skipped`. The Execution
    // Detail info panel must surface it as
    // its own totals bucket so users can tell unselected tests apart
    // from mid-run terminations at a glance.
    await waitForDetail(page)
    const infoPanel = page.locator('[data-testid="execution-info-panel"]')
    await expect(infoPanel.getByText(/Excluded:/), 'Excluded totals row visible').toBeVisible()
  })

  test('V-EXEC-01-S7: Status filter exposes Excluded as a selectable option', async ({ page }) => {
    // The Status filter in the Execution Detail components table must
    // offer Excluded as an independent value so users can toggle it on
    // to see unselected tests.
    await waitForDetail(page)
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(statusFilter, 'Status filter button visible').toBeVisible()
    await statusFilter.click()
    await expect(
      page.getByRole('option', { name: /excluded/i }).first(),
      'Excluded option appears in the Status filter',
    ).toBeVisible()
  })

  test('V-EXEC-01-S8: the Components table has no "Components" h2 heading', async ({ page }) => {
    // The toolbar header already labels the Components table, so no h2 repeats it.
    await waitForDetail(page)
    await expect(
      page.getByRole('heading', { level: 2, name: /^Components$/ }),
      'no Components h2 heading is rendered',
    ).toHaveCount(0)
  })
})
