/**
 * V-FN-VIEW-NODIRTY (functional): opening the read-only View leaves no dirty state.
 *
 * The read-only View seeds its synthetic root with { skipDirty: true }, so browsing
 * to /tests and opening a test shows no switch dialog for a phantom draft.
 *
 * REQ: REQ-3.2.1.1
 *
 * Pass Criteria:
 *   1. After opening the View and doing nothing, opening a real Test from the
 *      list navigates DIRECTLY - no switch-test-dialog.
 *   2. The chosen Test loads.
 *
 * Phase: functional-workflow. Self-seeds a published Function + a Test via REST.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  openFunctionView,
  createValidTest,
  logNode,
  startEdge,
} from '../../helpers/fn-seed'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { randomUUID } from 'node:crypto'

test.describe('V-FN-VIEW-NODIRTY (functional): a clean View does not trip the switch guard', () => {
  test('open the View, do nothing, then open a Test - no switch dialog', async ({ page, request }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-NoDirty-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })
    const testName = `View-NoDirty-Target-${randomUUID().slice(0, 6)}`
    const testId = await createValidTest(request, {
      name: testName,
      nodes: [logNode('t-log', 'TestLog', "'hi'")],
      edges: [startEdge('t-log')],
    })

    // 1. Open the View, do nothing else.
    await openFunctionView(page, fn.functionId, fn.version)

    // 2. Browse to Tests CLIENT-SIDE (sidebar link - the store persists in memory,
    //    so a lingering dirty flag would trip the editTest switch guard).
    await page.locator('a[href="/tests"]').first().click()
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
    await page.locator('[data-testid="search-input"] input').fill(testName)
    const nameCell = page.locator(`[data-testid="test-row"][data-row-id="${testId}"] [data-testid="test-name"]`)
    await expect(nameCell).toBeVisible()

    // 3. Open the Test CLIENT-SIDE. A clean View must NOT raise the switch dialog.
    await nameCell.click()
    await waitForCanvasLoad(page)
    await expect(page.locator('[data-testid="switch-test-dialog"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-t-log"]')).toBeVisible({ timeout: 15_000 })
  })
})
