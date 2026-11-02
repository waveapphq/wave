/**
 * V-PAGE-BLOCKED-RUN-DIALOG-GATING: a failed primary read owns its page alone
 *
 * Phase: functional-workflow. When a list page's primary read fails, the page
 * shows its own full-page error state and nothing else may block it - not even
 * the environments read the page's run dialogs need. Both fail together here,
 * and only the primary error state may stand.
 *
 * Design Decisions: LIST-20 (primary failure wins outright; whatever else
 * failed in the same load, nothing is blocked), LIST-10 (two kinds of read).
 *
 * Pass Criteria:
 *  1. Executions with a failed records read shows only "Unable to load
 *     executions" - no blocked card over it, even though the environments
 *     read also failed.
 *  2. The error state's Try Again over a restored backend recovers the page.
 *  3. The Suites list behaves the same way.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { failApiRoute, type ApiUrlMatcher } from '../../helpers/api-route'
import {
  ENVIRONMENT_NAMES_ROUTE,
  EXECUTIONS_LIST_ROUTE,
  SUITES_LIST_ROUTE,
  blockedCard,
  expectNotBlocked,
  startAtRoot,
} from '../../helpers/page-block'

interface PrimaryCase {
  route: string
  read: ApiUrlMatcher
  errorTitle: string
  pageTestId: string
}

/** Fail the primary and the environments read together, then recover via the error state. */
async function drivePrimaryOwnsThePage(page: Page, c: PrimaryCase): Promise<void> {
  let primaryFailing = true
  let namesFailing = true
  await startAtRoot(page)
  await failApiRoute(page, c.read, () =>
    primaryFailing ? { detail: 'Record store unavailable' } : null,
  )
  await failApiRoute(page, ENVIRONMENT_NAMES_ROUTE, () =>
    namesFailing ? { detail: 'Environment registry unavailable' } : null,
  )
  const namesFailed = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      ENVIRONMENT_NAMES_ROUTE(new URL(r.url())) &&
      r.status() === 500,
    { timeout: 20000 },
  )

  await page.goto(c.route)
  await expect(page.getByTestId('error-state-title')).toHaveText(c.errorTitle, {
    timeout: 20000,
  })
  await namesFailed
  await page.waitForTimeout(1000)

  // The primary error state owns the page: the failed environments read may not block it.
  expect(
    await blockedCard(page).allInnerTexts(),
    'a card was raised over the page-wide error state',
  ).toEqual([])
  await expectNotBlocked(page)

  // One click on the error state's own Try Again recovers the page.
  primaryFailing = false
  namesFailing = false
  await page.getByTestId(c.pageTestId).getByRole('button', { name: 'Try Again' }).click()
  await expect(page.getByTestId('error-state-title')).toHaveCount(0, { timeout: 20000 })
  await expectNotBlocked(page)
  await expect(page.getByTestId(c.pageTestId)).toBeVisible()
}

test.describe('V-PAGE-BLOCKED-RUN-DIALOG-GATING: primary failure is never overlaid', () => {
  test('a failed executions read owns the page alone', async ({ page }) => {
    await drivePrimaryOwnsThePage(page, {
      route: '/executions',
      read: EXECUTIONS_LIST_ROUTE,
      errorTitle: 'Unable to load executions',
      pageTestId: 'executions-page',
    })
  })

  test('the suites list behaves the same', async ({ page }) => {
    await drivePrimaryOwnsThePage(page, {
      route: '/suites',
      read: SUITES_LIST_ROUTE,
      errorTitle: 'Unable to load suites',
      pageTestId: 'suites-page',
    })
  })
})
