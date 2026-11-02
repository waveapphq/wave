/**
 * V-VARSET-OUTPUT (functional): Variable Setter inside a Function body
 * ASSIGNS to a declared output rather than failing with
 * "Name already exists in this scope".
 *
 * Guards the `createVariableSetterVariables` / `createOutputBindingVariables`
 * `reservedScopeNames` skip.
 *
 * Pass Criteria:
 *   1. Local Function declares output `exit_msg` (string, default `some_var`).
 *   2. Body has a Variable Setter row that ASSIGNS `exit_msg = 'changed!'`.
 *   3. Save succeeds (no "Name already exists in this scope" error).
 *   4. Run completes (workflow status -> passed).
 *   5. The Function's runtime output map carries `exit_msg = 'changed!'`
 *      (verifiable via the outer caller's outputBinding -> caller variable).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN_NODE_ID = 'fn-varset-output-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-VARSET-OUTPUT ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function whose body assigns output exit_msg via Variable Setter',
    variables: { caller_var: { type: 'string', value: '' } },
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
            config: { values: {}, outputBindings: { exit_msg: 'caller_var' }, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'Body: VarSetter assigns exit_msg then Log emits it',
              inputs: [],
              outputs: [{ name: 'exit_msg', type: 'string' }],
              variables: [],
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
                      variableExpressionKeys: ['exit_msg'],
                      config: {
                        values: { variables: { exit_msg: "'changed!'" } },
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
                        values: { message: 'exit_msg', level: 'INFO' },
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
        {
          id: 'after-log',
          type: 'workflowNode',
          position: { x: 600, y: 200 },
          data: {
            label: 'Log_2',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: 'caller_var', level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID },
        { id: 'e-fn-after', source: FN_NODE_ID, target: 'after-log' },
      ],
    },
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
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

test.describe('V-VARSET-OUTPUT (functional): Variable Setter assigns Function outputs', () => {
  test('Save succeeds, run completes, exit_msg = "changed!" propagates to caller_var', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)

    // Validate must NOT flag "Name already exists in this scope" for exit_msg.
    const valResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
    const valBody = await valResp.json().catch(() => null)
    const errors = (
      valBody?.data?.errors ??
      valBody?.error?.details?.[0]?.errors ??
      valBody?.errors ??
      []
    ) as Array<Record<string, unknown>>
    const collision = errors.some((e) =>
      ((e.message as string) ?? '').toLowerCase().includes('already exists'),
    )
    expect(
      collision,
      `must not raise "already exists" for exit_msg; errors=${JSON.stringify(errors)}`,
    ).toBe(false)

    await openTest(page, testId)
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    // Inner Log emits the assigned exit_msg = 'changed!'.
    const logs = await getLogEntries(page)
    const sawChanged = logs.some((l) => l.message.includes('changed!'))
    expect(sawChanged, `'changed!' must appear; got ${JSON.stringify(logs)}`).toBe(true)
  })
})
