/**
 * V-QADD-02: Quick Insert's Enter centers the new Block under the handle it links from
 * Design Decisions: CANVAS-225, CANVAS-248, CANVAS-249
 * REQ: REQ-4.2.5
 *
 * Phase: no-data. Seed (API, POST /tests): each test saves its own `zz-b29-` Test (it saves the canvas
 * after the insert) and deletes it after. The Start case seeds an empty Test: Enter anchors on Start only
 * when the canvas holds no other Block or Note. Every anchor is drawn at a width other than the new Log's,
 * so a Block placed at the anchor's left x is never centered by chance.
 *
 * Pass Criteria:
 * 1. Quick Insert (Ctrl+Space, Enter) from Start gives a link whose ends share one x within 1 px, and the
 *    new Block is centered on it.
 * 2. The same from a Block narrower than 240 px and from one wider than 240 px.
 * 3. With an If/Else selected whose first branch is linked, the new Block links from its second branch
 *    handle and is centered under it.
 * 4. Positions stay after a save and a reload.
 * 5. With a fully linked anchor the new Block links from nothing and is centered under the anchor.
 * 6. Ctrl+Enter still places at the viewport center, linked from nothing.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import {
  centerX,
  egressHandle,
  expectSameX,
  flowBoxOf,
  handleCenterX,
  nodeFlowBox,
  startHandle,
  topHandle,
  type FlowBox,
} from '../../helpers/flow-geometry'
import { QUICK_ADD_INPUT, QUICK_ADD_POPOVER } from '../../helpers/quick-add'
import { saveTest, setBlockExpression } from '../../helpers/workbench'

const WORKFLOW_NODES = '[data-testid^="workflow-node-"][data-nodetype]'

type Rec = Record<string, unknown>

const sized = (node: Rec, width: number): Rec => ({ ...node, width, measured: { width, height: 62 } })

function note(id: string): Rec {
  return {
    id,
    type: 'noteNode',
    position: { x: 300, y: 300 },
    data: {
      label: 'Note',
      elementType: 'note',
      nodeType: 'control',
      category: 'misc',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      config: { values: { text: 'Ctrl+Enter lands at the viewport center', color: 'yellow' }, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 220, height: 80 },
  }
}

function ifElse(id: string): Rec {
  return {
    id,
    type: 'workflowNode',
    position: { x: -100, y: 140 },
    data: {
      label: 'If/Else',
      elementType: 'if-else',
      nodeType: 'control',
      category: 'conditional',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      config: {
        values: {
          branches: [
            { type: 'if', id: 'branch_if', label: 'True Path', conditions: [{ type: 'expression', expression: 'True', id: 'c-qadd' }] },
            { type: 'else', id: 'branch_else', label: 'Else' },
          ],
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 160, height: 62 },
  }
}

async function seed(page: Page, created: string[], nodes: Rec[], edges: Rec[]): Promise<string> {
  const testId = await createValidTest(page.request, { name: `zz-b29-qadd-${randomUUID().slice(0, 8)}`, nodes, edges })
  created.push(testId)
  await openTest(page, testId)
  return testId
}

async function select(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="workflow-node-${id}"]`).locator('button').first().dispatchEvent('click')
  await expect(page.locator(`[data-testid="workflow-node-${id}"][data-selected="true"]`)).toHaveCount(1)
}

/** Quick Insert a Log with `key`; returns the new Block's id. */
async function quickInsertLog(page: Page, key: 'Enter' | 'Control+Enter'): Promise<string> {
  const before = await page.locator(WORKFLOW_NODES).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  await page.keyboard.press('Control+Space')
  await expect(page.locator(QUICK_ADD_POPOVER)).toBeVisible({ timeout: 5_000 })
  await page.locator(QUICK_ADD_INPUT).fill('log')
  await page.keyboard.press(key)
  await expect(page.locator(QUICK_ADD_POPOVER)).toHaveCount(0)
  const added = (
    await page.locator(WORKFLOW_NODES).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  ).filter((id) => !before.includes(id))
  expect(added, 'exactly one Block was added').toHaveLength(1)
  return String(added[0]).replace('workflow-node-', '')
}

const edges = (page: Page) => page.locator('.react-flow__edge')

/** The new Block hangs centered under `handleX`, its top handle on the same x. */
async function expectCenteredUnder(page: Page, added: string, handleX: number, where: string): Promise<FlowBox> {
  expectSameX(await handleCenterX(topHandle(page, added)), handleX, `${where}: the link is straight`)
  const box = await nodeFlowBox(page, added)
  expectSameX(centerX(box), handleX, `${where}: the new Block is centered under the handle`)
  return box
}

/** Save, reload, and the new Block stays where it was placed. */
async function expectKeptAfterReload(page: Page, testId: string, added: string, placed: FlowBox): Promise<void> {
  // A Log needs its message before the Test saves.
  await setBlockExpression(page, added, 'message', "'inserted'")
  await saveTest(page)
  await openTest(page, testId)
  const reloaded = await nodeFlowBox(page, added)
  expect(Math.abs(reloaded.x - placed.x), 'x stays after save and reload').toBeLessThanOrEqual(1)
  expect(Math.abs(reloaded.y - placed.y), 'y stays after save and reload').toBeLessThanOrEqual(1)
}

