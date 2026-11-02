/**
 * V-CTRL-ASSERT-DISABLED-IN-FUNCTION-01: disabled Assert INSIDE a Function body.
 *
 * Sibling regression to v-ctrl-assert-disabled-01: confirm the same
 * pass-through semantics apply when the disabled Assert lives inside a
 * Function. The root engine and the Function-body walker are TWO
 * different code paths.
 *
 * Pass criteria:
 *   1. Function block ends ``passed``
 *   2. Inner pass-branch Log ran (its message appears in the run log)
 *   3. Inner fail-branch Log did NOT run (its message does NOT appear)
 *   4. session ends ``passed``
 */
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts } from '../../helpers/log-reader'

const BASE = `http://localhost:${BACKEND_PORT}`

const FN_ID = 'fn-with-disabled-assert'
const INNER_ASSERT_ID = 'inner-assert-disabled'
const INNER_PASS_LOG_ID = 'inner-pass-log'
const INNER_FAIL_LOG_ID = 'inner-fail-log'

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-ASSERT-DISABLED-IN-FUNCTION-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Disabled split-mode Assert INSIDE a local Function body',
    workflow: {
      nodes: [
        {
          id: FN_ID,
          type: 'workflowNode',
          position: { x: 200, y: 200 },
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
            localDefinition: {
              name: 'Function_1',
              workflow: {
                nodes: [
                  {
                    id: INNER_ASSERT_ID,
                    type: 'workflowNode',
                    position: { x: 200, y: 100 },
                    data: {
                      label: 'Assert_1',
                      elementType: 'assert',
                      nodeType: 'control',
                      category: 'control',
                      version: '1.0.0',
                      disabled: true,
                      config: {
                        values: {
                          mode: 'split',
                          assertions: [
                            {
                              id: 'a1',
                              kind: 'literal',
                              expected: 'true',
                              actual: 'true',
                              comparator: 'equals',
                            },
                          ],
                          fail_current_scope: false,
                        },
                        outputBindings: {},
                        profileBindings: [],
                      },
                    },
                  },
                  {
                    id: INNER_PASS_LOG_ID,
                    type: 'workflowNode',
                    position: { x: 80, y: 300 },
                    data: {
                      label: 'Inner_Pass_Log',
                      elementType: 'log',
                      nodeType: 'plugin',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'INNER-PASS-FIRED'", level: 'INFO' },
                        profileBindings: [],
                        outputBindings: {},
                      },
                    },
                  },
                  {
                    id: INNER_FAIL_LOG_ID,
                    type: 'workflowNode',
                    position: { x: 380, y: 300 },
                    data: {
                      label: 'Inner_Fail_Log',
                      elementType: 'log',
                      nodeType: 'plugin',
                      version: '1.0.0',
                      expressionFields: ['message'],
                      templateFields: [],
                      variableExpressionKeys: [],
                      config: {
                        values: { message: "'INNER-FAIL-FIRED'", level: 'INFO' },
                        profileBindings: [],
                        outputBindings: {},
                      },
                    },
                  },
                ],
                edges: [
                  { id: 'e-start-assert', source: 'start-node', target: INNER_ASSERT_ID },
                  { id: 'e-assert-pass', source: INNER_ASSERT_ID, target: INNER_PASS_LOG_ID, sourceHandle: 'pass' },
                  { id: 'e-assert-fail', source: INNER_ASSERT_ID, target: INNER_FAIL_LOG_ID, sourceHandle: 'fail' },
                ],
              },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start-fn', source: 'start-node', target: FN_ID },
      ],
    },
  }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function runFromUiAndWaitTerminal(page: Page): Promise<string> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 20_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-CTRL-ASSERT-DISABLED-IN-FUNCTION-01', () => {
  test('disabled Assert inside a Function: pass branch runs, fail branch cascade-skips', async ({
    request,
    page,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedFixture(request)

    await page.setViewportSize({ width: 1280, height: 900 })
    // Clear any active workbench session BEFORE navigating - the session-
    // recovery dialog otherwise intercepts the env-selector click.
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    const finalStatus = await runFromUiAndWaitTerminal(page)
    expect(finalStatus).toBe('passed')

    const logs = await getLogTexts(page)
    const joined = logs.join('\n')
    expect(joined, 'inner pass-branch Log must have fired').toContain('INNER-PASS-FIRED')
    expect(joined, 'inner fail-branch Log must NOT have fired (cascade-skipped)').not.toContain('INNER-FAIL-FIRED')
  })
})
