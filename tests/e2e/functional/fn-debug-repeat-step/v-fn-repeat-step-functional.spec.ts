/**
 * V-FN-REPEAT-STEP (functional): Repeat Step on a node INSIDE a Function
 * body re-runs the SAME node, not the whole function.
 *
 * Repeat Step inside a Function body targets the paused
 * inner node, and Continue after the repeats does not run it again
 * (REQ-3.2.1.4 Commit semantics).
 *
 * Observability (same rationale as V-FN-STEP-OVER): inner-function pauses
 * are observed via the CONSOLE LOG. The marker Log upstream of the repeated
 * node must stay at a single entry across repeats - if the function
 * restarted, the marker would log again.
 *
 * Pass Criteria:
 *   1. Drill into a Local Function: Marker -> VarSetter(counter+=1) -> emit
 *      Log. Breakpoint on the VarSetter. Full Debug pauses; Marker logged
 *      exactly once.
 *   2. Repeat Step three times. Session stays paused; Marker STILL logged
 *      exactly once (no full-function restart).
 *   3. Continue -> passed; the emit Log reads counter=3: each Repeat Step ran
 *      the VarSetter once and Continue did not run it again.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import type { Page, APIRequestContext } from '@playwright/test'

const FN_NODE_ID = 'fn-repeat-step-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-REPEAT-STEP ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with body VarSetter incrementing counter',
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
              description: 'Marker Log -> VarSetter increments counter -> Log emits counter',
              inputs: [],
              outputs: [],
              variables: [{ name: 'counter', type: 'integer', value: 0 }],
              workflow: {
                nodes: [
                  {
                    id: 'inner-marker',
                    type: 'workflowNode',
                    position: { x: 80, y: 200 },
                    data: {
                      label: 'Marker',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'fn-repeat-marker'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-incr',
                    type: 'workflowNode',
                    position: { x: 280, y: 200 },
                    data: {
                      label: 'Variable Setter',
                      elementType: 'variable-setter',
                      nodeType: 'control',
                      category: 'flow',
                      version: '1.0.0',
                      expressionFields: [],
                      templateFields: [],
                      variableExpressionKeys: ['counter'],
                      variableTypes: { counter: 'integer' },
                      config: {
                        values: { variables: { counter: 'counter + 1' } },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-emit',
                    type: 'workflowNode',
                    position: { x: 500, y: 200 },
                    data: {
                      label: 'Log',
                      elementType: 'log',
                      nodeType: 'plugin',
                      category: 'system',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "f'counter={counter}'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [
                  { id: 'e-start-marker', source: 'start-node', target: 'inner-marker' },
                  { id: 'e-marker-incr', source: 'inner-marker', target: 'inner-incr' },
                  { id: 'e-incr-emit', source: 'inner-incr', target: 'inner-emit' },
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
  expect(body?.success).toBeTruthy()
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
  await expect(page.locator('[data-testid="workflow-node-inner-incr"]')).toBeVisible({
    timeout: 10_000,
  })
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

test.describe('V-FN-REPEAT-STEP (functional): Repeat Step inside Function body', () => {
  test('Repeat Step on a VarSetter re-runs the node without restarting the function', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)

    await drillIn(page)
    await toggleBreakpoint(page, 'inner-incr')
    await popToRoot(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })

    // Marker logged exactly once before the breakpoint.
    await expect
      .poll(
        async () => (await getLogTexts(page)).filter((m) => m.includes('fn-repeat-marker')).length,
        { timeout: 15_000 },
      )
      .toBe(1)

    // Repeat Step three times - session stays paused, marker stays at 1.
    const repeatBtn = page.locator('[data-testid="action-repeat-step-button"]')
    for (let i = 0; i < 3; i += 1) {
      await expect(repeatBtn).toBeVisible({ timeout: 10_000 })
      await repeatBtn.click()
      await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 15_000 })
    }

    const markerCount = (await getLogTexts(page)).filter((m) =>
      m.includes('fn-repeat-marker'),
    ).length
    expect(markerCount, 'marker must stay at 1 (no full-function restart)').toBe(1)

    // Continue -> passed; the VarSetter ran once per Repeat Step and not again on Continue.
    await page.locator('[data-testid="action-continue-button"]').click()
    await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
    await expect
      .poll(async () => (await getLogTexts(page)).filter((m) => /^counter=\d+$/.test(m)), {
        timeout: 15_000,
      })
      .toEqual(['counter=3'])
  })
})
