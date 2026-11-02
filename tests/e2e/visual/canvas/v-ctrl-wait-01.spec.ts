/**
 * V-CTRL-WAIT-01: Wait Until canvas node
 *
 * Design Decisions: WAIT-3, WAIT-5 (no countdown)
 * REQ: REQ-3.5.4.3 (wait until condition with timeout)
 *
 * Pass Criteria:
 * 1. A freshly dropped Wait Until carries the Hourglass icon and, in its default
 *    Retry mode, the `retry` lane plus the `then` lane - nothing else
 * 2. Lane order is `retry` then `then`; `retry` takes the repeated-sub-flow cyan
 *    and `then` the container-exit neutral
 * 3. No lane label renders on the canvas; the lane name is the handle's
 *    accessible name
 * 4. Hovering a lane reveals a tooltip naming that lane, and no lane carries a
 *    browser `title` popup
 * 5. Watch mode drops to the single default egress - no `retry`, no named `then`
 * 6. A running Wait Until carries the RUNNING badge ALONE - no countdown
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

function condition(reference: string) {
  return {
    id: 'cond-1',
    type: 'literal',
    variable: 'phase',
    value_type: 'string',
    operator: 'equals',
    reference_value: reference,
    reference_is_expression: false,
  }
}

function waitNode(
  id: string,
  x: number,
  y: number,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Wait Until',
      elementType: 'wait-until',
      nodeType: 'control',
      category: 'timing',
      version: '1.0.0',
      // Free of the words "retry" and "then": the node's own text is what the
      // no-rendered-lane-labels check reads.
      description: 'Pod comes up',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 160, height: 62 },
  }
}

function logNode(id: string, message: string, x: number, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: id,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${message}'`, level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

/** One node per seed: the canvas fits its view to what is on it, and a lone node
 *  keeps the lane pills big enough to hover reliably. */
const RETRY_NODES = [
  waitNode('wait-retry', 320, 200, {
    conditions: [condition('Running')],
    timeout: 30000,
    check_interval: 1000,
    mode: 'retry',
    fail_current_scope: false,
  }),
]

const WATCH_NODES = [
  waitNode('wait-watch', 320, 200, {
    conditions: [condition('Running')],
    timeout: 30000,
    check_interval: 1000,
    mode: 'watch',
    fail_current_scope: false,
  }),
]

const startEdge = (target: string) => [
  { id: 'e-start', source: 'start-node', target, type: 'default' },
]

/** A Watch wait that cannot be satisfied, so the run parks on it long enough to
 *  read the running node. Informational timeout: the session still passes. */
const RUNNING_NODES = [
  waitNode('wait-live', 200, 160, {
    conditions: [condition('never')],
    timeout: 5000,
    check_interval: 500,
    message: 'wait-01 gave up',
    mode: 'watch',
    fail_current_scope: false,
  }),
  logNode('log-after', 'wait-01-after', 200, 320),
]

