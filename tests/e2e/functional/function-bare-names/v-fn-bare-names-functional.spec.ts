/**
 * V-FN-BARE-NAMES (functional): Function bodies access inputs by BARE name
 * (`message: some_text`) - there is no `input.` / `output.` namespace.
 *
 * `_build_eval_variables` exposes bare names directly into the eval scope.
 *
 * Pass Criteria:
 *   1. Local Function declares input `some_text` (string, required); body's
 *      Log node uses `message: some_text` (bare, NOT `input.some_text`).
 *   2. Outer caller binds `some_text` to a string literal.
 *   3. Save succeeds; FE pre-run validation passes (no UNDECLARED_VARIABLE).
 *   4. Run completes (`workflow-status` -> passed).
 *   5. The executed inner Log line contains the bound value.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN_NODE_ID = 'fn-bare-1'
const BOUND_VALUE = 'BareName-Verified'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed: Record<string, unknown> = {
    name: `V-FN-BARE-NAMES ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with input `some_text` accessed via bare name in body',
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
              description: 'Logs the bound value of input some_text using a bare name reference',
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
    variables: {},
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
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

test.describe('V-FN-BARE-NAMES (functional): function inputs accessed by bare name', () => {
  test('Validate + Run with bare-name input access produces the bound value in logs', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const testId = await seedTest(request)

    // Validate passes (no UNDECLARED_VARIABLE for the bare `some_text` ref).
    // /validate is POST; 422 means validation issues are present (read from body).
    const valResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
    const valBody = await valResp.json().catch(() => null)
    const errors =
      valBody?.data?.errors ??
      valBody?.error?.details?.[0]?.errors ??
      valBody?.errors ??
      []
    expect(
      errors.filter(
        (e: Record<string, unknown>) =>
          (e.code as string) === 'UNDECLARED_VARIABLE' ||
          (e.message as string)?.includes('input.some_text'),
      ),
      `validation errors must not flag bare-name input ref; got ${JSON.stringify(errors)}`,
    ).toHaveLength(0)

    await openTest(page, testId)
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })

    const logs = await getLogEntries(page)
    const matched = logs.some((l) => l.message.includes(BOUND_VALUE))
    expect(matched, `bound value must appear in console; got ${JSON.stringify(logs)}`).toBe(true)
  })
})
