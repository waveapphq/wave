/**
 * V-PAGE-BLOCKED-ARTIFACTS-POLL: one failed artifact poll tick never blocks
 * the workbench
 *
 * Phase: functional-workflow. With the Session Artifacts sheet open during a
 * run, the list refreshes on a timer. A read repeating on a timer reports in
 * place and keeps the last known state on screen; it must not take the whole
 * workbench away over one missed tick.
 *
 * Design Decisions: LIST-26 (a read repeating on a timer reports in place and
 * keeps the last good data on screen).
 *
 * Pass Criteria:
 *  1. A single failed poll tick raises no blocked card; the sheet stays up.
 *  2. The tick's failure is announced in place: "<reason> (showing the last
 *     known state)".
 *  3. The next clean tick clears the notice; nothing was ever blocked.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  delayNode,
  openTest,
  releaseWorkbenchOwnership,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { selectEnvironment } from '../../helpers/workbench'
import { failApiRoute } from '../../helpers/api-route'
import {
  SESSION_ARTIFACTS_ROUTE,
  blockedCard,
  isRouteContentInert,
} from '../../helpers/page-block'

let testId: string

test.describe('V-PAGE-BLOCKED-ARTIFACTS-POLL: a poll tick failure reports in place', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `pblk artifacts poll ${Date.now()}`,
      nodes: [delayNode('pblk-delay', 'Hold', 20000)],
      edges: [startEdge('pblk-delay')],
    })
    const validation = await validateTest(request, testId)
    expect(validation.errors).toEqual([])
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await releaseWorkbenchOwnership(request)
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('one failed poll tick keeps the sheet live and reports in place', async ({ page }) => {
    await openTest(page, testId)
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'running',
      { timeout: 15000 },
    )

    // The sheet-open refresh is a gesture read; let it land clean first.
    const sheetRefresh = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        SESSION_ARTIFACTS_ROUTE(new URL(r.url())) &&
        r.status() === 200,
      { timeout: 10000 },
    )
    await page.locator('[data-testid="breadcrumb-artifacts-chip"]').click()
    await expect(page.locator('[data-testid="session-artifacts-sheet"]')).toBeVisible()
    await sheetRefresh

    // Exactly one tick fails; every later request passes through untouched.
    let shots = 1
    await failApiRoute(page, SESSION_ARTIFACTS_ROUTE, () =>
      shots-- > 0 ? { detail: 'Artifact store unavailable' } : null,
    )
    await page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        SESSION_ARTIFACTS_ROUTE(new URL(r.url())) &&
        r.status() === 500,
      { timeout: 10000 },
    )
    await page.waitForTimeout(500)

    // Instant checks: the next clean tick would clear a wrongly-raised card,
    // so a retrying assertion here would miss the defect.
    expect(
      await blockedCard(page).allInnerTexts(),
      'a failed poll tick must not raise the blocking card',
    ).toEqual([])
    expect(await isRouteContentInert(page), 'the workbench must stay live').toBe(false)
    await expect(page.locator('[data-testid="session-artifacts-sheet"]')).toBeVisible()

    // The failure is announced in place, keeping the last known state on screen.
    const notice = page.getByTestId('session-artifacts-refresh-error')
    await expect(notice).toBeVisible({ timeout: 1500 })
    await expect(notice).toContainText(
      'Artifact store unavailable (showing the last known state)',
    )
    await expect(notice).toHaveAttribute('role', 'alert')

    // The next clean tick clears the notice; still nothing blocked.
    await expect(notice).toHaveCount(0, { timeout: 10000 })
    expect(await blockedCard(page).allInnerTexts()).toEqual([])
  })
})