test.describe('V-QADD-02: Quick Insert places the new Block under its handle', () => {
  const created: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    for (const id of created.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
  })

  test('1 and 4. from Start: the link is straight and stays after save and reload', async ({ page }) => {
    // An empty Test: with no other node on the canvas, Enter anchors on Start (CANVAS-225).
    const testId = await seed(page, created, [], [])
    const added = await quickInsertLog(page, 'Enter')
    // The onboarding ghost edge goes away on insert, so the new link is the only edge.
    await expect(edges(page), 'one link on the canvas').toHaveCount(1)
    await expect(page.getByRole('group', { name: `Edge from start-node to ${added}` }), 'the link is from Start').toHaveCount(1)
    // Per CANVAS-249: centered under Start's handle, which CANVAS-248 puts on x 0.
    const placed = await expectCenteredUnder(page, added, await handleCenterX(startHandle(page)), 'from Start')
    await expectKeptAfterReload(page, testId, added, placed)
  })

  for (const [what, width] of [
    ['narrower than 240 px', 200],
    ['wider than 240 px', 360],
  ] as const) {
    test(`2 and 4. from a Block ${what}`, async ({ page }) => {
      const anchor = `qadd-anchor-${width}`
      const testId = await seed(
        page,
        created,
        [sized(logNode(anchor, `Anchor ${width}`, "'anchor'", { x: -width / 2, y: 140 }), width)],
        [startEdge(anchor)],
      )
      const drawn = await nodeFlowBox(page, anchor)
      expect(Math.round(drawn.width), `the anchor is drawn ${width} px wide`).toBe(width)
      await select(page, anchor)
      const edgeCount = await edges(page).count()
      const added = await quickInsertLog(page, 'Enter')
      await expect(edges(page)).toHaveCount(edgeCount + 1)
      const placed = await expectCenteredUnder(page, added, await handleCenterX(egressHandle(page, anchor)), `from a Block ${what}`)
      await expectKeptAfterReload(page, testId, added, placed)
    })
  }

  test('3 and 4. from an If/Else whose first branch is linked: under its second branch', async ({ page }) => {
    const testId = await seed(
      page,
      created,
      [ifElse('qadd-if'), logNode('qadd-if-true', 'True path', "'true'", { x: -260, y: 280 })],
      [startEdge('qadd-if'), { id: 'e-qadd-if-true', source: 'qadd-if', sourceHandle: 'branch_if', target: 'qadd-if-true' }],
    )
    await select(page, 'qadd-if')
    const added = await quickInsertLog(page, 'Enter')
    const placed = await expectCenteredUnder(
      page,
      added,
      await handleCenterX(egressHandle(page, 'qadd-if', 'branch_else')),
      'from the If/Else second branch',
    )
    await expectKeptAfterReload(page, testId, added, placed)
    const stored = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    const wires = (await stored.json()).data.workflow.edges as Rec[]
    expect(
      wires.filter((wire) => wire.target === added).map((wire) => [wire.source, wire.sourceHandle]),
      'the new Block links from the first free branch',
    ).toEqual([['qadd-if', 'branch_else']])
  })

  test('5. a fully linked anchor: centered under the anchor, linked from nothing', async ({ page }) => {
    await seed(
      page,
      created,
      // The anchor is 300 px wide so a Block placed at its left x is not centered under it by chance.
      [
        sized(logNode('qadd-a', 'A', "'a'", { x: -150, y: 140 }), 300),
        logNode('qadd-b', 'B', "'b'", { x: -80, y: 280 }),
      ],
      [startEdge('qadd-a'), { id: 'e-qadd-a-b', source: 'qadd-a', target: 'qadd-b' }],
    )
    expect(Math.round((await nodeFlowBox(page, 'qadd-a')).width), 'the anchor is drawn 300 px wide').toBe(300)
    await select(page, 'qadd-a')
    const edgeCount = await edges(page).count()
    const added = await quickInsertLog(page, 'Enter')
    await expect(edges(page), 'nothing links the new Block').toHaveCount(edgeCount)
    expectSameX(
      centerX(await nodeFlowBox(page, added)),
      centerX(await nodeFlowBox(page, 'qadd-a')),
      'the new Block is centered under the fully linked anchor',
    )
  })

  test('6. Ctrl+Enter places at the viewport center, linked from nothing', async ({ page }) => {
    await seed(page, created, [note('qadd-center-note')], [])
    const edgeCount = await edges(page).count()
    const viewCenter = centerX(await flowBoxOf(page.locator('.react-flow__pane')))
    const added = await quickInsertLog(page, 'Control+Enter')
    await expect(edges(page), 'Ctrl+Enter links nothing').toHaveCount(edgeCount)
    const box = await nodeFlowBox(page, added)
    expect(box.x <= viewCenter && viewCenter <= box.x + box.width, 'the new Block sits over the viewport center').toBe(true)
  })
})
