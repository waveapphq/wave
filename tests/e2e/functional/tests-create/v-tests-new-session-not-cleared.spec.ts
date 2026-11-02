/**
 * V-TESTS-NEW-SESSION-NOT-CLEARED: a failed session clear stops New Test
 *
 * Phase: functional-workflow. Starting a new test from the Tests list first
 * clears the workbench session the new test would otherwise overwrite. When
 * that clear fails the session is still there on the server, so the gesture
 * must stop and say so: opening the new-test form would present a switch that
 * did not happen, and the next workbench visit would restore the old session
 * over it. The companion spec v-newtest-session-read guards the READ before
 * this step; this one guards the clear.
 *
 * Design Decisions: LIST-26 (an action the user triggered reports at the
 * gesture, in its toast), LIST-11 (a failed write is never presented as
 * done).
 *
 * Pass Criteria:
 *  1. With the session clear failing, the gesture raises the "Session Not
 *     Cleared" toast carrying the server's reason.
 *  2. The gesture does not present as complete: the switch dialog is still
 *     up, the URL is still the list, and no new-test form opens.
 *  3. The session is still on the server.
 *  4. Over a restored backend the same gesture completes: the dialog goes and
 *     the new-test form opens.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { failApiRoute } from '../../helpers/api-route'
import { WORKBENCH_SESSION_ROUTE } from '../../helpers/page-block'
import { getActiveSessionId } from '../../helpers/fixture-import'
import {
  createValidTest,
  logNode,
  openTest,
  releaseWorkbenchOwnership,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { runToTerminal, selectEnvironment } from '../../helpers/workbench'

const TEST_NAME = `NEWTEST Clear ${Date.now()}`
const NODE_ID = 'newtest-clear-log'
const CLEAR_DETAIL = 'Session store refused the delete'

// Either wording of the destructive action, so a dirty-vs-clean store
// difference cannot decide whether this spec runs.
const CREATE_NEW = /^(Reset|Discard) & Create Test$/

let testId = ''

test.describe('V-TESTS-NEW-SESSION-NOT-CLEARED: the switch stops while the session stands', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: TEST_NAME,
      nodes: [logNode(NODE_ID, 'Log', "'new test clear'")],
      edges: [startEdge(NODE_ID)],
    })
    const validation = await validateTest(request, testId)
    expect(validation.errors, 'the seeded Test must validate clean').toEqual([])
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('NC1: a failed session clear refuses New Test and leaves the session standing', async ({
    page,
    request,
  }) => {
    // A real run leaves a real session for New Test to have to clear.
    await openTest(page, testId)
    await selectEnvironment(page)
    await runToTerminal(page)
    const sessionId = await getActiveSessionId(page)

    await page.goto('/tests')
    await expect(page.getByTestId('tests-page')).toBeVisible({ timeout: 20000 })

    let failing = true
    await failApiRoute(
      page,
      WORKBENCH_SESSION_ROUTE,
      () => (failing ? { detail: CLEAR_DETAIL } : null),
      'DELETE',
    )

    await page.getByRole('button', { name: 'New Test' }).click()
    const switchDialog = page.getByTestId('switch-test-dialog')
    await expect(switchDialog).toBeVisible({ timeout: 15000 })
    await switchDialog.getByRole('button', { name: CREATE_NEW }).click()

    // 1. The gesture reports its own failure.
    const toast = page.locator('[data-toast]', { hasText: 'Session Not Cleared' })
    await expect(toast).toBeVisible({ timeout: 10000 })
    await expect(toast).toContainText(
      `The workbench session is still open on the server: ${CLEAR_DETAIL}`,
    )

    // 2. Nothing moved on.
    await expect(switchDialog, 'the switch must not present as done').toBeVisible()
    await expect(page).toHaveURL(/\/tests$/)
    await expect(page.getByRole('dialog', { name: 'New Test' })).toHaveCount(0)

    // 3. The session really is still there.
    const stillThere = await request.get(`${BACKEND_URL}/workbench/session`)
    expect(stillThere.ok(), 'the session read must still answer').toBeTruthy()
    const body = await stillThere.json()
    const restored = (body.data ?? body) as { session_id?: string }
    expect(restored.session_id, 'the session must be untouched').toBe(sessionId)

    // 4. Over a restored backend the same gesture completes.
    failing = false
    await switchDialog.getByRole('button', { name: CREATE_NEW }).click()
    await expect(switchDialog).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByRole('dialog', { name: 'New Test' })).toBeVisible({ timeout: 15000 })
  })
})
