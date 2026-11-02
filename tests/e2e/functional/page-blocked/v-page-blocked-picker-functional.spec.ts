/**
 * V-PAGE-BLOCKED-PICKER: a modal that reads its own data blocks itself, not the
 * page behind it
 *
 * Phase: functional-workflow. The Entity Picker's tag read is part of its
 * initial load, so a failed tag read lands in the error state the picker already
 * owns and is retried by the same Try Again. The page behind the open modal is
 * never blurred and never goes inert.
 *
 * Design Decisions: LIST-18 (the blocked surface is whatever the failed read
 * serves), PICKER-4 (the picker's error state names what failed).
 *
 * Pass Criteria:
 *  1. With GET /tests/tags failing, opening the test picker shows the picker's
 *     own error state and its Try Again, and the title names the TAG read - not
 *     the entity, which would be a false statement about what went wrong.
 *  2. The suite detail page behind the modal carries no blocked card, is not
 *     inert, and is not blurred.
 *  3. Try Again over a restored backend re-runs BOTH of the picker's reads: the
 *     rows arrive and the tag read is issued a second time.
 *  4. A search re-runs only the item read, so filtering still costs one request.
 *  5. When both reads fail the title names both, so nothing is dropped.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { countApiFetches, failApiRoute } from '../../helpers/api-route'
import {
  TESTS_LIST_ROUTE,
  TEST_TAGS_ROUTE,
  expectNotBlocked,
  startAtRoot,
} from '../../helpers/page-block'
import { createValidTest, logNode, startEdge } from '../../helpers/fn-seed'

const STAMP = `${Date.now()}`
const SUITE_NAME = `PBLK Picker Suite ${STAMP}`
const MEMBER_TEST_NAME = `PBLK Picker Member ${STAMP}`
const FREE_TEST_NAME = `PBLK Picker Free ${STAMP}`
const FAILURE_DETAIL = 'Tag index unavailable'
const ITEMS_DETAIL = 'Test store unavailable'

let suiteId = ''
let memberTestId = ''
let freeTestId = ''

async function seedTest(request: APIRequestContext, name: string): Promise<string> {
  return createValidTest(request, {
    name,
    nodes: [logNode('pblk-log', 'Log', "'picker'")],
    edges: [startEdge('pblk-log')],
  })
}

async function openTestPicker(page: Page): Promise<Locator> {
  await page.goto(`/suites/${suiteId}`)
  await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({ timeout: 20000 })
  await page.locator('[data-testid="edit-tests-btn"]').click()
  await page.locator('[data-testid="add-tests-button"]').click()
  const modal = page.locator('[data-testid="test-picker-modal"]')
  await expect(modal).toBeVisible({ timeout: 15000 })
  return modal
}

test.describe('V-PAGE-BLOCKED-PICKER: the picker owns its own failure', () => {
  test.beforeAll(async ({ request }) => {
    memberTestId = await seedTest(request, MEMBER_TEST_NAME)
    freeTestId = await seedTest(request, FREE_TEST_NAME)
    const response = await request.post(`${BACKEND_URL}/suites`, {
      data: {
        name: SUITE_NAME,
        description: 'page-blocked picker spec',
        tests: [memberTestId],
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
    await request.delete(`${BACKEND_URL}/tests/${memberTestId}`).catch(() => undefined)
    await request.delete(`${BACKEND_URL}/tests/${freeTestId}`).catch(() => undefined)
  })

  test('K1: a failed tag read shows the picker error state and leaves the page behind it alone', async ({
    page,
  }) => {
    let failing = true
    await startAtRoot(page)
    await failApiRoute(page, TEST_TAGS_ROUTE, () => (failing ? { detail: FAILURE_DETAIL } : null))
    const tagReads = countApiFetches(page, TEST_TAGS_ROUTE)

    const modal = await openTestPicker(page)

    // 1. The modal reports its own failure, with its own retry, and names the
    //    read that actually failed. The item read succeeded, so naming the
    //    entity here would be a false statement.
    const errorState = modal.getByTestId('error-state')
    await expect(errorState).toBeVisible({ timeout: 15000 })
    await expect(modal.getByTestId('error-state-title')).toHaveText('Unable to load tags')
    const retry = errorState.getByRole('button', { name: 'Try Again' })
    await expect(retry).toBeVisible()

    // 2. The page behind the modal is untouched.
    await expectNotBlocked(page)

    const tagReadsBeforeRetry = tagReads()
    expect(tagReadsBeforeRetry, 'the failed tag read must have been issued').toBeGreaterThan(0)

    // 3. Try Again re-runs both of the picker's reads.
    failing = false
    await retry.click()
    const rows = modal.locator('[data-testid="test-picker-test-row"]')
    await expect(rows.first()).toBeVisible({ timeout: 15000 })
    await expect(errorState).toHaveCount(0)
    expect(tagReads(), 'Try Again must re-run the tag read too').toBe(tagReadsBeforeRetry + 1)

    // 4. Searching re-reads the items only. The seeded pair share the stamp, so
    //    the search narrows the list whatever else the store holds.
    const tagReadsAfterRetry = tagReads()
    const searched = page.waitForResponse(
      (response) =>
        response.url().includes('/tests?') && response.url().includes(`search=${STAMP}`),
    )
    await modal.locator('[data-testid="test-picker-search"] input').fill(STAMP)
    await searched
    await expect(rows.filter({ hasText: FREE_TEST_NAME })).toHaveCount(1, { timeout: 15000 })
    expect(tagReads(), 'a search must not re-read the tag universe').toBe(tagReadsAfterRetry)
    await expectNotBlocked(page)
  })

  test('K2: with both of the picker reads failing the error names both', async ({ page }) => {
    await startAtRoot(page)
    await failApiRoute(page, TEST_TAGS_ROUTE, { detail: FAILURE_DETAIL })
    await failApiRoute(page, TESTS_LIST_ROUTE, { detail: ITEMS_DETAIL })

    const modal = await openTestPicker(page)
    const errorState = modal.getByTestId('error-state')
    await expect(errorState).toBeVisible({ timeout: 15000 })
    await expect(modal.getByTestId('error-state-title')).toHaveText('Unable to load tests and tags')
    await expect(errorState.getByRole('button', { name: 'Try Again' })).toBeVisible()

    // Still the modal's own failure: the page behind it is untouched.
    await expectNotBlocked(page)
  })
})
