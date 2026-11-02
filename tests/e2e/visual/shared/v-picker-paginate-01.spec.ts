/**
 * V-PICKER-PAGINATE-01: EntityPickerModal - Pagination & Error Surfacing
 *
 * Phase: fixture (requires seeded data)
 * Fixture: fixtures/shared/v-picker-paginate-01/01-seed.sh
 * Design Decisions: PICKER-1, PICKER-2, PICKER-3, PICKER-4, PICKER-5
 *
 * Pass Criteria:
 * 1. Suite test picker first page renders exactly 25 rows; the nudge
 *    "60 tests - refine your search to narrow down" renders below the list,
 *    left-aligned (not centered).
 * 2. Scrolling near the bottom auto-loads the next page; a bottom-center
 *    "Loading…" pill overlays the rows while the page is in flight; rows
 *    append 25 -> 50 -> 60 without replacing page-1 rows; the nudge hides
 *    once all rows are loaded.
 * 3. Regression suite picker paginates identically; nudge uses "suites".
 * 4. Page-1 failure renders the shared ListErrorState (not the silent
 *    empty state) for both pickers; Try Again reloads the rows.
 * 5. Load-more failure keeps loaded rows and swaps the pill to the
 *    "Try Again" retry; clicking it appends page 2.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SUITE_ID = 'e8000001-0001-0001-0001-000000000001'
const REGRESSION_ID = 'e8000002-0001-0001-0001-000000000001'

const NUDGE_TESTS = '60 tests - refine your search to narrow down'
const NUDGE_SUITES = '60 suites - refine your search to narrow down'

// Only the picker requests /tests or /suites with per_page=25; the detail
// pages themselves load via fetchSuiteDetail / fetchRegressionDetail.
const isTestsPickerRequest = (url: URL): boolean =>
  url.pathname === '/tests' && url.searchParams.get('per_page') === '25'
const isTestsPickerPage2 = (url: URL): boolean =>
  isTestsPickerRequest(url) && url.searchParams.get('page') === '2'
const isSuitesPickerRequest = (url: URL): boolean =>
  url.pathname === '/suites' && url.searchParams.get('per_page') === '25'

const fail500 = {
  status: 500,
  contentType: 'application/json',
  body: '{"detail":"boom"}',
}

async function openTestPicker(page: Page): Promise<void> {
  await page.goto(`/suites/${SUITE_ID}`)
  await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="edit-tests-btn"]').click()
  await page.locator('[data-testid="add-tests-button"]').click()
  await expect(page.locator('[data-testid="test-picker-modal"]')).toBeVisible({ timeout: 10000 })
}

async function openSuitePicker(page: Page): Promise<void> {
  await page.goto(`/regressions/${REGRESSION_ID}`)
  await expect(page.locator('[data-testid="regression-detail-page"]')).toBeVisible({
    timeout: 15000,
  })
  await expect(page.locator('[data-testid="regression-detail-loading"]')).toHaveCount(0)
  await page.locator('[data-testid="edit-suites-btn"]').click()
  await page.locator('[data-testid="add-suites-btn"]').click()
  await expect(page.locator('[data-testid="suite-picker-modal"]')).toBeVisible({ timeout: 10000 })
}

async function scrollListToBottom(page: Page, listTestId: string): Promise<void> {
  await page.locator(`[data-testid="${listTestId}"]`).evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
}

test.describe('V-PICKER-PAGINATE-01: EntityPickerModal pagination & errors', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/shared/v-picker-paginate-01/01-seed.sh')
  })

  test('first page renders 25 rows with the refine nudge below the list, left-aligned', async ({
    page,
  }) => {
    await openTestPicker(page)
    const modal = page.locator('[data-testid="test-picker-modal"]')
    const rows = modal.locator('[data-testid="test-picker-test-row"]')

    // Per PICKER-1: exactly one page of 25 rows on open
    await expect(rows).toHaveCount(25, { timeout: 10000 })

    // Per PICKER-3: refine nudge with the total, exact copy
    const nudge = modal.getByText(NUDGE_TESTS, { exact: true })
    await expect(nudge).toBeVisible()

    // The nudge sits below the list container and is left-aligned with it
    const listBox = await page.locator('[data-testid="test-picker-list"]').boundingBox()
    const nudgeBox = await nudge.boundingBox()
    expect(listBox).not.toBeNull()
    expect(nudgeBox).not.toBeNull()
    expect(nudgeBox!.y).toBeGreaterThan(listBox!.y + listBox!.height - 1)
    expect(Math.abs(nudgeBox!.x - listBox!.x)).toBeLessThanOrEqual(2)
  })

  test('scroll auto-loads pages with a bottom-center Loading pill; rows append 25 -> 50 -> 60', async ({
    page,
  }) => {
    await openTestPicker(page)
    const modal = page.locator('[data-testid="test-picker-modal"]')
    const rows = modal.locator('[data-testid="test-picker-test-row"]')
    await expect(rows).toHaveCount(25, { timeout: 10000 })
    const firstRowText = await rows.first().innerText()

    // Hold the page-2 response so the in-flight "Loading…" pill is observable
    let releasePage2!: () => void
    const page2Gate = new Promise<void>((resolve) => {
      releasePage2 = resolve
    })
    await page.route(isTestsPickerPage2, async (route) => {
      await page2Gate
      await route.continue()
    })

    await scrollListToBottom(page, 'test-picker-list')

    // Per PICKER-2: pill with exactly "Loading…" (single ellipsis character),
    // floating bottom-center over the list rows
    const pill = modal.getByText('Loading…', { exact: true })
    await expect(pill).toBeVisible()
    const listBox = await page.locator('[data-testid="test-picker-list"]').boundingBox()
    const pillBox = await pill.boundingBox()
    expect(listBox).not.toBeNull()
    expect(pillBox).not.toBeNull()
    const listCenterX = listBox!.x + listBox!.width / 2
    const pillCenterX = pillBox!.x + pillBox!.width / 2
    expect(Math.abs(pillCenterX - listCenterX)).toBeLessThanOrEqual(3)
    const listBottom = listBox!.y + listBox!.height
    const pillBottom = pillBox!.y + pillBox!.height
    expect(pillBottom).toBeLessThanOrEqual(listBottom)
    expect(pillBottom).toBeGreaterThanOrEqual(listBottom - 40)

    releasePage2()
    await expect(rows).toHaveCount(50, { timeout: 10000 })
    await page.unroute(isTestsPickerPage2)

    await scrollListToBottom(page, 'test-picker-list')
    await expect(rows).toHaveCount(60, { timeout: 10000 })

    // Rows appended, not replaced: the original first row is unchanged
    expect(await rows.first().innerText()).toBe(firstRowText)

    // All 60 of 60 loaded: the refine nudge hides
    await expect(modal.getByText(NUDGE_TESTS, { exact: true })).toHaveCount(0)
  })

  test('regression suite picker paginates with the "suites" plural nudge', async ({
    page,
  }) => {
    await openSuitePicker(page)
    const modal = page.locator('[data-testid="suite-picker-modal"]')
    const rows = modal.locator('[data-testid="suite-picker-suite-row"]')
    await expect(rows).toHaveCount(25, { timeout: 10000 })
    await expect(modal.getByText(NUDGE_SUITES, { exact: true })).toBeVisible()

    // Same infinite-scroll behavior on the suites consumer (PICKER-5)
    await scrollListToBottom(page, 'suite-picker-list')
    await expect(rows).toHaveCount(50, { timeout: 10000 })
  })

  test('page-1 failure shows ListErrorState in the test picker; Try Again reloads', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 15000 })
    await page.locator('[data-testid="edit-tests-btn"]').click()

    await page.route(isTestsPickerRequest, (route) => route.fulfill(fail500))
    await page.locator('[data-testid="add-tests-button"]').click()
    const modal = page.locator('[data-testid="test-picker-modal"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    // Per PICKER-4: the shared ListErrorState, never the silent empty state
    await expect(modal.locator('[data-testid="error-state"]')).toBeVisible({ timeout: 10000 })
    await expect(modal.locator('[data-testid="error-state-title"]')).toHaveText(
      'Unable to load tests',
    )
    await expect(modal.locator('[data-testid="error-state-description"]')).toHaveText(
      'Something went wrong while loading. Please try again.',
    )
    await expect(modal.locator('[data-testid="test-picker-empty"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="test-picker-test-row"]')).toHaveCount(0)

    // Try Again refetches and renders the rows
    await page.unroute(isTestsPickerRequest)
    await modal.getByRole('button', { name: 'Try Again' }).click()
    await expect(modal.locator('[data-testid="test-picker-test-row"]')).toHaveCount(25, {
      timeout: 10000,
    })
    await expect(modal.locator('[data-testid="error-state"]')).toHaveCount(0)
  })

  test('page-1 failure shows ListErrorState in the suite picker; Try Again reloads', async ({
    page,
  }) => {
    await page.goto(`/regressions/${REGRESSION_ID}`)
    await expect(page.locator('[data-testid="regression-detail-page"]')).toBeVisible({
      timeout: 15000,
    })
    await expect(page.locator('[data-testid="regression-detail-loading"]')).toHaveCount(0)
    await page.locator('[data-testid="edit-suites-btn"]').click()

    await page.route(isSuitesPickerRequest, (route) => route.fulfill(fail500))
    await page.locator('[data-testid="add-suites-btn"]').click()
    const modal = page.locator('[data-testid="suite-picker-modal"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    await expect(modal.locator('[data-testid="error-state"]')).toBeVisible({ timeout: 10000 })
    await expect(modal.locator('[data-testid="error-state-title"]')).toHaveText(
      'Unable to load suites',
    )
    await expect(modal.locator('[data-testid="suite-picker-empty"]')).toHaveCount(0)

    await page.unroute(isSuitesPickerRequest)
    await modal.getByRole('button', { name: 'Try Again' }).click()
    await expect(modal.locator('[data-testid="suite-picker-suite-row"]')).toHaveCount(25, {
      timeout: 10000,
    })
    await expect(modal.locator('[data-testid="error-state"]')).toHaveCount(0)
  })

  test('load-more failure keeps rows and shows the Try Again pill; clicking retries', async ({
    page,
  }) => {
    await openTestPicker(page)
    const modal = page.locator('[data-testid="test-picker-modal"]')
    const rows = modal.locator('[data-testid="test-picker-test-row"]')
    await expect(rows).toHaveCount(25, { timeout: 10000 })

    // Fail ONLY the page-2 request
    await page.route(isTestsPickerPage2, (route) => route.fulfill(fail500))
    await scrollListToBottom(page, 'test-picker-list')

    // Loaded rows remain; the bottom-center pill swaps to "Try Again"
    // (same wording as the error state's button, one casing product-wide);
    // the full ListErrorState must NOT replace the list
    const retryPill = modal.locator('[data-testid="test-picker-load-more-retry"]')
    await expect(retryPill).toBeVisible({ timeout: 10000 })
    await expect(retryPill).toHaveText('Try Again')
    await expect(rows).toHaveCount(25)
    await expect(modal.locator('[data-testid="error-state"]')).toHaveCount(0)

    // Clicking the pill retries the failed page and appends it
    await page.unroute(isTestsPickerPage2)
    await retryPill.click()
    await expect(rows).toHaveCount(50, { timeout: 10000 })
    await expect(modal.locator('[data-testid="test-picker-load-more-retry"]')).toHaveCount(0)
  })
})
