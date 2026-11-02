/**
 * V-CANVAS-FN-NESTED-01: three-deep Function drill round-trip + per-level
 * scoped Variable Manager.
 *
 * Wireframes: none new - reuses the existing drill breadcrumb + amber drill
 * segment.
 * REQ: REQ-3.1.1.4 (nested block composition - arbitrary depth + per-level
 * scope isolation).
 *
 * Phase: no-data (seeds its own Test via POST /tests; no DB reset, no run).
 *
 * Pass Criteria:
 *   1. Drilling Outer -> Middle -> Inner extends the breadcrumb one violet
 *      Function segment per level (1, then 2, then 3); the inner subtree node
 *      becomes visible at each level.
 *   2. The Variable Manager shows ONLY the active level's declared variable -
 *      no leakage from an ancestor or a descendant (per-level isolation).
 *   3. The back arrow pops exactly one level at a time back to the root, and
 *      the Outer Function node reappears at depth 0.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

function logNode(message: string): Record<string, unknown> {
  return {
    id: 'inner-leaf-log',
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
      config: { values: { message: `'${message}'`, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
  }
}

function fnNode(
  id: string,
  name: string,
  varName: string,
  innerNodes: Record<string, unknown>[],
  innerEdges: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 300, y: 200 },
    data: {
      label: name,
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
        name,
        description: '',
        inputs: [],
        outputs: [],
        variables: [{ name: varName, type: 'string', value: 'x' }],
        workflow: { nodes: innerNodes, edges: innerEdges },
      },
    },
  }
}

function buildSeed(): Record<string, unknown> {
  const inner = fnNode('fn-inner', 'Inner', 'inner_only', [logNode('nested-leaf')], [
    { id: 'e-inner', source: 'start-node', target: 'inner-leaf-log' },
  ])
  const middle = fnNode('fn-middle', 'Middle', 'middle_only', [inner], [
    { id: 'e-middle', source: 'start-node', target: 'fn-inner' },
  ])
  const outer = fnNode('fn-outer', 'Outer', 'outer_only', [middle], [
    { id: 'e-outer', source: 'start-node', target: 'fn-middle' },
  ])
  return {
    name: `V-CANVAS-FN-NESTED-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Outer > Middle > Inner local Functions, each declaring one local variable.',
    variables: {},
    workflow: {
      nodes: [outer],
      edges: [{ id: 'e-start-outer', source: 'start-node', target: 'fn-outer' }],
    },
    metadata: {},
  }
}

async function seed(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildSeed() })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function expandVariableManager(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  await expect(panel).toBeVisible()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function digIn(page: Page, nodeId: string) {
  await page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-dig-in"]`).click()
}

/** Assert the active level shows ONLY `present` and none of `absent` in the Variable Manager. */
async function expectScopedVars(page: Page, present: string, absent: string[]) {
  const content = page.locator('[data-testid="variable-manager-content"]')
  await expect(content.locator(`[aria-label="Variable ${present}"]`)).toBeVisible()
  for (const name of absent) {
    await expect(
      content.locator(`[aria-label="Variable ${name}"]`),
      `${name} must NOT leak into the ${present} scope`,
    ).toHaveCount(0)
  }
}

test.describe('V-CANVAS-FN-NESTED-01: 3-deep drill + per-level scoped Variable Manager', () => {
  test('drills Outer > Middle > Inner, scopes vars per level, pops back to root', async ({ page, request }) => {
    const testId = await seed(request)
    await openTest(page, testId)
    await expandVariableManager(page)

    const bc = page.locator('[data-testid="canvas-breadcrumb"]')
    const fnSegments = bc.locator('svg.lucide-square-function')

    // Depth 0: root canvas, the Outer Function node is visible, no drill segment.
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toBeVisible()
    await expect(fnSegments).toHaveCount(0)

    // Depth 1: drill into Outer.
    await digIn(page, 'fn-outer')
    await expect(page.locator('[data-testid="workflow-node-fn-middle"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toHaveCount(0)
    await expect(fnSegments).toHaveCount(1)
    await expectScopedVars(page, 'outer_only', ['middle_only', 'inner_only'])

    // Depth 2: drill into Middle.
    await digIn(page, 'fn-middle')
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()
    await expect(fnSegments).toHaveCount(2)
    await expectScopedVars(page, 'middle_only', ['outer_only', 'inner_only'])

    // Depth 3: drill into Inner - the deepest body's Log node is visible.
    await digIn(page, 'fn-inner')
    await expect(page.locator('[data-testid="workflow-node-inner-leaf-log"]')).toBeVisible()
    await expect(fnSegments).toHaveCount(3)
    await expect(bc.getByText('Inner', { exact: true })).toBeVisible()
    await expectScopedVars(page, 'inner_only', ['outer_only', 'middle_only'])

    // Pop back one level at a time via the back arrow.
    const back = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await back.click()
    await expect(fnSegments).toHaveCount(2)
    await expect(page.locator('[data-testid="workflow-node-fn-inner"]')).toBeVisible()

    await back.click()
    await expect(fnSegments).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-fn-middle"]')).toBeVisible()

    await back.click()
    await expect(fnSegments).toHaveCount(0)
    await expect(page.locator('[data-testid="workflow-node-fn-outer"]')).toBeVisible()
  })
})
