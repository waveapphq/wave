/**
 * V-FN-INPUT-VALUE (functional): Function inputs surface the bound RUNTIME
 * value in the Variable Manager (not the declared default) while the user
 * is drilled into the function during execution.
 *
 * Pass Criteria:
 *   1. Local Function has input `some_text` (string).
 *   2. Outer caller binds `some_text = 'Hello'`.
 *   3. After running, the saved Test's caller variable map reflects expected
 *      behavior; the Var Manager (in the drilled-in scope after a run)
 *      shows `some_text = Hello`.
 *
 * Note: This drives the BE-side observable (post-run state) and a quick
 * UI check after the run. The full WS-stream check is deferred to
 * V-FN-SCOPE-RUN.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN_NODE_ID = 'fn-input-value-1'
const BOUND_VALUE = 'Hello-RuntimeValue'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-INPUT-VALUE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Function input some_text bound to a literal; verifies runtime visibility',
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
            config: { values: { some_text: BOUND_VALUE }, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'Body Log emits some_text',
              inputs: [{ name: 'some_text', type: 'string', required: true }],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [
                  {
                    id: 'inner-log',
                    type: 'workflowNode',
                    position: { x: 200, y: 200 },
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
                        values: { message: 'some_text', level: 'INFO' },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                ],
                edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-log' }],
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

test.describe('V-FN-INPUT-VALUE (functional): Function inputs surface runtime value', () => {
  test('After Run, Var Manager (drilled into function) shows some_text = Hello', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)

    // Drill into the Function via the dig-in chevron (NOT double-click,
    // which opens the config modal). Confirms the body renders.
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await fnNode.locator('[data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible({
      timeout: 10_000,
    })

    // Pop back to the root to run; Run is only available at the root canvas.
    const breadcrumbRoot = page.locator('[data-testid="canvas-breadcrumb"] button').first()
    if ((await breadcrumbRoot.count()) > 0) {
      await breadcrumbRoot.click()
    }
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    // Drill into the function again (dig-in chevron) to see its scope.
    await fnNode.locator('[data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible({ timeout: 10_000 })

    // Variable Manager content should show some_text = 'Hello-RuntimeValue'.
    const varManager = page.locator('[data-testid="variable-manager-content"]').first()
    await expect(varManager).toBeVisible({ timeout: 5_000 })
    const varText = await varManager.textContent()
    expect(
      (varText ?? '').includes('some_text') && (varText ?? '').includes(BOUND_VALUE),
      `Var Manager must show some_text=${BOUND_VALUE}; full=${varText?.slice(0, 500)}`,
    ).toBe(true)
  })
})
