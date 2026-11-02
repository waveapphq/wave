/**
 * V-PAGE-BLOCKED-DISCARD-STAY: a failed revert never passes unsaved edits off
 * as the saved state
 *
 * Phase: functional-workflow. "Discard and Stay" re-reads the saved workflow
 * and puts it back on the canvas. A failed read must not close the dialog silently.
 *
 * Design Decisions: LIST-11 (a failed read is never presented as a result),
 * LIST-12 / LIST-13 (the blocked state, and blocked means inert), LIST-19 (a
 * read the surface started for itself blocks like any other), LIST-16 (Try
 * Again re-runs the read that failed).
 *
 * Pass Criteria:
 *  1. With the saved-workflow read failing, Discard and Stay closes the dialog
 *     and the blocked card is what tells the user, naming that read; the
 *     details carry the server's reason and the request that failed.
 *  2. The canvas is not passed off as the saved state: the unsaved edit is
 *     still on it, the workbench still knows the edit is unsaved, and the page
 *     is inert, so nothing can be saved out of a state the user believes was
 *     discarded.
 *  3. Only a read that succeeds actually discards: Try Again over a restored
 *     backend puts the saved workflow back and leaves the canvas clean.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { failApiRoute } from '../../helpers/api-route'
import {
  blockedCard,
  expectBlockedWith,
  isRouteContentInert,
  openBlockedDetails,
  retryBlockedPage,
  testWorkflowRoute,
} from '../../helpers/page-block'
import {
  createValidTest,
  logNode,
  openTest,
  releaseWorkbenchOwnership,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { dragNodeBy, readNodeTransform, saveBtn } from '../../helpers/workbench'

const TEST_NAME = `PBLK Discard ${Date.now()}`
const NODE_ID = 'pblk-discard-log'
const REVERT_DETAIL = 'Saved workflow read refused'

let testId = ''

test.describe('V-PAGE-BLOCKED-DISCARD-STAY: a failed revert is reported, never faked', () => {
  test.beforeAll(async ({ request }) => {
    testId = await createValidTest(request, {
      name: TEST_NAME,
      nodes: [logNode(NODE_ID, 'Log', "'discard'")],
      edges: [startEdge(NODE_ID)],
    })
    // A seed that does not validate clean would open the load-time issues
    // dialog and explain the difference instead of the failure under test.
    const validation = await validateTest(request, testId)
    expect(validation.status, 'the seeded Test must validate').toBe(200)
    expect(validation.errors, 'the seeded Test must have no validation errors').toHaveLength(0)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
  })

  test('DS1: a failed Discard and Stay is stated, and the unsaved edits stay unsaved', async ({
    page,
  }) => {
    // The load reads the same path, so it fails only once the canvas is open.
    let failing = false
    await failApiRoute(page, testWorkflowRoute(testId), () =>
      failing ? { detail: REVERT_DETAIL } : null,
    )

    await openTest(page, testId)
    const drag = await dragNodeBy(page, NODE_ID, { confirmTestId: 'toolbar-save-button' })
    await expect(saveBtn(page), 'the move must leave the canvas unsaved').toBeEnabled()

    failing = true
    await page.getByTestId('toolbar-close-button').click()
    const discardAndStay = page.getByRole('button', { name: 'Discard and Stay' })
    await expect(discardAndStay).toBeVisible({ timeout: 10000 })
    await discardAndStay.click()

    // 1. The dialog goes and the card is what tells the user.
    await expect(discardAndStay, 'the close dialog must close').toHaveCount(0)
    await expectBlockedWith(page, 'Could not load saved test')

    const details = await openBlockedDetails(page)
    await expect(details).toContainText(REVERT_DETAIL)
    await expect(details).toContainText(`/tests/${testId}/workflow`)

    // 2. The edit is still there and still known to be unsaved.
    expect(
      await readNodeTransform(page, NODE_ID),
      'a failed revert must not move the canvas',
    ).toBe(drag.after)
    await expect(
      saveBtn(page),
      'the workbench must still know the edits are unsaved',
    ).toBeEnabled()

    // 3. Only a successful read discards. Try Again puts the saved workflow
    //    back and the canvas is clean afterwards.
    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    expect(await isRouteContentInert(page), 'inert must be lifted on recovery').toBe(false)
    await expect
      .poll(() => readNodeTransform(page, NODE_ID), {
        message: 'the saved workflow must be back on the canvas',
        timeout: 10000,
      })
      .toBe(drag.before)
    await expect(saveBtn(page), 'a completed discard leaves nothing to save').toBeDisabled()
  })
})
