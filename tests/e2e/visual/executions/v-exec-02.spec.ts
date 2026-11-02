/**
 * V-EXEC-02: Regression Execution Detail
 *
 * REQ: REQ-5.2.1.40
 *
 * Pass Criteria:
 * 1. Execution Detail page renders for a regression execution.
 * 2. Components table shows suite parent rows (two suites).
 * 3. Test children are hidden by default (collapsed).
 * 4. Clicking a suite parent expands it and reveals its tests.
 * 5. Environment shows the name ("Local"), not the UUID.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const EXECUTION_ID = 'd0000002-0000-0000-0000-000000000002'
const SUITE_NAMES = ['Auth Suite', 'Checkout Suite']
const SUITE_1_TESTS = ['Login smoke', 'Logout smoke']

test.describe('V-EXEC-02: Regression Execution Detail', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-02/01-seed.sh')
  })

  async function waitForDetail(page: import('@playwright/test').Page) {
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })
  }

  test('V-EXEC-02-S1: components table lists both suite parent rows', async ({ page }) => {
    await waitForDetail(page)

    for (const name of SUITE_NAMES) {
      await expect(page.getByText(name, { exact: true }), `${name} parent row visible`).toBeVisible()
    }
  })

  test('V-EXEC-02-S2: suites are collapsed by default - tests hidden', async ({ page }) => {
    await waitForDetail(page)

    for (const name of SUITE_1_TESTS) {
      await expect(
        page.getByText(name, { exact: true }),
        `${name} child row hidden while suite collapsed`,
      ).toHaveCount(0)
    }
  })

  test('V-EXEC-02-S3: expanding a suite reveals its test children', async ({ page }) => {
    await waitForDetail(page)

    const authSuiteRow = page.getByRole('button').filter({ hasText: 'Auth Suite' })
    await authSuiteRow.click()

    for (const name of SUITE_1_TESTS) {
      await expect(
        page.getByText(name, { exact: true }),
        `${name} visible after expanding parent`,
      ).toBeVisible()
    }
  })

  test('V-EXEC-02-S4: environment shown as name not UUID, terminal toolbar', async ({ page }) => {
    await waitForDetail(page)

    const infoPanel = page.locator('[data-testid="execution-info-panel"]')
    await expect(infoPanel.getByText(/^Local$/), 'Environment shows name').toBeVisible()

    await expect(
      page.getByRole('button', { name: /re-run/i }),
      'Re-run visible for terminal state',
    ).toBeVisible()
  })
})
