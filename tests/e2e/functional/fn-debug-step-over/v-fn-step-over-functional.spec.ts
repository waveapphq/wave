/**
 * V-FN-STEP-OVER (functional): Step Over while a full-test Debug run is
 * paused on a node INSIDE a Function body advances to the next inner
 * sibling - it does not silently run the whole body.
 *
 * Guards the step-over completion hook in
 * `core/functions/executor.py::_walk_body_with_engine`.
 *
 * Observability: an inner-function pause exposes neither a granular WS
 * event nor the inner node id on the /status endpoint (status reports the
 * OUTER function node). The robust signal - identical to the existing
 * `debug-step` suite - is the CONSOLE LOG: which inner nodes have emitted
 * their line at each pause point.
 *
 * Pass Criteria:
 *   1. Drill into a Local Function (A -> B -> C), set a breakpoint on B,
 *      pop to root, run full Debug. Session pauses; only A has logged.
 *   2. Step Over -> B logs; session re-pauses before C (C has not logged).
 *   3. Continue -> session passes; C logs.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import type { Page, APIRequestContext } from '@playwright/test'

const FN_NODE_ID = 'fn-step-over-1'

function logNode(id: string, label: string, message: string, x: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y: 200 },
    data: {
      label,
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { message: `'${message}'`, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
  }
}

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-STEP-OVER ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function body A -> B -> C for step-over coverage',
    variables: {},
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'Function_1',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'A -> B -> C body',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
                  logNode('inner-A', 'A', 'fn-step-A', 100),
                  logNode('inner-B', 'B', 'fn-step-B', 300),
                  logNode('inner-C', 'C', 'fn-step-C', 500),
                ],
                edges: [
                  { id: 'e-start-a', source: 'start-node', target: 'inner-A' },
                  { id: 'e-a-b', source: 'inner-A', target: 'inner-B' },
                  { id: 'e-b-c', source: 'inner-B', target: 'inner-C' },
                ],
              },
            },
          },
        },
      ],
      edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
    },
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function drillIn(page: Page) {
  const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  await fnNode.locator('[data-testid="node-dig-in"]').click()
  await expect(page.locator('[data-testid="workflow-node-inner-B"]')).toBeVisible({ timeout: 10_000 })
}

async function popToRoot(page: Page) {
  const back = page.locator('[data-testid="canvas-breadcrumb"] button').first()
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('[data-testid="run-button"]').isVisible().catch(() => false)) return
    if ((await back.count()) === 0) return
    await back.click()
    await page.waitForTimeout(150)
  }
}

async function toggleBreakpoint(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

test.describe('V-FN-STEP-OVER (functional): Step Over inside a Function body', () => {
  test('Step Over advances B -> C inside the function body', async ({ page, request }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)

    // Drill in, breakpoint on B, pop to root.
    await drillIn(page)
    await toggleBreakpoint(page, 'inner-B')
    await popToRoot(page)

    // Full Debug.
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })

    // Only A has logged at the first pause (paused before B runs).
    const logsAtB = await getLogTexts(page)
    expect(
      logsAtB.some((m) => m.includes('fn-step-A')),
      `A should have logged; got ${JSON.stringify(logsAtB)}`,
    ).toBe(true)
    expect(logsAtB.some((m) => m.includes('fn-step-B')), 'B not logged yet').toBe(false)

    // Step Over.
    const stepBtn = page.locator('[data-testid="action-step-over-button"]')
    await expect(stepBtn).toBeVisible({ timeout: 10_000 })
    await stepBtn.click()

    // Re-pause; B has now logged, C has not.
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
    await expect
      .poll(async () => (await getLogTexts(page)).some((m) => m.includes('fn-step-B')), {
        timeout: 15_000,
      })
      .toBe(true)
    expect(
      (await getLogTexts(page)).some((m) => m.includes('fn-step-C')),
      'C must not run while paused on it',
    ).toBe(false)

    // Continue -> passed, C logs.
    await page.locator('[data-testid="action-continue-button"]').click()
    await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
    await expect
      .poll(async () => (await getLogTexts(page)).some((m) => m.includes('fn-step-C')), {
        timeout: 15_000,
      })
      .toBe(true)
  })
})
