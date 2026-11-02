/**
 * V-FN-LOCAL-VARS (functional): Function-local variables declared in the
 * Function's Var Manager seed into the runtime scope; Variable Setter
 * writes survive into the post-run scope.
 *
 * Guards `_prepare_invocation_state` seeding
 * `local_vars` with declared `function_def.variables`.
 *
 * Pass Criteria:
 *   1. Local Function declares a function-local variable
 *      `run_time: float = 0`.
 *   2. Body has Variable Setter row `run_time = 3.14`, then Log node
 *      emits the value.
 *   3. Save succeeds.
 *   4. Run completes (no "Variable 'run_time' is not declared" error).
 *   5. Console log line carries `3.14` from the function body.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN_NODE_ID = 'fn-local-vars-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-LOCAL-VARS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with a function-local variable run_time',
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
              description: 'Body Var Setter writes run_time then Log emits it',
              inputs: [],
              outputs: [],
              variables: [{ name: 'run_time', type: 'float', value: 0 }],
              workflow: {
                nodes: [
                  {
                    id: 'inner-varset',
                    type: 'workflowNode',
                    position: { x: 100, y: 200 },
                    data: {
                      label: 'Variable Setter',
                      elementType: 'variable-setter',
                      nodeType: 'control',
                      category: 'flow',
                      version: '1.0.0',
                      expressionFields: [],
                      templateFields: [],
                      variableExpressionKeys: ['run_time'],
                      variableTypes: { run_time: 'float' },
                      config: {
                        values: { variables: { run_time: '3.14' } },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: 'inner-log',
                    type: 'workflowNode',
                    position: { x: 320, y: 200 },
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
                        values: { message: "f'{run_time}'", level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [
                  { id: 'e-start-varset', source: 'start-node', target: 'inner-varset' },
                  { id: 'e-varset-log', source: 'inner-varset', target: 'inner-log' },
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
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('V-FN-LOCAL-VARS (functional): function-local variables seed into runtime scope', () => {
  // Verifies function-local variables (`function_def.variables`) seed into the
  // body's runtime scope: the Var Setter writes `run_time` and the Log reads it
  // back. The Log message is an f-string (`f'{run_time}'`) because `message` is
  // string-typed - a bare `run_time` expression yields a float and is correctly
  // rejected by the shared expression type-checker.
  test('Var Setter writes function-local variable; Log emits the new value', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    const sawValue = logs.some((l) => l.message.includes('3.14'))
    expect(sawValue, `value 3.14 must surface; got ${JSON.stringify(logs)}`).toBe(true)
  })
})
