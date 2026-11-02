/**
 * V-PAGE-BLOCKED-LOAD-ORDER: a failed test read reports without waiting for
 * slow supporting reads
 *
 * Phase: functional-workflow. Opening a Test starts its primary reads and its
 * supporting reads together. When the primary fails it must be reported the
 * moment it settles: a supporting read still in flight may not hold the
 * failure back while the canvas sits on the loading overlay.
 *
 * Design Decisions: LIST-20 (primary failure wins outright and is never
 * gated on anything else), LIST-16 (Try Again re-runs what failed).
 *
 * Pass Criteria:
 *  1. With the test read failing and the system variables read held 15s, the
 *     "Could not load test" card is up well before the hold resolves.
 *  2. Try Again over a restored backend loads the canvas.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createValidTest,
  logNode,
  releaseWorkbenchOwnership,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { apiPathMatcher, delayApiRoute, failApiRoute } from '../../helpers/api-route'
import {
  SYSTEM_VARIABLES_ROUTE,
  blockedCard,
  blockedTitle,
  retryBlockedPage,
  startAtRoot,
} from '../../helpers/page-block'

let testId: string

test.describe('V-PAGE-BLOCKED-LOAD-ORDER: the primary failure is never held back', () => {
  test.beforeAll(async ({ request }) => {
    testId = await createValidTest(request, {
      name: `pblk load order ${Date.now()}`,
      nodes: [logNode('pblk-log', 'Log', "'pblk load order'")],
      edges: [startEdge('pblk-log')],
    })
    const validation = await validateTest(request, testId)
    expect(validation.errors).toEqual([])
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await releaseWorkbenchOwnership(request)
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('a failed test read reports before slow supporting reads settle', async ({ page }) => {
    await startAtRoot(page)
    await releaseWorkbenchOwnership(page.request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})

    let failing = true
    let holding = true
    // Exact path: only the details read, never /workflow or /validate.
    const detailsRoute = apiPathMatcher(`/tests/${testId}`)
    await failApiRoute(page, detailsRoute, () =>
      failing ? { detail: 'Test store unavailable' } : null,
    )
    await delayApiRoute(page, SYSTEM_VARIABLES_ROUTE, () => (holding ? 15000 : 0))

    const detailsFailed = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' && detailsRoute(new URL(r.url())) && r.status() === 500,
      { timeout: 20000 },
    )
    await page.goto(`/workbench?editTest=${testId}`)
    await detailsFailed

    // The primary settled failed; the card must be up long before the 15s hold resolves.
    await expect(blockedCard(page)).toBeVisible({ timeout: 8000 })
    await expect(blockedTitle(page)).toHaveText('Could not load test')

    failing = false
    holding = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0, { timeout: 15000 })
    await expect(page.locator('[data-testid="workflow-node-pblk-log"]')).toBeVisible({
      timeout: 20000,
    })
  })
})
