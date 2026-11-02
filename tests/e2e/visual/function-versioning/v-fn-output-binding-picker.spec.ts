/**
 * V-FN-OUTPUT-BINDING-PICKER: the output-binding picker on a Function
 * instance config modal is the SAME widget as on a plugin config modal
 * (OutputBindingCombobox / VariableComboboxBase) - a role=combobox
 * TextField that supports type-compat filtering + "new variable" hint.
 *
 * Pass Criteria:
 *   1. Open a plugin (Log) config modal. The output-binding picker is a
 *      role=combobox TextField.
 *   2. Open a Function instance config modal with an output declared.
 *      The output-binding picker for that output is the SAME widget
 *      (role=combobox TextField).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

async function seedTest(request: APIRequestContext): Promise<string> {
  const seed = {
    name: `V-FN-OUTPUT-BINDING-PICKER ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Plugin Log + Local Function with output for binding-picker coverage',
    workflow: {
      nodes: [
        {
          id: 'log-node',
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
              values: { message: "'x'", level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: 'local-fn',
          type: 'workflowNode',
          position: { x: 500, y: 200 },
          data: {
            label: 'Function',
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
              name: 'Function',
              description: '',
              inputs: [],
              outputs: [{ name: 'result', type: 'string' }],
              variables: [],
              workflow: { nodes: [], edges: [] },
            },
          },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  return (await resp.json()).data.id
}

async function openDialog(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-OUTPUT-BINDING-PICKER (visual)', () => {
  test('Plugin Log and Function instance use the SAME combobox widget', async ({
    page,
    request,
  }) => {
    const testId = await seedTest(request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Plugin Log first.
    let dialog = await openDialog(page, 'log-node')
    const pluginCombos = dialog.locator('[role="combobox"]')
    const pluginComboCount = await pluginCombos.count()
    expect(pluginComboCount, `plugin Log dialog must render at least one combobox`).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Function next.
    dialog = await openDialog(page, 'local-fn')
    const fnCombos = dialog.locator('[role="combobox"]')
    const fnComboCount = await fnCombos.count()
    expect(
      fnComboCount,
      `function instance dialog must render at least one output-binding combobox`,
    ).toBeGreaterThan(0)
  })
})
