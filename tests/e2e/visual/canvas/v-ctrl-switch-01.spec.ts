/**
 * V-CTRL-SWITCH-01: Switch/Case canvas node
 *
 * Design Decisions: SWITCH-1, SWITCH-5, SWITCH-6, SWITCH-7
 * REQ: REQ-3.5.1.20 (Switch/Case multi-branch decisions)
 *
 * Pass Criteria:
 * 1. A freshly dropped Switch carries exactly one case lane plus the `then` lane
 * 2. Lane order is author order, then the default, then `then` last
 * 3. Case lanes take the conditional orange, the default a muted neutral, and
 *    `then` the container-exit neutral
 * 4. No lane label is rendered on the canvas; the branch name is the lane's
 *    accessible name
 * 5. Hovering a lane reveals a tooltip naming that lane - a case's own label,
 *    else "case N", then "default", then "then". No lane carries a `title`
 *    attribute, so the browser never shows its own popup
 * 6. The node widens by one handle slot per lane
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const BASE = `http://localhost:${BACKEND_PORT}`

function caseBranch(id: string, label: string) {
  return {
    id,
    type: 'case',
    label,
    break: true,
    conditions: [
      {
        type: 'literal',
        variable: 'mode',
        value_type: 'string',
        operator: 'equals',
        reference_value: id,
        reference_is_expression: false,
        id: `cond-${id}`,
      },
    ],
  }
}

function switchNode(id: string, x: number, y: number, branches: Array<Record<string, unknown>>) {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Switch',
      elementType: 'switch-case',
      nodeType: 'control',
      category: 'conditional',
      version: '1.0.0',
      description: id,
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { branches }, outputBindings: {}, profileBindings: [] },
    },
  }
}

/** One Switch: two cases (the first named) plus a default - the lane set the
 *  wireframe pins. */
const LANE_NODES = [
  switchNode('sw-full', 320, 200, [
    caseBranch('branch_0', 'Alpha'),
    caseBranch('branch_1', ''),
    { id: 'branch_2', type: 'default', label: '' },
  ]),
]

/** Three Switches whose lane counts grow: 2, 4, and 6 lanes. */
const WIDTH_NODES = [
  switchNode('sw-one', 80, 160, [caseBranch('branch_0', '')]),
  switchNode('sw-mid', 80, 340, [
    caseBranch('branch_0', ''),
    caseBranch('branch_1', ''),
    { id: 'branch_2', type: 'default', label: '' },
  ]),
  switchNode('sw-wide', 80, 520, [
    caseBranch('branch_0', ''),
    caseBranch('branch_1', ''),
    caseBranch('branch_2', ''),
    caseBranch('branch_3', ''),
    { id: 'branch_4', type: 'default', label: '' },
  ]),
]

