/**
 * V-FN-CONFIG-01: Function instance config modal.
 * Design Decisions: FNCFG-1, FNCFG-2, FNCFG-4
 * REQ: REQ-3.1.2.4
 *
 * Runs in the no-data light + dark projects (seeds via POST /tests).
 *
 * Pass Criteria:
 * 1. FNCFG-1: the INPUT and OUTPUT tables share one 4-column template (both reserve
 *    the leading info column) so they align.
 * 2. FNCFG-2: the (i) info icon shows on inputs AND outputs that carry a Description.
 * 3. FNCFG-4: a published (shared) instance's declared inputs/outputs populate.
 * 4. FNCFG-4: an edit-mode instance's declared inputs/outputs populate.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { publishLibraryFunction } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)

const INPUTS = [
  { name: 'recipient', type: 'string', required: false, default: '', description: 'Email recipient address' },
]
const OUTPUTS = [{ name: 'result', type: 'string', description: 'The computed result value' }]

async function seedTest(page: Page, name: string, node: Record<string, unknown>): Promise<string> {
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'V-FN-CONFIG-01 seed',
      workflow: { nodes: [node], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openConfig(page: Page, testId: string, nodeId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await page.locator(`[data-testid="workflow-node-body-${nodeId}"]`).dblclick()
  await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
}

/** Header text of the input + output parameter tables in the open config modal. */
async function headerArrays(page: Page): Promise<{ input: string[]; output: string[] }> {
  // The one Block window: each table sits beside its section heading (CANVAS-207).
  const inputSection = configSheet(page).locator('h3', { hasText: /^Input Parameters$/ }).locator('xpath=..')
  const outputSection = configSheet(page).locator('h3', { hasText: /^Output Variables$/ }).locator('xpath=..')
  return {
    input: await inputSection.locator('thead th').allTextContents(),
    output: await outputSection.locator('thead th').allTextContents(),
  }
}

test.describe('V-FN-CONFIG-01: config modal (FNCFG-1, FNCFG-2, FNCFG-4)', () => {
  test('FNCFG-1 + FNCFG-2: aligned tables; (i) on inputs AND outputs with a Description', async ({ page }) => {
    const nodeId = 'fn-cfg-local'
    const testId = await seedTest(page, `V-FN-CONFIG-01 local ${RUN}`, {
      id: nodeId,
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
          description: 'seed',
          workflow: { nodes: [], edges: [] },
          inputs: INPUTS,
          outputs: OUTPUTS,
          variables: [],
        },
      },
      measured: { width: 120, height: 62 },
    })
    await openConfig(page, testId, nodeId)

    // FNCFG-1: both tables lead with the info column. SECUI-3/4
    // adds a Secret column to the OUTPUT table only (marks the bound variable
    // secret); INPUT stays 4-column (secret is never an input-param property).
    const headers = await headerArrays(page)
    expect(headers.input).toEqual(['', 'Parameter', 'Type', 'Value'])
    expect(headers.output).toEqual(['', 'Parameter', 'Type', 'Secret', 'Assign to'])

    // FNCFG-2: a described input AND a described output each render the (i) info icon.
    await expect(page.locator('[data-testid="param-row-recipient"] .cursor-help')).toBeVisible()
    await expect(page.locator('[data-testid="output-row-result"] .cursor-help')).toBeVisible()
  })

  test('FNCFG-4: a published (shared) instance populates its declared params', async ({ page }) => {
    const lib = await publishLibraryFunction(page.request, {
      name: `CfgShared-${RUN}-${randomUUID().slice(0, 6)}`,
      inputs: INPUTS,
      outputs: OUTPUTS,
    })
    const nodeId = 'fn-cfg-shared'
    const testId = await seedTest(page, `V-FN-CONFIG-01 shared ${RUN}`, {
      id: nodeId,
      type: 'workflowNode',
      position: { x: 300, y: 200 },
      data: {
        label: lib.name,
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: lib.functionId,
        functionVersion: '1.0.0',
        originalLibraryName: lib.name,
        category: 'function',
        version: '1.0.0',
        hasNewerVersion: false,
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        // The contract lives in resolvedInputs/resolvedOutputs (no localDefinition).
        resolvedInputs: INPUTS,
        resolvedOutputs: OUTPUTS,
        config: { values: {}, outputBindings: {}, profileBindings: [] },
      },
      measured: { width: 120, height: 62 },
    })
    await openConfig(page, testId, nodeId)

    // The declared input + output rows render.
    await expect(page.locator('[data-testid="param-row-recipient"]')).toBeVisible()
    await expect(page.locator('[data-testid="output-row-result"]')).toBeVisible()
  })

  test('FNCFG-4: an edit-mode instance populates its declared params', async ({ page }) => {
    const lib = await publishLibraryFunction(page.request, {
      name: `CfgEdit-${RUN}-${randomUUID().slice(0, 6)}`,
      inputs: INPUTS,
      outputs: OUTPUTS,
    })
    const nodeId = 'fn-cfg-edit'
    const testId = await seedTest(page, `V-FN-CONFIG-01 edit ${RUN}`, {
      id: nodeId,
      type: 'workflowNode',
      position: { x: 300, y: 200 },
      data: {
        label: lib.name,
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: lib.functionId,
        functionVersion: '1.0.0',
        originalLibraryName: lib.name,
        category: 'function',
        version: '1.0.0',
        hasNewerVersion: false,
        expressionFields: [],
        templateFields: [],
        variableExpressionKeys: [],
        editMode: true,
        upstreamLink: { functionId: lib.functionId, sourceVersion: '1.0.0' },
        resolvedInputs: INPUTS,
        resolvedOutputs: OUTPUTS,
        draft: {
          name: lib.name,
          description: '',
          tags: [],
          inputs: INPUTS,
          outputs: OUTPUTS,
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
        config: { values: {}, outputBindings: {}, profileBindings: [] },
      },
      measured: { width: 120, height: 62 },
    })
    await openConfig(page, testId, nodeId)

    await expect(page.locator('[data-testid="param-row-recipient"]')).toBeVisible()
    await expect(page.locator('[data-testid="output-row-result"]')).toBeVisible()
  })
})
