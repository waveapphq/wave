/**
 * V-FN-DRILL-READ-FAILURE: a failed Function body read lands on the gesture
 * and the canvas stays live
 *
 * Phase: functional-workflow. Opening a published Function's body from the
 * block menu resolves the pinned version first. That read belongs to the
 * gesture the user just made, not to the canvas they are already on, so the
 * failure is reported in a toast and the canvas is left alone. The companion
 * spec v-fn-dig-in guards that the same failure does not drill or strand the
 * glyph; this one guards where the failure is reported and that the surface
 * survives it.
 *
 * Design Decisions: LIST-26 (an action the user triggered reports at the
 * gesture, in its toast), LIST-19 (only reads a surface owns block it).
 *
 * Pass Criteria:
 *  1. A failed body read raises the "Could Not Load Function Body" toast
 *     carrying the server's reason.
 *  2. Nothing is blocked: the canvas keeps the instance and the breadcrumb.
 *  3. The same gesture over a restored backend opens the body.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { failApiRoute } from '../../helpers/api-route'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { expectNotBlocked, functionVersionRoute } from '../../helpers/page-block'
import {
  createValidTest,
  openTest,
  publishLibraryFunction,
  releaseWorkbenchOwnership,
  sharedNode,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'

const STAMP = `${Date.now()}`
const FN_NODE_ID = 'fn-drill-failure'
const BODY_DETAIL = 'Function store unavailable'

let library: SeededLibraryFunction
let testId = ''

test.describe('V-FN-DRILL-READ-FAILURE: the drill reports itself and leaves the canvas alone', () => {
  test.beforeAll(async ({ request }) => {
    library = await publishLibraryFunction(request, {
      name: `FNDRILL ${STAMP}`,
      workflow: { nodes: [], edges: [] },
    })
    testId = await createValidTest(request, {
      name: `FNDRILL Host ${STAMP}`,
      nodes: [
        sharedNode(FN_NODE_ID, {
          functionId: library.functionId,
          functionVersion: library.version,
          label: library.name,
          originalLibraryName: library.name,
        }),
      ],
      edges: [],
    })
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    await request
      .delete(`${BACKEND_URL}/functions/${library.functionId}?cascade=true`)
      .catch(() => undefined)
  })

  test('FD1: a failed body read is a toast, and the canvas the user is on is untouched', async ({
    page,
  }) => {
    await openTest(page, testId)
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(node).toBeVisible({ timeout: 20000 })

    // Armed after the canvas is up, so the failure under test is the drill's.
    let failing = true
    const versionRead = functionVersionRoute(library.functionId, library.version)
    await failApiRoute(page, versionRead, () => (failing ? { detail: BODY_DETAIL } : null))

    await clickNodeKebabItem(page, FN_NODE_ID, /^Open$/)

    // 1. The gesture reports its own failure.
    const toast = page.locator('[data-toast]', { hasText: 'Could Not Load Function Body' })
    await expect(toast).toBeVisible({ timeout: 15000 })
    await expect(toast).toContainText(BODY_DETAIL)

    // 2. The canvas is not the failed surface, and the drill did not happen.
    await expectNotBlocked(page)
    await expect(node).toBeVisible()
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"] svg.lucide-square-function'),
      'a failed body read must not drill',
    ).toHaveCount(0)

    // 3. The same gesture works once the read does.
    failing = false
    await clickNodeKebabItem(page, FN_NODE_ID, /^Open$/)
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"] svg.lucide-square-function').first(),
    ).toBeVisible({ timeout: 15000 })
  })
})
