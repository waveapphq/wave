/**
 * V-PARALLEL-01 (node half): Parallel canvas node
 *
 * Design Decisions: PARALLEL-1, PARALLEL-2
 * REQ: REQ-3.1.1.3 (parallel branch creation and merging)
 *
 * Pass Criteria:
 * 1. A freshly dropped Parallel carries the Split icon and arrives at the
 *    two-branch minimum: `branch_1`, `branch_2` and the `then` egress
 * 2. Lane order is config order with `then` last; branch lanes take the
 *    fan-out violet and `then` the container-exit neutral
 * 3. No lane label renders on the canvas; the lane name is the handle's
 *    accessible name, and an unnamed branch answers "branch N"
 * 4. Hovering a lane reveals a tooltip naming that lane, and no lane carries a
 *    browser `title` popup
 * 5. The node widens by exactly one lane slot per branch
 * 6. A running Parallel carries the RUNNING badge alone - no branch counter and
 *    no elapsed-against-limit readout
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

/** The widening rule: 96px of node chrome plus one 64px slot per branch. */
const widthFor = (branches: number) => 96 + branches * 64

interface BranchRecord {
  id: string
  name?: string
  time_limit?: number
}

function parallelNode(
  id: string,
  x: number,
  y: number,
  branches: BranchRecord[],
  join: 'all' | 'first' = 'all',
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Parallel',
      elementType: 'parallel',
      nodeType: 'control',
      category: 'flow',
      version: '1.0.0',
      // Free of every lane name below, so the no-rendered-lane-labels check
      // reads the node's own text without false positives.
      description: 'Fan out at once',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { branches, join }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 200, height: 62 },
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

/** One node per seed keeps the lane pills big enough to hover reliably. */
const LANE_NODES = [
  parallelNode('par-lanes', 320, 200, [
    { id: 'branch_1', name: 'Ingest' },
    { id: 'branch_2', name: 'probe' },
    { id: 'branch_3' },
  ]),
]

const WIDTH_NODES = [
  parallelNode('par-two', 120, 160, [{ id: 'branch_1' }, { id: 'branch_2' }]),
  parallelNode('par-three', 520, 160, [
    { id: 'branch_1' },
    { id: 'branch_2' },
    { id: 'branch_3' },
  ]),
  parallelNode('par-four', 980, 160, [
    { id: 'branch_1' },
    { id: 'branch_2' },
    { id: 'branch_3' },
    { id: 'branch_4' },
  ]),
]

