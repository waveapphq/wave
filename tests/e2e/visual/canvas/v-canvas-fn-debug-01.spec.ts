/**
 * V-CANVAS-FN-DEBUG-01: the canvas follows execution while step-debugging a
 * Function (auto-drill).
 *
 * Wireframes: none new - reuses the drill breadcrumb + amber paused border.
 * REQ: REQ-3.2.1.3.
 *
 * Phase: fixture (drives a live Debug run, like v-canvas-05 / v-debug-paused-
 * toolbar-01). Seeds its own Test via POST /tests.
 *
 * Pass Criteria:
 *   1. Step Over a Function keeps the canvas at the caller level - no new
 *      drill segment - and paints the amber paused border on the sibling-after
 *      node.
 *   2. Step Into a Function auto-drills: the breadcrumb gains one violet
 *      Function segment (Test / Function_1) and the first inner body node
 *      carries the amber paused border (data-paused) - the canvas followed
 *      execution into the body with no manual drilling.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const FN = 'fn-1'

function logNode(id: string, message: string, x: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y: 200 },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { message: `'${message}'`, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
  }
}

function buildSeed(): Record<string, unknown> {
  return {
    name: `V-CANVAS-FN-DEBUG-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Local Function_1 (body A -> B) followed by an after-Log for auto-drill coverage.',
    variables: {},
    workflow: {
      nodes: [
        {
          id: FN,
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
              description: '',
              inputs: [],
              outputs: [],
              variables: [],
              workflow: {
                nodes: [logNode('inner-a', 'fn-A', 120), logNode('inner-b', 'fn-B', 320)],
                edges: [
                  { id: 'e-ia', source: 'start-node', target: 'inner-a' },
                  { id: 'e-ab', source: 'inner-a', target: 'inner-b' },
                ],
              },
            },
          },
        },
        logNode('after', 'fn-after', 520),
      ],
      edges: [
        { id: 'e-start-fn', source: 'start-node', target: FN },
        { id: 'e-fn-after', source: FN, target: 'after' },
      ],
    },
    metadata: {},
  }
}

async function seedAndOpen(page: Page, request: APIRequestContext): Promise<void> {
  await ensureEnvironment(request)
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildSeed() })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data.id
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function selectEnvironment(page: Page) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function toggleBreakpoint(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

async function debugToPausedFunction(page: Page, request: APIRequestContext) {
  await seedAndOpen(page, request)
  await toggleBreakpoint(page, FN)
  await selectEnvironment(page)
  await page.locator('[data-testid="debug-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
  await expect(page.locator(`[data-testid="workflow-node-${FN}"]`)).toHaveAttribute('data-paused', 'true')
}

test.describe('V-CANVAS-FN-DEBUG-01: canvas follows execution while stepping a Function', () => {
  test('Step Over keeps the canvas at the caller and pauses the sibling-after', async ({ page, request }) => {
    await debugToPausedFunction(page, request)

    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    const fnSegments = bc.locator('svg.lucide-square-function')
    // Paused on the Function at the root canvas - no drill segment yet.
    await expect(fnSegments).toHaveCount(0)

    await page.locator('[data-testid="action-step-over-button"]').click()

    // Step Over stays at the caller canvas; the after-Log gets the paused
    // border and the Function node is no longer the pause target.
    await expect(page.locator('[data-testid="workflow-node-after"]')).toHaveAttribute('data-paused', 'true', {
      timeout: 30_000,
    })
    await expect(fnSegments).toHaveCount(0)
    await expect(page.locator(`[data-testid="workflow-node-${FN}"]`)).not.toHaveAttribute('data-paused', 'true')
  })

  test('Step Into auto-drills into the body and pauses the first inner node', async ({ page, request }) => {
    await debugToPausedFunction(page, request)

    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    const fnSegments = bc.locator('svg.lucide-square-function')
    await expect(fnSegments).toHaveCount(0)

    await page.locator('[data-testid="action-step-into-button"]').click()

    // The canvas auto-drilled into Function_1: the breadcrumb gains one violet
    // Function segment and the first inner node carries the amber paused
    // border - no manual drilling.
    await expect(fnSegments).toHaveCount(1, { timeout: 30_000 })
    await expect(bc.getByText('Function_1', { exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-inner-a"]')).toHaveAttribute('data-paused', 'true')
  })
})
