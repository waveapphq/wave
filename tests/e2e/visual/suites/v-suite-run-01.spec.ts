/**
 * V-SUITE-RUN-01: Run Button + Run Dialog on Suite Detail
 *
 * The existing tests/e2e/visual/executions/v-exec-01.spec.ts covers the
 * post-run Execution Detail page (a different surface); this spec covers the
 * pre-run Run dialog on the suite detail page.
 *
 * Fixture: tests/e2e/fixtures/suites/v-suite-run-01/01-seed.sh
 * Design Decisions: SUITE-21..SUITE-25, LISTRUN-1..LISTRUN-12
 * REQ: REQ-3.2.1.1, REQ-3.2.2.5, REQ-5.2.4.6
 *
 * Pass Criteria:
 * 1. Run button renders in the suite detail header (primary variant).
 * 2. Clicking opens the RunDialog with suite context in title + subtitle.
 * 3. Environment list renders the seeded "Local" env.
 * 4. Tests list renders one row per seeded test under the select-all row.
 * 5. Cancel closes the dialog without navigating away.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SUITE_ID = 'c0000031-0001-0001-0001-000000000001'
const EXPECTED_TESTS = [
  'Verify DB Connectivity',
  'Ping API Gateway',
  'Check Cache Availability',
]

test.describe('V-SUITE-RUN-01: Run dialog on Suite Detail', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/suites/v-suite-run-01/01-seed.sh')
  })

  async function openSuiteDetail(page: import('@playwright/test').Page) {
    await page.goto(`/suites/${SUITE_ID}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
  }

  test('V-SUITE-RUN-01-S1: Run button visible in header', async ({ page }) => {
    await openSuiteDetail(page)
    await expect(
      page.locator('[data-testid="suite-run-btn"]'),
      'Suite Run button rendered in detail header',
    ).toBeVisible()
  })

  test('V-SUITE-RUN-01-S2: Clicking Run opens the RunDialog for the suite', async ({
    page,
  }) => {
    await openSuiteDetail(page)
    await page.locator('[data-testid="suite-run-btn"]').click()

    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'RunDialog content visible').toBeVisible()
    await expect(
      dialog.locator('[data-testid="run-dialog-title-visible"]'),
      'Dialog title reads "Run Suite"',
    ).toHaveText('Run Suite')
    await expect(
      dialog.locator('[data-testid="run-dialog-subtitle"]'),
      'Dialog subtitle shows the suite name',
    ).toHaveText('Runnable Suite')
  })

  test('V-SUITE-RUN-01-S3: Environment list renders the seeded env', async ({
    page,
  }) => {
    await openSuiteDetail(page)
    await page.locator('[data-testid="suite-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    const allEnvs = page.locator('[data-testid="all-environments"]')
    await expect(allEnvs, 'All-environments list visible').toBeVisible()
    await expect(
      allEnvs.getByText(/^Local$/),
      'Seeded "Local" env listed by name (not UUID)',
    ).toBeVisible()
  })

  test('V-SUITE-RUN-01-S4: Tests list renders one row per seeded test', async ({
    page,
  }) => {
    await openSuiteDetail(page)
    await page.locator('[data-testid="suite-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    const testsList = page.locator('[data-testid="suite-tests-list"]')
    await expect(testsList, 'Suite tests list visible').toBeVisible()
    await expect(
      testsList.locator('[data-testid="run-dialog-test-item"]'),
      'One test row per seeded test',
    ).toHaveCount(EXPECTED_TESTS.length)
    for (const name of EXPECTED_TESTS) {
      await expect(
        testsList.getByText(name, { exact: true }),
        `${name} visible in the list`,
      ).toBeVisible()
    }
  })

  test('V-SUITE-RUN-01-S5: Cancel closes the dialog without navigating away', async ({
    page,
  }) => {
    await openSuiteDetail(page)
    const startingUrl = page.url()
    await page.locator('[data-testid="suite-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    await page.locator('[data-testid="run-dialog-cancel"]').click()
    await expect(
      page.locator('[data-testid="run-dialog-content"]'),
      'Dialog closed after Cancel',
    ).toHaveCount(0)
    expect(page.url(), 'URL unchanged after Cancel').toBe(startingUrl)
  })
})
