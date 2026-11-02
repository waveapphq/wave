/**
 * V-VMGR-EXEC-STOP-STATE: execution-state node behavior while debugging inside
 * a Function (functional):
 *   - Stop while paused inside a Function keeps the canvas drilled in.
 *   - Stop finalizes the still-running ancestor Function (RUNNING -> stopped).
 *   - The stopped inner node drops its paused halo.
 *   - A minimal Function node honors the wider 192px min-width floor.
 *
 * REQ-3.2.1.6 (Runtime variable override during pause/stop - the same debug
 * lifecycle the override rides on). Phase: functional-workflow.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { logNode, localFunctionNode, startEdge, createValidTest, validateTest } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-outer'
const INNER_ID = 'inner-log'

async function seedTest(request: Parameters<typeof createValidTest>[0]): Promise<string> {
  // Short label ("Fn") so the node's natural width stays below the 192 floor -
  // the rendered width is then governed by NODE_FUNCTION_MIN_WIDTH.
  const testId = await createValidTest(request, {
    name: `V-VMGR-EXEC ${randomUUID().slice(0, 8)}`,
    nodes: [
      localFunctionNode(
        FN_NODE_ID,
        'Fn',
        {
          nodes: [logNode(INNER_ID, 'Inner', "'inner-body'", { x: 200, y: 200 })],
          edges: [startEdge(INNER_ID)],
        },
        { x: 320, y: 200 },
      ),
    ],
    edges: [startEdge(FN_NODE_ID)],
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, `fixture must validate clean: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
  return testId
}

async function openTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

/** Pop the canvas back to root, where the (root-level) Function node is shown.
 *  The root indicator is the Function node itself: it only renders at root (a
 *  drilled-in canvas shows the inner body, never the parent node). */
async function popToRoot(page: Page): Promise<void> {
  const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  const back = page.locator('[data-testid="canvas-breadcrumb"] button').first()
  for (let i = 0; i < 5; i += 1) {
    if (await fnNode.isVisible().catch(() => false)) return
    if ((await back.count()) === 0) return
    await back.click()
    await page.waitForTimeout(200)
  }
}

test.describe('V-VMGR-EXEC-STOP-STATE: Stop while paused inside a Function', () => {
  test('a minimal Function node honors the 192px min-width floor', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    const box = await fnNode.boundingBox()
    expect(box, 'Function node must have a bounding box').not.toBeNull()
    // Function nodes get NODE_FUNCTION_MIN_WIDTH (192) vs 160 for plugins.
    expect(box!.width).toBeGreaterThanOrEqual(190)
  })

  test('Stop keeps the canvas in the Function and finalizes the ancestor', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)

    // Breakpoint the Function node at root, Debug, pause at the composite, then
    // Step Into - which auto-drills the canvas into the Function and pauses on
    // the inner node (the composite-debug auto-drill path).
    await toggleBreakpoint(page, FN_NODE_ID)
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()
    await expect(page.locator('[data-testid="workflow-node-' + FN_NODE_ID + '"]')).toHaveAttribute(
      'data-paused',
      'true',
      { timeout: 30_000 },
    )

    await page.locator('[data-testid="action-step-into-button"]').click()
    const inner = page.locator(`[data-testid="workflow-node-${INNER_ID}"]`)
    await expect(inner).toBeVisible({ timeout: 15_000 })
    await expect(inner).toHaveAttribute('data-paused', 'true')

    // Stop.
    await page.locator('[data-testid="action-stop-button"]').click()
    await expect(page.locator('[data-testid="stop-confirmation-dialog"]')).toBeVisible()
    await page.locator('[data-testid="stop-confirm-immediate"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'stopped',
      { timeout: 15_000 },
    )

    // The canvas STAYS inside the Function after Stop (the inner node is
    // still mounted; a pop-to-root would unmount it).
    await expect(inner).toBeVisible()
    // The stopped inner node drops its paused halo.
    await expect(inner).not.toHaveAttribute('data-paused', 'true')

    // Pop to root to inspect the ancestor Function node.
    await popToRoot(page)
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    // The still-running ancestor Function flips RUNNING -> stopped on Stop.
    await expect(fnNode).toHaveAttribute('data-execution-status', 'stopped')
  })
})