/** A section whose branches outlive the read, so the node can be read running. */
const RUNNING_NODES = [
  parallelNode('par-live', 200, 120, [
    { id: 'branch_1', name: 'slow' },
    { id: 'branch_2', name: 'quick' },
  ]),
  {
    id: 'delay-slow',
    type: 'workflowNode',
    position: { x: 80, y: 280 },
    data: {
      label: 'Delay',
      elementType: 'delay',
      nodeType: 'control',
      category: 'timing',
      version: '1.0.0',
      description: 'Hold the section open',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { duration: 4000 }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  },
  logNode('log-quick', 'par-01-quick', 340, 280),
  logNode('log-after', 'par-01-after', 200, 420),
]

const startEdge = (target: string) => [
  { id: 'e-start', source: 'start-node', target, type: 'default' },
]

async function seedAndOpen(
  page: Page,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): Promise<void> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const fixture = {
    name: `V-PARALLEL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Parallel lane rendering fixture.',
    workflow: { nodes, edges },
    variables: {},
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

test.describe('V-PARALLEL-01: Parallel canvas node', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: a freshly dropped Parallel arrives at the two-branch minimum', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(
      page,
      { term: 'parallel', testId: 'palette-item-parallel' },
      { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    )

    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await expect(node).toBeVisible()
    await expect(node.locator('[data-testid="workflow-node-icon"]')).toHaveAttribute(
      'data-icon',
      'split',
    )
    await expect(node).toContainText('Parallel')

    // Two branch lanes seeded by the drop, plus the always-present exit.
    await expect(node.locator('[data-testid="handle-output-branch_1"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output-branch_2"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output-then"]')).toBeVisible()
    await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(3)
  })

  test('S2: lane order, role colors, and no rendered lane labels', async ({ page }) => {
    await seedAndOpen(page, LANE_NODES, startEdge('par-lanes'))

    const node = page.locator('[data-testid="workflow-node-par-lanes"]')
    await expect(node).toBeVisible()

    await test.step('Three branch lanes plus the exit', async () => {
      await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(4)
    })

    await test.step('Order is config order, then last', async () => {
      const xs = [
        await laneX(page, 'par-lanes', 'branch_1'),
        await laneX(page, 'par-lanes', 'branch_2'),
        await laneX(page, 'par-lanes', 'branch_3'),
        await laneX(page, 'par-lanes', 'then'),
      ]
      for (let i = 1; i < xs.length; i++) {
        expect(
          xs[i - 1],
          `lane ${i - 1} (${xs[i - 1]}) must sit left of lane ${i} (${xs[i]})`,
        ).toBeLessThan(xs[i])
      }
    })

    await test.step('Role colors: branches violet, the exit the container neutral', async () => {
      for (const handle of ['branch_1', 'branch_2', 'branch_3']) {
        await expect(lane(page, 'par-lanes', handle)).toHaveClass(/!bg-violet-500/)
      }
      const exit = lane(page, 'par-lanes', 'then')
      await expect(exit).toHaveClass(/!bg-zinc-600/)
      await expect(exit).not.toHaveClass(/!bg-violet-500/)
    })

    await test.step('Names live on the accessible name, not on rendered text', async () => {
      await expect(lane(page, 'par-lanes', 'branch_1')).toHaveAttribute('aria-label', 'Ingest')
      await expect(lane(page, 'par-lanes', 'branch_2')).toHaveAttribute('aria-label', 'probe')
      // An unnamed branch answers with its position, not with a blank name.
      await expect(lane(page, 'par-lanes', 'branch_3')).toHaveAttribute('aria-label', 'branch 3')
      await expect(lane(page, 'par-lanes', 'then')).toHaveAttribute('aria-label', 'then')

      const rendered = (await node.innerText()).toLowerCase()
      for (const name of ['ingest', 'probe', 'branch 3', 'then']) {
        expect(
          rendered.includes(name),
          `lane name "${name}" must not be painted on the node: "${rendered}"`,
        ).toBeFalsy()
      }
    })
  })

  test('S3: hovering each lane reveals a tooltip naming that lane', async ({ page }) => {
    await seedAndOpen(page, LANE_NODES, startEdge('par-lanes'))

    const expected: Array<[string, string]> = [
      ['branch_1', 'Ingest'],
      ['branch_2', 'probe'],
      ['branch_3', 'branch 3'],
      ['then', 'then'],
    ]

    for (const [handle] of expected) {
      // The browser's own popup is gone; the app's tooltip replaced it.
      await expect(lane(page, 'par-lanes', handle)).not.toHaveAttribute('title')
    }

    for (const [handle, name] of expected) {
      const target = lane(page, 'par-lanes', handle)
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
      ).toHaveText(name)
    }
    await restPointer(page)
  })

  test('S4: the node widens by one lane slot per branch', async ({ page }) => {
    await seedAndOpen(page, WIDTH_NODES, startEdge('par-two'))

    const widthOf = async (nodeId: string) => {
      const box = await page.locator(`[data-testid="workflow-node-${nodeId}"]`).boundingBox()
      expect(box, `${nodeId} must be visible`).not.toBeNull()
      return box!.width
    }

    const two = await widthOf('par-two')
    const three = await widthOf('par-three')
    const four = await widthOf('par-four')

    expect(three, `3 branches (${three}) must be wider than 2 (${two})`).toBeGreaterThan(two)
    expect(four, `4 branches (${four}) must be wider than 3 (${three})`).toBeGreaterThan(three)

    // The canvas fits to view, so the rendered pixels carry the zoom. Ratios
    // do not: they hold the widening rule whatever the zoom is.
    expect(
      three / two,
      `3-vs-2 width ratio (${three}/${two}) must follow 96 + N*64`,
    ).toBeCloseTo(widthFor(3) / widthFor(2), 2)
    expect(
      four / two,
      `4-vs-2 width ratio (${four}/${two}) must follow 96 + N*64`,
    ).toBeCloseTo(widthFor(4) / widthFor(2), 2)
  })

  test('S5: a running Parallel carries the RUNNING badge alone', async ({ page }) => {
    await ensureEnvironment(page.request)
    await seedAndOpen(page, RUNNING_NODES, [
      { id: 'e-start', source: 'start-node', target: 'par-live', type: 'default' },
      {
        id: 'e-b1',
        source: 'par-live',
        sourceHandle: 'branch_1',
        target: 'delay-slow',
        type: 'default',
      },
      {
        id: 'e-b2',
        source: 'par-live',
        sourceHandle: 'branch_2',
        target: 'log-quick',
        type: 'default',
      },
      {
        id: 'e-then',
        source: 'par-live',
        sourceHandle: 'then',
        target: 'log-after',
        type: 'default',
      },
    ])

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()

    const node = page.locator('[data-testid="workflow-node-par-live"]')
    const badge = node.locator('[data-testid="node-run-state-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'run', { timeout: 30_000 })

    await test.step('RUNNING is the only thing in the badge strip', async () => {
      await expect(badge).toHaveText('RUNNING')
      await expect(node.locator('[data-testid="node-status-bar-left"]')).toHaveText('RUNNING')
    })

    await test.step('No branch counter and no elapsed-against-limit readout', async () => {
      const rendered = await node.innerText()
      expect(
        /\d+\s*\/\s*\d+/.test(rendered),
        `no "done / total" branch counter may render: "${rendered}"`,
      ).toBeFalsy()
      expect(
        /\d+\s*s\s*\/\s*\d+\s*s/.test(rendered),
        `the withdrawn countdown must not render: "${rendered}"`,
      ).toBeFalsy()
    })

    // Leave the canvas idle for the next spec rather than mid-run.
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  })
})
