/**
 * V-CANVAS-NODE-09: Function node, local lifecycle
 *
 * Design Decisions: Element Node Visual Structure (L badge slate, S badge indigo); the function kind is wired through node.tsx
 *
 * Phase: fixture (serial) - seeds a test via POST /tests with a node carrying
 * `nodeType: 'function'` and `functionLifecycle: 'local'`. The BE accepts the
 * non-control 'function' nodeType per the compatibility branch in
 * `_validate_node_consistency`.
 *
 * Pass Criteria:
 *   1. Card outer wrapper carries `data-nodetype="function"`.
 *   2. The L lifecycle badge renders with `data-state="local"` and text "L".
 *   3. The dig-in glyph renders in the right action cluster.
 *   4. Cog and kebab are also present (function nodes keep the full action cluster).
 *   5. No version-update arrow when `hasNewerVersion` is absent.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

function buildFunctionFixture(lifecycle: 'local' | 'shared', suffix: string) {
  const now = new Date().toISOString().replace('Z', '')
  return {
    name: `V-CANVAS-NODE-09 - ${suffix} ${Date.now()}`,
    version: '1.0.0',
    description: 'Auto-fixture for function node lifecycle',
    workflow: {
      nodes: [
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 400, y: 200 },
          data: {
            label: 'Function_1',
            elementType: 'log',
            nodeType: 'function',
            functionLifecycle: lifecycle,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: '"hello"', level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'fn-1', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
    created_at: now,
    updated_at: now,
  }
}

async function seedFunction(page: Page, lifecycle: 'local' | 'shared', suffix: string): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFunctionFixture(lifecycle, suffix),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('V-CANVAS-NODE-09: function node, local lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: node-wrapper data-nodetype is "function"', async ({ page }) => {
    const testId = await seedFunction(page, 'local', 'wrapper')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node).toBeVisible()
    await expect(node).toHaveAttribute('data-nodetype', 'function')
  })

  test('S2: L lifecycle badge renders with data-state="local"', async ({ page }) => {
    const testId = await seedFunction(page, 'local', 'L-badge')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const badge = page.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'local')
    await expect(badge).toHaveText('L')
  })

  test('S3: dig-in glyph renders in the right action cluster', async ({ page }) => {
    const testId = await seedFunction(page, 'local', 'dig-in')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node.locator('[data-testid="node-dig-in"]')).toBeVisible()
  })

  test('S4: cog and kebab are also present (full action cluster)', async ({ page }) => {
    const testId = await seedFunction(page, 'local', 'cluster')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node.locator('[data-testid="node-configure"]')).toBeVisible()
    await expect(node.locator('[data-testid="node-kebab"]')).toBeVisible()
  })

  test('S5: no version-update arrow when hasNewerVersion is absent', async ({ page }) => {
    const testId = await seedFunction(page, 'local', 'no-ver')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node.locator('[data-testid="version-update-indicator"]')).toHaveCount(0)
  })
})
