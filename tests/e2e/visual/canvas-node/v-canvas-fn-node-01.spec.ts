/**
 * V-CANVAS-FN-NODE-01: Function node affordances (local + shared side-by-side)
 *
 * Design Decisions: Element Node Visual Structure (L badge slate, S badge indigo; dig-in in the right cluster); Open kebab label
 *
 * Phase: fixture (serial) - seeds a single test via POST /tests carrying both a
 * local and a shared Function node so the L and S affordances can be asserted
 * together. Matches the seed-by-API pattern used by V-CANVAS-NODE-09/10.
 *
 * Pass Criteria:
 *   1. Local Function node renders the L lifecycle badge and dig-in glyph.
 *   2. Shared Function node renders the S lifecycle badge and dig-in glyph.
 *   3. Opening the kebab on a Function node shows an "Open" entry as the first
 *      menu item (Function-only group prepended).
 *   4. Opening the kebab on a non-function (Shell Script plugin) node does NOT show an
 *      "Open" entry, confirming the entry is gated on `elementType === 'function'`.
 *   5. Each action-cluster button carries a tooltip naming the action plus the
 *      input that reaches it (Configure / Enter, More options / right-click,
 *      Open / Ctrl+Enter), anchored below the button (CANVAS-238..240).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

function buildFixture(suffix: string) {
  const now = new Date().toISOString().replace('Z', '')
  return {
    name: `V-CANVAS-FN-NODE-01 - ${suffix} ${Date.now()}`,
    version: '1.0.0',
    description: 'Local + Shared Function nodes side-by-side, plus a Shell Script plugin to prove the "Open" kebab entry is Function-only.',
    workflow: {
      nodes: [
        {
          id: 'fn-local',
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
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
            },
          },
        },
        {
          id: 'fn-shared',
          type: 'workflowNode',
          position: { x: 500, y: 200 },
          data: {
            label: 'FetchUser',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            functionId: '00000000-0000-0000-0000-000000000001',
          },
        },
        {
          id: 'plugin-shell',
          type: 'workflowNode',
          position: { x: 800, y: 200 },
          data: {
            label: 'Shell Script',
            elementType: 'shell-script',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: ['script'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { script: "'echo hi'" },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
    created_at: now,
    updated_at: now,
  }
}

async function seedFixture(page: Page, suffix: string): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFixture(suffix),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('V-CANVAS-FN-NODE-01: Function node affordances (local + shared)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: local Function node shows L lifecycle badge and dig-in glyph', async ({ page }) => {
    const testId = await seedFixture(page, 'local-affordances')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-local"]')
    await expect(node).toBeVisible()
    await expect(node).toHaveAttribute('data-nodetype', 'function')

    const badge = node.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'local')
    await expect(badge).toHaveText('L')

    await expect(node.locator('[data-testid="node-dig-in"]')).toBeVisible()
  })

  test('S2: shared Function node shows S lifecycle badge AND dig-in glyph', async ({ page }) => {
    const testId = await seedFixture(page, 'shared-affordances')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-shared"]')
    await expect(node).toBeVisible()
    await expect(node).toHaveAttribute('data-nodetype', 'function')

    const badge = node.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('data-state', 'shared')
    await expect(badge).toHaveText('S')

    // Shared Function drill is a read-only inspect, so the
    // dig-in glyph is shown on shared nodes (entry point to the inspect).
    await expect(node.locator('[data-testid="node-dig-in"]')).toBeVisible()
  })

  test('S3: kebab on a Function node shows "Open" as the first menu item', async ({ page }) => {
    const testId = await seedFixture(page, 'open-entry')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-local"]')
    await expect(node).toBeVisible()

    // Select the node so the kebab is interactive, then open it.
    await node.locator('button').first().dispatchEvent('click')
    const kebab = node.locator('[data-testid="node-kebab"]')
    await expect(kebab).toBeVisible()
    await kebab.click()

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    const openItem = menu.getByRole('menuitem', { name: 'Open' })
    await expect(openItem).toBeVisible()

    // "Open" is the first item in DOM order (Function-only group is prepended).
    const items = await menu.getByRole('menuitem').allTextContents()
    expect(items[0]?.trim()).toBe('Open')
  })

  test('S5: the three action-cluster buttons carry their tooltip + input badge, below the button', async ({
    page,
  }) => {
    const testId = await seedFixture(page, 'action-cluster-tooltips')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-fn-local"]')
    await expect(node).toBeVisible()
    const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')

    // Per CANVAS-238/239/240: name the action, and beside it the input that
    // reaches it - a key badge, or a pointer badge for a mouse gesture.
    const cases = [
      { testId: 'node-configure', label: 'Configure', badge: 'Enter', ariaLabel: 'Configure' },
      {
        testId: 'node-kebab',
        label: 'More options',
        badge: 'right-click',
        ariaLabel: 'More options',
      },
      {
        testId: 'node-dig-in',
        label: 'Open',
        badge: 'Ctrl+Enter',
        ariaLabel: 'Open inner canvas',
      },
    ]

    for (const c of cases) {
      const button = node.locator(`[data-testid="${c.testId}"]`)
      // The tooltip is supplementary: the accessible name stays on the button.
      await expect(button).toHaveAttribute('aria-label', c.ariaLabel)
      await button.hover()
      // The freshest open tooltip - an earlier one can still be animating out.
      const tip = tooltip.last()
      await expect(tip).toBeVisible({ timeout: 5_000 })
      await expect(tip).toContainText(c.label)
      // The input badge sits beside the label inside the same tooltip.
      await expect(tip.locator('kbd').first()).toContainText(c.badge)
      // Anchored BELOW the button so it never covers the block's own title.
      await expect(tip).toHaveAttribute('data-side', 'bottom')
      const buttonBox = await button.boundingBox()
      const tipBox = await tip.boundingBox()
      expect(tipBox!.y).toBeGreaterThan(buttonBox!.y)

      // Park on inert canvas so the next hover starts from a closed tooltip.
      await page.locator('.react-flow__pane').hover({ position: { x: 8, y: 8 } })
    }

    // The kebab's badge is a pointer gesture, not an invented key.
    await node.locator('[data-testid="node-kebab"]').hover()
    await expect(tooltip.last().locator('kbd svg').first()).toBeVisible()
  })

  test('S4: kebab on a non-function node does NOT show "Open"', async ({ page }) => {
    const testId = await seedFixture(page, 'no-open-on-plugin')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const shellNode = page.locator('[data-testid="workflow-node-plugin-shell"]')
    await expect(shellNode).toBeVisible()

    await shellNode.locator('button').first().dispatchEvent('click')
    const kebab = shellNode.locator('[data-testid="node-kebab"]')
    await expect(kebab).toBeVisible()
    await kebab.click()

    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Open' })).toHaveCount(0)
  })
})
