/**
 * V-NEWTEST-SESSION-READ: a failed session read refuses New Test with the
 * failure, never a definite running claim
 *
 * Phase: functional-workflow. New Test first reads the workbench session to
 * avoid killing a live run. When that read fails, nothing is known about the
 * session - so the gesture is refused with the failure itself. Presenting the
 * unknown as the definite answer "a test is currently running" would be a
 * fabricated claim.
 *
 * Design Decisions: LIST-25 (a failure is never read as an answer), LIST-26
 * (an action the user triggered reports at the gesture, in its toast).
 *
 * Pass Criteria:
 *  1. New Test with the session read failing raises the "New Test Not
 *     Started" toast carrying the real reason.
 *  2. No running-test dialog and no running claim appears.
 *  3. The refusal holds: the URL stays on /tests and the name dialog never
 *     opens.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { failApiRoute } from '../../helpers/api-route'
import { WORKBENCH_SESSION_ROUTE, startAtRoot } from '../../helpers/page-block'

const SESSION_DETAIL = 'Session store unavailable'

test.describe('V-NEWTEST-SESSION-READ: the unknown session refuses, not claims', () => {
  test('a failed session read reports the failure and opens no dialog', async ({ page }) => {
    await startAtRoot(page)
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 20000 })

    // Armed after the page settled, so only the click-time session read fails.
    await failApiRoute(page, WORKBENCH_SESSION_ROUTE, { detail: SESSION_DETAIL })

    const sessionFailed = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        WORKBENCH_SESSION_ROUTE(new URL(r.url())) &&
        r.status() === 500,
      { timeout: 15000 },
    )
    await page.getByRole('button', { name: 'New Test' }).click()
    await sessionFailed

    // The gesture reports its own failure in a toast.
    const toast = page.locator('[data-toast]', { hasText: 'New Test Not Started' })
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText(
      `Could not read the workbench session: ${SESSION_DETAIL}`,
    )

    // No fabricated running claim in any surface.
    await expect(page.getByTestId('switch-test-dialog')).toHaveCount(0)
    await expect(page.locator('[data-toast]', { hasText: 'is currently running' })).toHaveCount(0)

    // The refusal preserved: still on the list, and the name dialog never opened.
    await expect(page).toHaveURL(/\/tests$/)
    await expect(page.getByRole('dialog', { name: 'New Test' })).toHaveCount(0)
  })
})
