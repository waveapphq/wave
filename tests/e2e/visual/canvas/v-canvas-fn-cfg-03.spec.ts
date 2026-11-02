/**
 * V-CANVAS-FN-CFG-03: Function instance config modal - empty-section pattern
 *
 * REQ: REQ-3.1.1.5 (Function instance parameter configuration -
 * empty-section pattern per CANVAS-213).
 *
 * Pass Criteria:
 *   1. A Function with zero declared inputs renders the italic muted
 *      placeholder ``"This Function declares no inputs."`` inside the INPUT
 *      PARAMETERS section instead of an empty table.
 *   2. A Function with zero declared outputs renders the italic muted
 *      placeholder ``"This Function declares no outputs."`` inside the
 *      OUTPUT VARIABLES section.
 *   3. Both section headers (`Input parameters`, `Output variables`) ALWAYS
 *      render - the empty pattern keeps the structural skeleton.
 *   4. The placeholder element carries `role="note"`.
 *
 * Phase: no-data (seeds via API; the only fixture state is a single Function
 * node with empty `localDefinition.inputs` and `localDefinition.outputs`).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-cfg-empty-1'

function buildSeed(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'V-CANVAS-FN-CFG-03 seed: Local Function with no inputs and no outputs',
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
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

async function seed(page: Page): Promise<string> {
  const name = `V-CANVAS-FN-CFG-03 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, { data: buildSeed(name) })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-CANVAS-FN-CFG-03: empty-section placeholder pattern', () => {
  test('zero-input + zero-output Function shows headers + italic placeholders', async ({ page }) => {
    const testId = await seed(page)
    await open(page, testId)

    const fnNode = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(fnNode).toBeVisible()
    await fnNode.locator(`[data-testid="workflow-node-body-${FN_NODE_ID}"]`).dblclick()

    // (3) Both section headers always render - even when their bodies are
    // empty - so the structural skeleton stays consistent.
    await expect(page.locator('h3', { hasText: 'Input parameters' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('h3', { hasText: 'Output variables' })).toBeVisible()

    // (1) Inputs placeholder.
    const inputsPlaceholder = page.locator('[data-testid="function-empty-section-inputs"]')
    await expect(inputsPlaceholder).toBeVisible()
    await expect(inputsPlaceholder).toHaveText('This Function declares no inputs.')

    // (2) Outputs placeholder.
    const outputsPlaceholder = page.locator('[data-testid="function-empty-section-outputs"]')
    await expect(outputsPlaceholder).toBeVisible()
    await expect(outputsPlaceholder).toHaveText('This Function declares no outputs.')

    // (4) Placeholders carry role="note" for assistive tech.
    await expect(inputsPlaceholder).toHaveAttribute('role', 'note')
    await expect(outputsPlaceholder).toHaveAttribute('role', 'note')
  })
})
