/**
 * V-PAGE-BLOCKED-PRIMARY: the records a page exists to show keep the page's own
 * full-page error state
 *
 * Phase: functional-workflow. The guard for the distinction the whole
 * blocked-page design rests on: only the supporting reads block. When the record
 * list itself fails, the page shows its error state, the
 * page stays live, and no blocked card appears.
 *
 * Design Decisions: LIST-5 (the list error state), LIST-10 (primary versus
 * supporting reads), LIST-18 (the blocked surface is whatever the failed read
 * serves), LIST-20 (a failed record read wins outright).
 *
 * Pass Criteria:
 *  1. A failed suite list read renders the shared list error state carrying the
 *     server's reason, not the blocked card, and leaves the route content live
 *     and unblurred.
 *  2. That page's own Try Again recovers it and the filter bar comes back.
 *  3. A failed profile list read behaves the same on the Profiles page, which
 *     owns a hand-rolled copy of the same error state.
 *  4. With the record read AND a supporting read failing in the same load,
 *     exactly ONE state renders: the page's own error state, with a Try Again
 *     that is reachable in one click. Once the records are back the still
 *     failing supporting read takes over and blocks the page, so the two states
 *     never share the screen in either direction.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { failApiRoute, type ApiUrlMatcher } from '../../helpers/api-route'
import {
  PROFILES_LIST_ROUTE,
  SUITES_LIST_ROUTE,
  TESTS_LIST_ROUTE,
  TEST_TAGS_ROUTE,
  blockedCard,
  expectBlockedWith,
  expectNotBlocked,
  expectSurfaceLive,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

const FAILURE_DETAIL = 'Record store unavailable'
const TAGS_DETAIL = 'Tag index unavailable'

// Long enough for the tag read to have landed and been ruled on, so the
// single-state assertion is not just a race the error state happened to win.
const SETTLE_MS = 1500

interface PrimaryCase {
  route: string
  read: ApiUrlMatcher
  /** The title the page's own error state carries. */
  errorTitle: string
}

async function drivePrimaryFailure(page: Page, primaryCase: PrimaryCase): Promise<void> {
  let failing = true
  await startAtRoot(page)
  await failApiRoute(page, primaryCase.read, () => (failing ? { detail: FAILURE_DETAIL } : null))

  await page.goto(primaryCase.route)

  const errorState = page.getByTestId('error-state')
  const search = page.locator('[data-testid="search-input"] input').first()
  await expect(errorState).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('error-state-title')).toHaveText(primaryCase.errorTitle)
  await expect(page.getByTestId('error-state-description')).toContainText(FAILURE_DETAIL)
  await expect(search, 'the page error state disables its own filter bar').toBeDisabled()

  // The whole point: the records failing is NOT a blocked page.
  await expectNotBlocked(page)

  failing = false
  await errorState.getByRole('button', { name: 'Try Again' }).click()
  await expect(errorState).toHaveCount(0)
  await expect(search, 'the recovered page takes input again').toBeEnabled()
  await expect(blockedCard(page), 'recovery must not raise the blocked card').toHaveCount(0)
}

test.describe('V-PAGE-BLOCKED-PRIMARY: a failed record read keeps the full-page error state', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test('P1: the suite list read fails into the list error state, not the blocked card', async ({
    page,
  }) => {
    await drivePrimaryFailure(page, {
      route: '/suites',
      read: SUITES_LIST_ROUTE,
      errorTitle: 'Unable to load suites',
    })
  })

  test('P2: the profile list read fails into the Profiles error state, not the blocked card', async ({
    page,
  }) => {
    await drivePrimaryFailure(page, {
      route: '/profiles',
      read: PROFILES_LIST_ROUTE,
      errorTitle: 'Unable to load profiles',
    })
  })

  test('P3: with the records and a supporting read both failing, only the error state renders', async ({
    page,
  }) => {
    let recordsFailing = true
    let tagsFailing = true
    await startAtRoot(page)
    await failApiRoute(page, TESTS_LIST_ROUTE, () =>
      recordsFailing ? { detail: FAILURE_DETAIL } : null,
    )
    await failApiRoute(page, TEST_TAGS_ROUTE, () => (tagsFailing ? { detail: TAGS_DETAIL } : null))

    await page.goto('/tests')

    const errorState = page.getByTestId('error-state')
    await expect(errorState).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('error-state-title')).toHaveText('Unable to load tests')
    await expect(page.getByTestId('error-state-description')).toContainText(FAILURE_DETAIL)

    // Both reads have failed, and still exactly one state is on screen. The
    // card over a blurred error state is what made recovery cost two clicks.
    await page.waitForTimeout(SETTLE_MS)
    await expectNotBlocked(page)
    await expect(errorState).toBeVisible()

    // One click, not two: the page's own Try Again is live and it recovers.
    const retry = errorState.getByRole('button', { name: 'Try Again' })
    await expect(retry).toBeEnabled()
    recordsFailing = false
    await retry.click()

    // With the records back the still-failing tag read owns the page, and the
    // error state is gone: the two states never share the screen either way.
    await expect(errorState).toHaveCount(0, { timeout: 20000 })
    await expectBlockedWith(page, 'Could not load tags')

    tagsFailing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    await expectSurfaceLive(page)
  })
})
