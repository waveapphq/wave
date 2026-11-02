/**
 * V-FN-OUTPUT-BINDING (functional): Function instance output bindings
 * auto-create caller-scope variables on save - parity with plugin saves.
 *
 * Guards `handleFunctionConfigSave`.
 *
 * Pass Criteria:
 *   1. Test has a Local Function with output `result` (string).
 *   2. Open the outer instance config modal, bind `result -> fresh_var`
 *      (a NEW name that didn't exist before).
 *   3. Save closes the modal cleanly.
 *   4. `fresh_var` appears in the saved Test's `variables` map.
 *   5. Run completes and `fresh_var` carries the body-emitted value.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN_NODE_ID = 'fn-output-binding-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-OUTPUT-BINDING ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with output result; body emits result via inner Log',
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
              description: 'Body Log emits result',
              inputs: [],
              outputs: [{ name: 'result', type: 'string' }],
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
                        values: { message: "'output-binding-emitted'", level: 'INFO' },
                        outputBindings: { line: 'result' },
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

test.describe('V-FN-OUTPUT-BINDING (functional): Function output binding creates caller var', () => {
  test('Bind result -> fresh_var on save: variable created and populated at runtime', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)
    await openTest(page, testId)

    // Open Function instance config modal.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Find the output binding row for parameter `result`. The row testid is
    // `output-row-<name>` per parameter-row.tsx; the bind cell hosts a
    // VariableComboboxBase whose underlying input has role=combobox.
    const outputRow = dialog.locator('[data-testid="output-row-result"]')
    await expect(outputRow).toBeVisible({ timeout: 5_000 })
    const outputCombobox = outputRow.locator('[role="combobox"]').first()
    await expect(outputCombobox).toBeVisible()
    await outputCombobox.click()
    await outputCombobox.fill('fresh_var')
    await outputCombobox.press('Tab')

    // Save the modal.
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Save the Test (Ctrl+S).
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(500)

    // BE confirms variable creation.
    const testResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(testResp.ok()).toBeTruthy()
    const testBody = await testResp.json()
    const variables = (testBody.data.variables ?? {}) as Record<string, unknown>
    expect(
      Object.keys(variables),
      `fresh_var must auto-create; got vars=${Object.keys(variables).join(',')}`,
    ).toContain('fresh_var')

    // Run; the function executes and the binding propagates result -> fresh_var.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    // The inner body Log line surfaces (proves the body ran end-to-end with
    // the output binding wired).
    const logs = await getLogEntries(page)
    const got = logs.some((l) => l.message.includes('output-binding-emitted'))
    expect(got, `body must run with the output binding; got ${JSON.stringify(logs)}`).toBe(true)
  })
})
