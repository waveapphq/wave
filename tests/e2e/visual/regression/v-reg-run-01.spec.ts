/**
 * V-REG-RUN-01: Run Button + Run Dialog on Regression Detail
 *
 * The existing tests/e2e/visual/executions/v-exec-02.spec.ts covers the
 * post-run Execution Detail for a regression; this spec covers the pre-run Run
 * dialog on the regression detail page, including the duplicate-test badge for
 * a test that appears in multiple suites.
 *
 * Fixture: tests/e2e/fixtures/regression/v-reg-run-01/01-seed.sh
 * Design Decisions: REG-1..REG-22, LISTRUN-1..LISTRUN-12
 * REQ: REQ-3.2.1.1, REQ-3.2.2.5, REQ-5.2.4.6
 *
 * Pass Criteria:
 * 1. Run button renders in the regression detail header (primary variant).
 * 2. Clicking opens the RunDialog with regression context in title + subtitle.
 * 3. Two suite-group rows render (one per seeded suite, expanded by default).
 * 4. Expanding/collapsing a suite group toggles its test rows.
 * 5. Duplicate badge renders on the shared test row(s); absent on unique rows.
 * 6. Cancel closes the dialog without navigating away.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const REGRESSION_ID = 'a0000041-0000-0000-0000-000000000001'
const SUITE_AUTH_ID = 'c0000041-0001-0001-0001-000000000001'
const SUITE_CHECKOUT_ID = 'c0000042-0002-0002-0002-000000000002'
const SHARED_TEST_NAME = 'Shared Smoke Test'
const AUTH_ONLY_NAME = 'Auth Only Test'
const CHECKOUT_ONLY_NAME = 'Checkout Only Test'

test.describe('V-REG-RUN-01: Run dialog on Regression Detail', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/regression/v-reg-run-01/01-seed.sh')
  })

  async function openRegressionDetail(page: import('@playwright/test').Page) {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await page.waitForSelector('[data-testid="regression-detail-page"]', {
      state: 'visible',
    })
  }

  test('V-REG-RUN-01-S1: Run button visible in header', async ({ page }) => {
    await openRegressionDetail(page)
    await expect(
      page.locator('[data-testid="regression-run-btn"]'),
      'Regression Run button rendered in detail header',
    ).toBeVisible()
  })

  test('V-REG-RUN-01-S2: Clicking Run opens the RunDialog for the regression', async ({
    page,
  }) => {
    await openRegressionDetail(page)
    await page.locator('[data-testid="regression-run-btn"]').click()

    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog, 'RunDialog content visible').toBeVisible()
    await expect(
      dialog.locator('[data-testid="run-dialog-title-visible"]'),
      'Dialog title reads "Run Regression"',
    ).toHaveText('Run Regression')
    await expect(
      dialog.locator('[data-testid="run-dialog-subtitle"]'),
      'Dialog subtitle shows the regression name',
    ).toHaveText('Runnable Regression')
  })

  test('V-REG-RUN-01-S3: Two suite groups render', async ({ page }) => {
    await openRegressionDetail(page)
    await page.locator('[data-testid="regression-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    await expect(
      page.locator(`[data-testid="suite-group-${SUITE_AUTH_ID}"]`),
      'Auth Suite group row visible',
    ).toBeVisible()
    await expect(
      page.locator(`[data-testid="suite-group-${SUITE_CHECKOUT_ID}"]`),
      'Checkout Suite group row visible',
    ).toBeVisible()
  })

  test('V-REG-RUN-01-S4: Collapsing a suite group hides its test rows', async ({
    page,
  }) => {
    await openRegressionDetail(page)
    await page.locator('[data-testid="regression-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    const authGroup = page.locator(`[data-testid="suite-group-${SUITE_AUTH_ID}"]`)
    await expect(
      authGroup.getByText(AUTH_ONLY_NAME, { exact: true }),
      'Auth-only test visible while suite is expanded',
    ).toBeVisible()

    // Radix Collapsible keeps content in the DOM when closed (marked hidden);
    // use toBeHidden(), not toHaveCount(0), to assert the collapsed state. The
    // clickable trigger is the chevron inside the group header, not the header
    // wrapper itself.
    const authChevron = authGroup.locator('[data-testid="suite-group-chevron"]')
    await authChevron.click()
    await expect(
      authGroup.getByText(AUTH_ONLY_NAME, { exact: true }),
      'Auth-only test hidden after collapsing suite group',
    ).toBeHidden()

    await authChevron.click()
    await expect(
      authGroup.getByText(AUTH_ONLY_NAME, { exact: true }),
      'Auth-only test visible again after re-expanding',
    ).toBeVisible()
  })

  test('V-REG-RUN-01-S5: Duplicate badge marks the shared test, not the unique ones', async ({
    page,
  }) => {
    await openRegressionDetail(page)
    await page.locator('[data-testid="regression-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    const authGroup = page.locator(`[data-testid="suite-group-${SUITE_AUTH_ID}"]`)
    const checkoutGroup = page.locator(
      `[data-testid="suite-group-${SUITE_CHECKOUT_ID}"]`,
    )

    const sharedRowInAuth = authGroup
      .locator('[data-testid="run-dialog-test-item"]')
      .filter({ hasText: SHARED_TEST_NAME })
    const sharedRowInCheckout = checkoutGroup
      .locator('[data-testid="run-dialog-test-item"]')
      .filter({ hasText: SHARED_TEST_NAME })

    await expect(
      sharedRowInAuth.locator('[data-testid="duplicate-test-badge"]'),
      'Shared test (Auth suite instance) shows duplicate badge',
    ).toBeVisible()
    await expect(
      sharedRowInCheckout.locator('[data-testid="duplicate-test-badge"]'),
      'Shared test (Checkout suite instance) shows duplicate badge',
    ).toBeVisible()

    const authOnlyRow = authGroup
      .locator('[data-testid="run-dialog-test-item"]')
      .filter({ hasText: AUTH_ONLY_NAME })
    const checkoutOnlyRow = checkoutGroup
      .locator('[data-testid="run-dialog-test-item"]')
      .filter({ hasText: CHECKOUT_ONLY_NAME })
    await expect(
      authOnlyRow.locator('[data-testid="duplicate-test-badge"]'),
      'Auth-only test has no duplicate badge',
    ).toHaveCount(0)
    await expect(
      checkoutOnlyRow.locator('[data-testid="duplicate-test-badge"]'),
      'Checkout-only test has no duplicate badge',
    ).toHaveCount(0)
  })

  test('V-REG-RUN-01-S6: Cancel closes the dialog without navigating away', async ({
    page,
  }) => {
    await openRegressionDetail(page)
    const startingUrl = page.url()
    await page.locator('[data-testid="regression-run-btn"]').click()
    await expect(page.locator('[data-testid="run-dialog-content"]')).toBeVisible()

    await page.locator('[data-testid="run-dialog-cancel"]').click()
    await expect(
      page.locator('[data-testid="run-dialog-content"]'),
      'Dialog closed after Cancel',
    ).toHaveCount(0)
    expect(page.url(), 'URL unchanged after Cancel').toBe(startingUrl)
  })
})
