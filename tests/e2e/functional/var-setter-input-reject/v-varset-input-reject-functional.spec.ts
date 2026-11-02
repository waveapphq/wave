/**
 * V-VARSET-INPUT-REJECT (functional): Variable Setter inside a Function
 * body rejects writes to Function inputs - inline validator error + Save
 * stays disabled + autocomplete never offers input names as targets.
 *
 * Pass Criteria:
 *   1. Drill into a Local Function whose input is `x`.
 *   2. In a Variable Setter row, typing `x` as the variable NAME triggers
 *      the inline validator with text matching "input" + "read-only".
 *   3. Save remains disabled while the row carries that error.
 *   4. The autocomplete suggestion list for the variable-name field NEVER
 *      offers `x` (it is filtered out as a Function input source).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-varset-input-reject-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-VARSET-INPUT-REJECT ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Local Function with input `x` and a Variable Setter writing a local',
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
            config: { values: { x: 'foo' }, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'Function_1',
              description: 'One Variable Setter row on a local',
              inputs: [{ name: 'x', type: 'string', required: true }],
              outputs: [],
              variables: [{ name: 'note', type: 'string', value: '' }],
              workflow: {
                nodes: [
                  {
                    id: 'inner-varset',
                    type: 'workflowNode',
                    position: { x: 200, y: 200 },
                    data: {
                      label: 'Variable Setter',
                      elementType: 'variable-setter',
                      nodeType: 'control',
                      category: 'flow',
                      version: '1.0.0',
                      expressionFields: [],
                      templateFields: [],
                      variableExpressionKeys: [],
                      variableTypes: { note: 'string' },
                      // A Variable Setter needs a row to save; the test retargets it at the input.
                      config: { values: { variables: { note: 'hi' } }, outputBindings: {}, profileBindings: [] },
                    },
                  },
                ],
                edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-varset' }],
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
  expect(body?.success === true, `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-VARSET-INPUT-REJECT (functional): Variable Setter rejects input names', () => {
  // Drilled into a Function, an inner Variable Setter sees the Function's
  // declared inputs (surfaced by use-enriched-variables as
  // `source: 'Function input'`): typing an input name `x` filters it out of
  // autocomplete, fires the read-only validator, and disables Save.
  test('Inline validator flags input write; Save disabled; autocomplete filters input', async ({
    page,
    request,
  }) => {
    const testId = await seedTest(request)
    await openTest(page, testId)

    // Drill into the Function via the dig-in chevron (double-click opens the
    // config modal by design).
    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await fnNode.locator('[data-testid="node-dig-in"]').click()

    // The drilled-in canvas should expose the inner Variable Setter node.
    const varSetterNode = page.locator('[data-testid="workflow-node-inner-varset"]')
    await expect(varSetterNode).toBeVisible({ timeout: 10_000 })

    // Open Variable Setter config modal (double-click is correct here).
    await varSetterNode.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Ensure at least one assignment row exists (row 0). The Var Setter
    // modal seeds an empty row; if not, click the add button.
    const nameInput = dialog.locator('[data-testid="varset-name-input-0"]')
    if ((await nameInput.count()) === 0) {
      await dialog.locator('[data-testid="varset-add-button"]').click()
    }
    await expect(nameInput).toBeVisible({ timeout: 5_000 })

    // Type the Function input name `x` as the variable to set.
    await nameInput.click()
    await nameInput.fill('x')

    // Autocomplete (if any) must NOT offer `x` as a settable target - input
    // names are filtered out of the variable-name suggestion source.
    await page.waitForTimeout(300)
    const offered = await page.locator('[role="option"]').allTextContents()
    expect(
      offered.some((t) => t.trim() === 'x'),
      `autocomplete must not offer input name 'x'; got ${JSON.stringify(offered)}`,
    ).toBe(false)

    // Commit to trigger validation.
    await nameInput.press('Tab')

    // Inline validator must fire (text mentions input + read-only).
    const validatorText = (await dialog.textContent()) ?? ''
    expect(
      /input/i.test(validatorText) && /read.?only/i.test(validatorText),
      `dialog must surface inline validator naming input + read-only; body=${validatorText.slice(0, 1000)}`,
    ).toBe(true)

    // Save must be disabled while the row carries the read-only error. The
    // Save button uses the native `disabled` attribute (CSS `.btn:disabled`
    // grays it), so assert that directly rather than aria-disabled/class tokens.
    const saveBtn = dialog.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeDisabled()
  })
})
