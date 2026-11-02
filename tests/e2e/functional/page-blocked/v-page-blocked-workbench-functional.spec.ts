/**
 * V-PAGE-BLOCKED-WORKBENCH: a failed workbench read never becomes a clean canvas
 *
 * Phase: functional-workflow. A failed validation read and a failed system-variables
 * read both block the page; nothing is applied to the canvas, and "validation
 * unavailable" never renders as "validation passed".
 *
 * Design Decisions: LIST-10 (a supporting read blocks its surface), LIST-16
 * (Try Again re-runs only what failed), LIST-19 (a read the surface started for
 * itself blocks too).
 *
 * Pass Criteria:
 *  1. With the validation read failing, opening a Test blocks the workbench,
 *     the card names the validation read, and NOTHING is applied: no node
 *     reaches the canvas and the canvas never reports itself ready.
 *  2. Try Again over a restored backend clears the card and finishes the load
 *     from the reads that had already succeeded, so the Test's node appears.
 *  3. A failed system-variables read blocks the workbench instead of quietly
 *     standing in an empty map, and its Try Again recovers it.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { failApiRoute } from '../../helpers/api-route'
import {
  SYSTEM_VARIABLES_ROUTE,
  blockedCard,
  expectBlockedWith,
  isRouteContentInert,
  retryBlockedPage,
  startAtRoot,
  testValidateRoute,
} from '../../helpers/page-block'
import {
  createValidTest,
  logNode,
  releaseWorkbenchOwnership,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'

const TEST_NAME = `PBLK Workbench ${Date.now()}`
const NODE_ID = 'pblk-log'
const VALIDATION_DETAIL = 'Validation service unavailable'
const SYSTEM_VARS_DETAIL = 'System variable store unavailable'

// Held long enough that the workbench's other reads have all landed first, so
// the card under test is the one the validation read raised.
const VALIDATION_DELAY_MS = 1500

let testId = ''

function canvasNodes(page: Page): Locator {
  return page.locator('[data-testid^="workflow-node-"][data-nodetype]')
}

/** Free the single global workbench slot and drop any leftover session. */
async function freeWorkbench(page: Page): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
}

test.describe('V-PAGE-BLOCKED-WORKBENCH: a failed read blocks instead of faking a clean load', () => {
  test.beforeAll(async ({ request }) => {
    testId = await createValidTest(request, {
      name: TEST_NAME,
      nodes: [logNode(NODE_ID, 'Log', "'workbench'")],
      edges: [startEdge(NODE_ID)],
    })
    // The recovery leg asserts the canvas loads, so the seed must validate clean
    // or the load-time issues dialog would explain the difference instead.
    const validation = await validateTest(request, testId)
    expect(validation.status, 'the seeded Test must validate').toBe(200)
    expect(validation.errors, 'the seeded Test must have no validation errors').toHaveLength(0)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('WB1: a failed validation read blocks the workbench and applies nothing', async ({
    page,
  }) => {
    let failing = true
    await freeWorkbench(page)
    await startAtRoot(page)
    await failApiRoute(
      page,
      testValidateRoute(testId),
      () => (failing ? { detail: VALIDATION_DETAIL, delayMs: VALIDATION_DELAY_MS } : null),
      'POST',
    )

    await page.goto(`/workbench?editTest=${testId}`)
    await expectBlockedWith(page, 'Could not load test validation')

    // Nothing was applied: no node reached the canvas, and the workbench never
    // adopted the Test's identity.
    await expect(canvasNodes(page), 'a blocked load must not populate the canvas').toHaveCount(0)
    await expect(
      page.locator('[data-testid="canvas-breadcrumb"]'),
      'a blocked load must not open the Test',
    ).toContainText('Draft Workflow')

    // Try Again finishes the load from the reads that already succeeded.
    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    await expect(page.locator(`[data-testid="workflow-node-${NODE_ID}"]`)).toBeVisible({
      timeout: 20000,
    })
    expect(await isRouteContentInert(page), 'inert must be lifted on recovery').toBe(false)
    await expect(page.getByTestId('canvas-loading-overlay')).toHaveClass(/pointer-events-none/)
  })

  test('WB2: a failed system-variables read blocks the workbench', async ({ page }) => {
    let failing = true
    await freeWorkbench(page)
    await startAtRoot(page)
    await failApiRoute(page, SYSTEM_VARIABLES_ROUTE, () =>
      failing ? { detail: SYSTEM_VARS_DETAIL } : null,
    )

    await page.goto('/workbench')
    await expectBlockedWith(page, 'Could not load system variables')

    failing = false
    await retryBlockedPage(page)
    await expect(blockedCard(page)).toHaveCount(0)
    expect(await isRouteContentInert(page), 'inert must be lifted on recovery').toBe(false)
  })
})