async function seedAndOpen(page: Page, nodes: Array<Record<string, unknown>>): Promise<void> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const fixture = {
    name: `V-CTRL-SWITCH-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Switch lane rendering fixture.',
    workflow: {
      nodes,
      edges: [
        { id: 'e-start', source: 'start-node', target: String(nodes[0].id), type: 'default' },
      ],
    },
    variables: { mode: { value: 'branch_0', type: 'string', scope: 'test' } },
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

test.describe('V-CTRL-SWITCH-01: Switch/Case canvas node', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: a freshly dropped Switch has one case lane and a then lane', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(
      page,
      { term: 'switch', testId: 'palette-item-switch-case' },
      { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    )

    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await expect(node).toBeVisible()
    await expect(node.locator('[data-testid="workflow-node-icon"]')).toHaveAttribute(
      'data-icon',
      'list-tree',
    )
    await expect(node).toContainText('Switch')

    // The palette seed is one case; `then` is always present.
    await expect(node.locator('[data-testid="handle-output-branch_0"]')).toBeVisible()
    await expect(node.locator('[data-testid="handle-output-then"]')).toBeVisible()
    await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(2)
  })

  test('S2: lane order, role colors, and no rendered lane labels', async ({ page }) => {
    await seedAndOpen(page, LANE_NODES)

    const node = page.locator('[data-testid="workflow-node-sw-full"]')
    await expect(node).toBeVisible()

    await test.step('Four lanes: two cases, the default, then the egress', async () => {
      await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(4)
    })

    await test.step('Order is author order, default next, then last', async () => {
      const xs = [
        await laneX(page, 'sw-full', 'branch_0'),
        await laneX(page, 'sw-full', 'branch_1'),
        await laneX(page, 'sw-full', 'branch_2'),
        await laneX(page, 'sw-full', 'then'),
      ]
      expect(xs[0], `case lanes must precede the default: ${JSON.stringify(xs)}`).toBeLessThan(xs[1])
      expect(xs[1], `the default must precede then: ${JSON.stringify(xs)}`).toBeLessThan(xs[2])
      expect(xs[2], `then must be last: ${JSON.stringify(xs)}`).toBeLessThan(xs[3])
    })

    await test.step('Role colors: case orange, default muted neutral, then exit neutral', async () => {
      await expect(lane(page, 'sw-full', 'branch_0')).toHaveClass(/!bg-orange-500/)
      await expect(lane(page, 'sw-full', 'branch_1')).toHaveClass(/!bg-orange-500/)
      const defaultLane = lane(page, 'sw-full', 'branch_2')
      await expect(defaultLane).toHaveClass(/!bg-zinc-400/)
      await expect(defaultLane).not.toHaveClass(/!bg-orange-500/)
      await expect(lane(page, 'sw-full', 'then')).toHaveClass(/!bg-zinc-600/)
    })

    await test.step('Names live on the accessible name, not on rendered text', async () => {
      await expect(lane(page, 'sw-full', 'branch_0')).toHaveAttribute('aria-label', 'Alpha')
      await expect(lane(page, 'sw-full', 'branch_1')).toHaveAttribute('aria-label', 'case 2')
      await expect(lane(page, 'sw-full', 'branch_2')).toHaveAttribute('aria-label', 'default')
      await expect(lane(page, 'sw-full', 'then')).toHaveAttribute('aria-label', 'then')

      const rendered = (await node.innerText()).toLowerCase()
      for (const name of ['alpha', 'case 2', 'default', 'then']) {
        expect(
          rendered.includes(name),
          `lane name "${name}" must not be painted on the node: "${rendered}"`,
        ).toBeFalsy()
      }
    })
  })

  test('S3: hovering each lane reveals a tooltip naming that lane (5.1)', async ({ page }) => {
    await seedAndOpen(page, LANE_NODES)

    const expected: Array<[string, string]> = [
      ['branch_0', 'Alpha'],
      ['branch_1', 'case 2'],
      ['branch_2', 'default'],
      ['then', 'then'],
    ]

    for (const [handle] of expected) {
      // The browser's own popup is gone; the app's tooltip replaced it.
      await expect(lane(page, 'sw-full', handle)).not.toHaveAttribute('title')
    }

    for (const [handle, name] of expected) {
      await restPointer(page)
      const target = lane(page, 'sw-full', handle)
      await target.hover()
      // Read the popup this lane owns, so a neighbor's lingering tooltip can
      // never stand in for the answer.
      await expect(target).toHaveAttribute('data-state', /open/, { timeout: 5_000 })
      const describedBy = await target.getAttribute('aria-describedby')
      expect(describedBy, `lane ${handle} must point at its own tooltip`).toBeTruthy()
      await expect(
        page.locator(`[id="${describedBy}"]`),
        `lane ${handle} must answer with its own name`,
      ).toHaveText(name)
    }
    await restPointer(page)
  })

  test('S4: the node widens by one handle slot per lane', async ({ page }) => {
    await seedAndOpen(page, WIDTH_NODES)

    const widthOf = async (nodeId: string) => {
      const box = await page.locator(`[data-testid="workflow-node-${nodeId}"]`).boundingBox()
      expect(box, `${nodeId} must be visible`).not.toBeNull()
      return box!.width
    }

    const two = await widthOf('sw-one')
    const four = await widthOf('sw-mid')
    const six = await widthOf('sw-wide')

    expect(four, `4 lanes (${four}) must be wider than 2 lanes (${two})`).toBeGreaterThan(two)
    expect(six, `6 lanes (${six}) must be wider than 4 lanes (${four})`).toBeGreaterThan(four)
  })
})