async function seedAndOpen(
  page: Page,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): Promise<void> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const fixture = {
    name: `V-CTRL-WAIT-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Wait Until lane rendering fixture.',
    workflow: { nodes, edges },
    variables: { phase: { value: 'Pending', type: 'string', scope: 'test' } },
    metadata: {},
  }
  const resp = await page.request.post(`${BASE}/tests`, { data: fixture })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id ?? body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

function lane(page: Page, nodeId: string, handle: string): Locator {
  return page.locator(
    `[data-testid="workflow-node-${nodeId}"] [data-testid="handle-output-${handle}"]`,
  )
}

async function laneX(page: Page, nodeId: string, handle: string): Promise<number> {
  const box = await lane(page, nodeId, handle).boundingBox()
  expect(box, `lane ${handle} of ${nodeId} must be visible`).not.toBeNull()
  return box!.x
}

/** Park the pointer away from every lane and wait for the previous lane's
 *  tooltip to close, so the next lane's answer cannot be the last one's exit
 *  animation. */
async function restPointer(page: Page): Promise<void> {
  await page.mouse.move(2, 2)
  await expect(
    page.locator('[data-testid^="handle-output-"][data-state="delayed-open"]'),
  ).toHaveCount(0, { timeout: 5_000 })
  await expect(
    page.locator('[data-testid^="handle-output-"][data-state="instant-open"]'),
  ).toHaveCount(0, { timeout: 5_000 })
}

test.describe('V-CTRL-WAIT-01: Wait Until canvas node', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: a freshly dropped Wait Until has a retry lane and a then lane', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(
      page,
      { term: 'wait', testId: 'palette-item-wait-until' },
      { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    )

    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await expect(node).toBeVisible()
    await expect(node.locator('[data-testid="workflow-node-icon"]')).toHaveAttribute(
      'data-icon',
      'hourglass',
    )
    await expect(node).toContainText('Wait Until')

    // Retry is the default mode, so the drop lands with both lanes.
    await expect(node.locator('[data-testid="handle-output-retry"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output-then"]')).toBeVisible()
    await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(2)
  })

  test('S2: lane order, role colors, and no rendered lane labels', async ({ page }) => {
    await seedAndOpen(page, RETRY_NODES, startEdge('wait-retry'))

    const node = page.locator('[data-testid="workflow-node-wait-retry"]')
    await expect(node).toBeVisible()

    await test.step('Exactly two lanes, retry before then', async () => {
      await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(2)
      const retryX = await laneX(page, 'wait-retry', 'retry')
      const thenX = await laneX(page, 'wait-retry', 'then')
      expect(retryX, `retry (${retryX}) must sit left of then (${thenX})`).toBeLessThan(thenX)
    })

    await test.step('Role colors: retry the sub-flow cyan, then the container-exit neutral', async () => {
      await expect(lane(page, 'wait-retry', 'retry')).toHaveClass(/!bg-cyan-500/)
      await expect(lane(page, 'wait-retry', 'then')).toHaveClass(/!bg-zinc-600/)
      await expect(lane(page, 'wait-retry', 'then')).not.toHaveClass(/!bg-cyan-500/)
    })

    await test.step('Names live on the accessible name, not on rendered text', async () => {
      await expect(lane(page, 'wait-retry', 'retry')).toHaveAttribute('aria-label', 'retry')
      await expect(lane(page, 'wait-retry', 'then')).toHaveAttribute('aria-label', 'then')

      const rendered = (await node.innerText()).toLowerCase()
      for (const name of ['retry', 'then']) {
        expect(
          rendered.includes(name),
          `lane name "${name}" must not be painted on the node: "${rendered}"`,
        ).toBeFalsy()
      }
    })
  })

  test('S3: hovering each lane reveals a tooltip naming that lane', async ({ page }) => {
    await seedAndOpen(page, RETRY_NODES, startEdge('wait-retry'))

    for (const handle of ['retry', 'then']) {
      // The browser's own popup is gone; the app's tooltip replaced it.
      await expect(lane(page, 'wait-retry', handle)).not.toHaveAttribute('title')
    }

    for (const handle of ['retry', 'then']) {
      const target = lane(page, 'wait-retry', handle)
      // Retry the hover itself: a lane pill is a few pixels tall, and the canvas
      // can still be settling its fit-to-view when the first pointer move lands.
      await expect(async () => {
        await restPointer(page)
        await target.hover()
        // Read the popup this lane owns, so a neighbor's lingering tooltip can
        // never stand in for the answer.
        await expect(target).toHaveAttribute('data-state', /open/, { timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      const describedBy = await target.getAttribute('aria-describedby')
      expect(describedBy, `lane ${handle} must point at its own tooltip`).toBeTruthy()
      await expect(
        page.locator(`[id="${describedBy}"]`),
        `lane ${handle} must answer with its own name`,
      ).toHaveText(handle)
    }
    await restPointer(page)
  })

  test('S4: Watch mode drops to the single default egress', async ({ page }) => {
    await seedAndOpen(page, WATCH_NODES, startEdge('wait-watch'))

    const watch = page.locator('[data-testid="workflow-node-wait-watch"]')
    await expect(watch).toBeVisible()
    await expect(watch.locator('[data-testid="handle-output"]')).toBeVisible()
    await expect(watch.locator('[data-testid="handle-output-retry"]')).toHaveCount(0)
    await expect(watch.locator('[data-testid="handle-output-then"]')).toHaveCount(0)
  })

  test('S5: a running Wait Until carries the RUNNING badge alone - no countdown', async ({
    page,
  }) => {
    await ensureEnvironment(page.request)
    await seedAndOpen(page, RUNNING_NODES, [
      { id: 'e-start', source: 'start-node', target: 'wait-live', type: 'default' },
      { id: 'e-after', source: 'wait-live', target: 'log-after', type: 'default' },
    ])

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()

    const node = page.locator('[data-testid="workflow-node-wait-live"]')
    const badge = node.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'run', { timeout: 30_000 })

    await test.step('RUNNING is the only thing in the badge strip', async () => {
      await expect(badge).toHaveText('RUNNING')
      await expect(node.locator('[data-testid="node-status-bar-left"]')).toHaveText('RUNNING')
    })

    await test.step('No elapsed-versus-limit readout anywhere on the node', async () => {
      const rendered = await node.innerText()
      expect(
        /\d+\s*s\s*\/\s*\d+\s*s/.test(rendered),
        `The withdrawn countdown must not render: "${rendered}"`,
      ).toBeFalsy()
    })

    // Leave the canvas idle for the next spec rather than mid-run.
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  })
})
