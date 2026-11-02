/**
 * V-PICKER-LOAD-MORE: a failed next page keeps the rows already loaded and
 * retries from its own pill
 *
 * Phase: functional-workflow. The picker appends pages as the list is
 * scrolled. When an append fails, the rows the user already has must stay on
 * screen and the retry must be the floating pill: replacing the list with the
 * first-page error state would throw away a page of loaded rows, and blocking
 * the page behind the modal would take the whole surface away over one extra
 * page. Scroll-triggered paging has no jsdom equivalent, so only a real
 * browser can drive this.
 *
 * Design Decisions: PICKER-4 (the picker reports its own failed reads),
 * LIST-18 (the blocked surface is whatever the failed read serves).
 *
 * Pass Criteria:
 *  1. A failed append raises the retry pill, and the 25 loaded rows are all
 *     still there.
 *  2. The append failure never becomes the picker's first-page error state,
 *     and the page behind the modal is untouched.
 *  3. The pill's Try Again over a restored backend appends the next page and
 *     the pill goes.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { failApiRoute } from '../../helpers/api-route'
import { TESTS_LIST_ROUTE, expectNotBlocked, startAtRoot } from '../../helpers/page-block'
import { createValidTest, logNode, startEdge } from '../../helpers/fn-seed'

// One page of rows plus one, so exactly one append is due.
const PAGE_SIZE = 25
const SEEDED_TESTS = PAGE_SIZE + 1

const STAMP = `PKRLM${Date.now()}`
const SUITE_NAME = `${STAMP} Suite`
const APPEND_DETAIL = 'Test store unavailable'

const seededTestIds: string[] = []
let suiteId = ''

async function seedTests(request: APIRequestContext): Promise<void> {
  for (let index = 0; index < SEEDED_TESTS; index++) {
    const id = await createValidTest(request, {
      name: `${STAMP} Candidate ${String(index).padStart(2, '0')}`,
      nodes: [logNode('pkrlm-log', 'Log', "'picker load more'")],
      edges: [startEdge('pkrlm-log')],
    })
    seededTestIds.push(id)
  }
}

/** Open the suite's test picker, narrowed to this spec's own seeded rows. */
async function openScopedTestPicker(page: Page): Promise<Locator> {
  await page.goto(`/suites/${suiteId}`)
  await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 20000 })
  await page.locator('[data-testid="edit-tests-btn"]').click()
  await page.locator('[data-testid="add-tests-button"]').click()
  const modal = page.locator('[data-testid="test-picker-modal"]')
  await expect(modal).toBeVisible({ timeout: 15000 })

  const searched = page.waitForResponse(
    (response) =>
      response.url().includes('/tests?') && response.url().includes(`search=${STAMP}`),
  )
  await modal.locator('[data-testid="test-picker-search"] input').fill(STAMP)
  await searched
  return modal
}

test.describe('V-PICKER-LOAD-MORE: a failed append keeps what is already loaded', () => {
  test.beforeAll(async ({ request }) => {
    await seedTests(request)
    const response = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: SUITE_NAME,
        description: 'entity picker load-more spec',
        tests: [seededTestIds[0]],
      },
    })
    expect(
      response.ok(),
      `POST /suites failed: ${response.status()} ${await response.text()}`,
    ).toBeTruthy()
    const body = await response.json()
    suiteId = ((body.data ?? body) as { id: string }).id
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => undefined)
    for (const id of seededTestIds) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
  })

  test('LM1: the failed next page keeps the loaded rows and retries from the pill', async ({
    page,
  }) => {
    await startAtRoot(page)
    const modal = await openScopedTestPicker(page)

    // The refine nudge carries the searched total, so it is the one signal that
    // tells the scoped list apart from the unscoped one behind it.
    await expect(modal, 'the picker must be scoped to this spec\'s rows').toContainText(
      `${SEEDED_TESTS} tests - refine your search`,
      { timeout: 15000 },
    )
    const rows = modal.locator('[data-testid="test-picker-test-row"]')
    await expect(rows, 'the first page must be loaded before the append').toHaveCount(PAGE_SIZE)

    // Armed after the first page landed, so only the append fails.
    let failing = true
    await failApiRoute(page, TESTS_LIST_ROUTE, () =>
      failing ? { detail: APPEND_DETAIL } : null,
    )

    await modal.locator('[data-testid="test-picker-list"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    // 1. The append failed into its own pill.
    const retryPill = modal.locator('[data-testid="test-picker-load-more-retry"]')
    await expect(retryPill).toBeVisible({ timeout: 15000 })
    await expect(retryPill).toHaveText('Try Again')

    // 2. Nothing already loaded was thrown away, and nothing else took over.
    await expect(rows, 'a failed append must keep the loaded rows').toHaveCount(PAGE_SIZE)
    await expect(
      modal.getByTestId('error-state'),
      'an append failure is not the first-page error state',
    ).toHaveCount(0)
    await expectNotBlocked(page)

    // 3. The pill retries the append it owns.
    failing = false
    await retryPill.click()
    await expect(rows).toHaveCount(SEEDED_TESTS, { timeout: 15000 })
    await expect(retryPill).toHaveCount(0)
    await expectNotBlocked(page)
  })
})
