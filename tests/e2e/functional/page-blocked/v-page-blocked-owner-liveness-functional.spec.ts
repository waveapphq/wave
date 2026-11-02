/**
 * V-PAGE-BLOCKED-OWNER-LIVENESS: a supporting read failing after its page was
 * left raises nothing on the next page
 *
 * Phase: functional-workflow. A slow tags read is still in flight when the
 * user leaves the Tests list for the Dashboard; its failure lands after the
 * list surface is gone, so no block may appear anywhere.
 *
 * Design Decisions: LIST-21 (a surface that goes away clears its own block,
 * so no block outlives the surface it describes), LIST-14 (a failed read on
 * one page is no reason to take the whole product away).
 *
 * Pass Criteria:
 *  1. The Tests list lands its primary read before the user leaves.
 *  2. The held-back tags failure arrives while the Dashboard is on screen.
 *  3. No blocked card renders and the Dashboard stays live.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { failApiRoute } from '../../helpers/api-route'
import {
  TEST_TAGS_ROUTE,
  blockedCard,
  expectNotBlocked,
  startAtRoot,
} from '../../helpers/page-block'

test.describe('V-PAGE-BLOCKED-OWNER-LIVENESS: a late failure never blocks the next page', () => {
  test('a supporting read failing after navigation must not block the next page', async ({
    page,
  }) => {
    await startAtRoot(page)
    // The 500 is held back 5s so it lands only after the user has moved on.
    await failApiRoute(page, TEST_TAGS_ROUTE, { detail: 'Tag index unavailable', delayMs: 5000 })

    await page.goto('/tests')
    // The primary must land first: a pending primary withholds the failure.
    await expect(
      page.locator('[data-testid="empty-state"], [data-testid="tests-table"]').first(),
    ).toBeVisible({ timeout: 20000 })

    await page.locator('[data-testid="sidebar"] a[href="/dashboard"]').click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        TEST_TAGS_ROUTE(new URL(r.url())) &&
        r.status() === 500,
      { timeout: 20000 },
    )
    await page.waitForTimeout(500)

    // The read's surface is gone, so its failure must not block the Dashboard.
    expect(
      await blockedCard(page).allInnerTexts(),
      'the Dashboard was blocked by a read belonging to the page just left',
    ).toEqual([])
    await expectNotBlocked(page)
  })
})
