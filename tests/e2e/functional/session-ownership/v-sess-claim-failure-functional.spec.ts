/**
 * V-SESS-CLAIM-FAILURE: a failed ownership claim is a failed read, not a
 * holder answer
 *
 * Phase: functional-workflow. The workbench mount claims the free editing
 * slot. Only a conflict answer means "held by another"; any other rejection
 * is a failed read and must block with the workbench session card - never
 * present an editable canvas nobody registered as the holder.
 *
 * Design Decisions: LIST-25 (a failure is never read as an answer; the
 * distinction is what came back, never inferred), LIST-19 (a read the surface
 * started for itself blocks like one the user asked for).
 *
 * Pass Criteria:
 *  1. With the claim failing (500), the workbench blocks with "Could not load
 *     workbench session".
 *  2. Try Again over a restored backend claims the slot: the server names a
 *     holder and the canvas is editable with no mirror banner.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { releaseWorkbenchOwnership } from '../../helpers/fn-seed'
import { SEL, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { failApiRoute } from '../../helpers/api-route'
import {
  OWNERSHIP_CLAIM_ROUTE,
  blockedCard,
  blockedTitle,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

test.describe('V-SESS-CLAIM-FAILURE: a non-conflict claim rejection blocks', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test('a failed claim blocks the workbench instead of rendering it editable', async ({
    page,
    request,
  }) => {
    await startAtRoot(page)
    await releaseWorkbenchOwnership(page.request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})

    let failing = true
    await failApiRoute(
      page,
      OWNERSHIP_CLAIM_ROUTE,
      () => (failing ? { detail: 'Claim store unavailable' } : null),
      'POST',
    )

    const claimFailed = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        OWNERSHIP_CLAIM_ROUTE(new URL(r.url())) &&
        r.status() === 500,
      { timeout: 20000 },
    )
    await page.goto('/workbench')
    await claimFailed

    // The claim's 500 is not a holder answer: the session read failed, so the page blocks.
    await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
    await expect(blockedTitle(page)).toHaveText('Could not load workbench session')

    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0, { timeout: 15000 })
    // The retry really claimed: the server names a holder and this tab edits.
    await waitUntilHeld(request)
    await expect(page.locator(SEL.canvasReadOnly)).toHaveCount(0)
    await expect(page.locator(SEL.banner)).toHaveCount(0)
  })
})
