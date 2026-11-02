/**
 * V-CANVAS-NODE-10: Function node, shared lifecycle
 *
 * Design Decisions: Element Node Visual Structure (S badge indigo); the function kind is wired through node.tsx
 *
 * Phase: fixture (serial) - seeds a test via POST /tests with a node carrying
 * `nodeType: 'function'` and `functionLifecycle: 'shared'`.
 *
 * Pass Criteria:
 *   1. Card outer wrapper carries `data-nodetype="function"`.
 *   2. The S lifecycle badge renders with `data-state="shared"` and text "S".
 *   3. The dig-in glyph renders in the right action cluster.
 *   4. The version-update arrow renders when `hasNewerVersion: true`.
 *   5. DOM order in the right cluster: ver-arrow -> cog -> kebab -> dig-in.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

function buildFixture(opts: { suffix: string; hasNewerVersion?: boolean }) {
  const now = new Date().toISOString().replace('Z', '')
  return {
    name: `V-CANVAS-NODE-10 - ${opts.suffix} ${Date.now()}`,
    version: '1.0.0',
    description: 'Auto-fixture for shared-function lifecycle',
    workflow: {
      nodes: [
        {
          id: 'fn-1',
          type: 'workflowNode',
          position: { x: 400, y: 200 },
          data: {
            label: 'FetchUser',
            elementType: 'log',
            nodeType: 'function',
            functionLifecycle: 'shared',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: !!opts.hasNewerVersion,
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

async function seedFixture(page: Page, opts: Parameters<typeof buildFixture>[0]): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFixture(opts),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('V-CANVAS-NODE-10: function node, shared lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: node-wrapper data-nodetype is "function"', async ({ page }) => {
    const testId = await seedFixture(page, { suffix: 'wrapper' })
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node).toBeVisible()
    await expect(node).toHaveAttribute('data-nodetype', 'function')
  })

  test('S2: S lifecycle badge renders with data-state="shared"', async ({ page }) => {
    const testId = await seedFixture(page, { suffix: 'S-badge' })
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const badge = page.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'shared')
    await expect(badge).toHaveText('S')
  })

  test('S3: dig-in glyph IS shown for shared Function nodes', async ({ page }) => {
    // Shared instances show the dig-in glyph so the user can
    // enter the read-only inspect view from the canvas.
    // The kebab "Open" is there for the same reason.
    const testId = await seedFixture(page, { suffix: 'dig-in' })
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node.locator('[data-testid="node-dig-in"]')).toBeVisible()
  })

  test('S4: version-update arrow renders when hasNewerVersion is true', async ({ page }) => {
    const testId = await seedFixture(page, { suffix: 'ver', hasNewerVersion: true })
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-1"]')
    await expect(node.locator('[data-testid="version-update-indicator"]')).toBeVisible()
  })

  test('S5: right-cluster DOM order is ver-arrow -> cog -> kebab -> dig-in', async ({ page }) => {
    // Shared nodes show the dig-in; the right-cluster order is
    // ver-arrow -> cog -> kebab -> dig-in.
    const testId = await seedFixture(page, { suffix: 'order', hasNewerVersion: true })
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const right = page.locator('[data-testid="node-status-bar-right"]')
    await expect(right).toBeVisible()

    const order = await right.evaluate((el) =>
      Array.from(el.children).map((c) => c.getAttribute('data-testid') ?? ''),
    )
    const verIdx = order.indexOf('version-update-indicator')
    const cogIdx = order.indexOf('node-configure')
    const kebabIdx = order.indexOf('node-kebab')
    const digIdx = order.indexOf('node-dig-in')

    expect(verIdx, `ver-arrow must be present: ${order.join(',')}`).toBeGreaterThanOrEqual(0)
    expect(cogIdx).toBeGreaterThan(verIdx)
    expect(kebabIdx).toBeGreaterThan(cogIdx)
    expect(digIdx).toBeGreaterThan(kebabIdx)
  })
})
