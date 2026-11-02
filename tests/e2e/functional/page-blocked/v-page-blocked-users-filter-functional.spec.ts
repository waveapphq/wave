/**
 * V-PAGE-BLOCKED-USERS-FILTER: a failed users facet read blocks its page as a
 * supporting read
 *
 * Phase: functional-workflow. Executions and Reports read the unique user
 * values that feed their User filter. That read is supporting: when it fails
 * the loaded page must block with "Could not load users", never fall to the
 * full-page error state as if the records themselves were gone.
 *
 * Design Decisions: LIST-10 (records are primary, every other read is
 * supporting and blocks), LIST-16 (Try Again re-runs only what failed).
 *
 * Pass Criteria:
 *  1. Executions with only the users read failing blocks with "Could not load
 *     users"; the page's own error state does not appear.
 *  2. The details panel names the failed request and its id.
 *  3. Try Again over a restored backend clears the card and the page is live.
 *  4. Reports behaves the same way.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { failApiRoute } from '../../helpers/api-route'
import {
  EXECUTION_USERS_ROUTE,
  blockedCard,
  blockedTitle,
  expectNotBlocked,
  openBlockedDetails,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

const USERS_DETAIL = 'User index unavailable'
const USERS_REQUEST_ID = 'pblk-users-1111-aaaa'

interface UsersCase {
  route: string
  pageTestId: string
  /** The testid the page's own full-page error state carries. */
  errorTestId: string
}

/** Fail only the users read, prove the page blocks (not errors), then recover. */
async function driveUsersBlockedPage(page: Page, c: UsersCase): Promise<void> {
  let failing = true
  await startAtRoot(page)
  await failApiRoute(page, EXECUTION_USERS_ROUTE, () =>
    failing ? { detail: USERS_DETAIL, requestId: USERS_REQUEST_ID } : null,
  )

  const usersFailed = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      EXECUTION_USERS_ROUTE(new URL(r.url())) &&
      r.status() === 500,
    { timeout: 20000 },
  )
  await page.goto(c.route)
  await usersFailed

  // A supporting read failed on a loaded page: the shared card, not the error state.
  await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
  await expect(blockedTitle(page)).toHaveText('Could not load users')
  await expect(page.getByTestId(c.errorTestId)).toHaveCount(0)

  const panel = await openBlockedDetails(page)
  await expect(panel).toContainText('/executions/users')
  await expect(panel).toContainText(USERS_DETAIL)
  await expect(panel).toContainText(USERS_REQUEST_ID)

  failing = false
  await retryBlockedPage(page)
  await expect(blockedCard(page)).toHaveCount(0)
  await expectNotBlocked(page)
  await expect(page.getByTestId(c.pageTestId)).toBeVisible()
  await expect(page.getByTestId(c.errorTestId)).toHaveCount(0)
}

test.describe('V-PAGE-BLOCKED-USERS-FILTER: the users read is a blocking supporting read', () => {
  test('Executions blocks with the users card when the facet read fails', async ({ page }) => {
    await driveUsersBlockedPage(page, {
      route: '/executions',
      pageTestId: 'executions-page',
      errorTestId: 'error-state-title',
    })
  })

  test('Reports blocks with the users card when the facet read fails', async ({ page }) => {
    await driveUsersBlockedPage(page, {
      route: '/reports',
      pageTestId: 'reports-page',
      errorTestId: 'error-state',
    })
  })
})
