/** Check blocks for the V-NULL-CHECKS specs: Single Asserts built in a chain under Start, and a generated Assert per truth-table cell. */

import { expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  dragPaletteItemToCanvas,
  expandPalette,
  waitForViewportSettled,
  type PaletteDragSpec,
} from '../../helpers/canvas'
import {
  addLiteralRow,
  pickConditionVariable,
  pickOperator,
  setReference,
  setReferenceExpression,
} from '../../helpers/condition-builder'
import { getNodeStatuses } from '../../helpers/k8s-run'
import { chainEdges, controlNode, markerNode, stackNodes, type WorkflowNode } from '../../helpers/k8s-nodes'
import { literalCondition, type CheckValueType } from '../../helpers/nesting-graph'
import {
  canvasNodeIds,
  dropBelow,
  edgeOnCanvas,
  expectDrawnFromLane,
  nodeLocator,
  openConfig,
  saveConfig,
} from '../canvas-lanes/lanes-helpers'

const START = 'start-node'

// ---------------------------------------------------------------------------
// Built in the UI
// ---------------------------------------------------------------------------

export async function fitView(page: Page): Promise<void> {
  await expandPalette(page)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
}

async function boxOf(locator: Locator, what: string) {
  await expect(locator, `${what} is on the canvas`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${what} has a box`).not.toBeNull()
  return box!
}

/** Drop a palette block just under Start; the drop links it from Start. */
export async function dropUnderStart(page: Page, block: PaletteDragSpec): Promise<string> {
  await fitView(page)
  const canvas = await boxOf(page.getByTestId('workflow-canvas'), 'the canvas')
  const start = await boxOf(page.getByTestId(START), 'Start')
  const before = await canvasNodeIds(page)
  await dragPaletteItemToCanvas(page, block, {
    x: start.x - canvas.x + start.width / 2,
    y: start.y - canvas.y + start.height + 60,
  })
  const added = (await canvasNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was dropped').toHaveLength(1)
  await expect(edgeOnCanvas(page, START, added[0]), 'the drop under Start links it').toHaveCount(1)
  return added[0]
}

/** Drop a palette block under a lane dot; the drop links it from that lane. */
export async function dropUnder(
  page: Page,
  source: string,
  handle: string | null,
  block: PaletteDragSpec,
): Promise<string> {
  await fitView(page)
  const id = await dropBelow(page, source, handle, block)
  await expect(edgeOnCanvas(page, source, id), `the drop links ${source} -> ${id}`).toHaveCount(1)
  await expectDrawnFromLane(page, source, handle, id)
  return id
}

/** One literal row typed in the sheet: a literal compare-to value, an expression, or none for a unary operator. */
export type SheetRow = { variable: string; operator: string; reference?: string; expression?: string }

/** Make an Assert Single and give it one literal row. */
export async function configureSingleAssert(page: Page, id: string, row: SheetRow): Promise<void> {
  const sheet = await openConfig(page, id)
  const single = sheet.getByRole('radio', { name: 'Single', exact: true })
  await single.click()
  await expect(single).toHaveAttribute('data-state', 'checked')
  await addLiteralRow(sheet)
  await pickConditionVariable(page, sheet, '0', row.variable)
  await pickOperator(page, sheet, '0', row.operator)
  if (row.reference !== undefined) await setReference(sheet, '0', row.reference)
  if (row.expression !== undefined) await setReferenceExpression(page, sheet, '0', row.expression)
  await saveConfig(sheet)
  await expect(nodeLocator(page, id).locator('[data-testid="handle-output"]'), 'a Single Assert has one exit').toHaveCount(1)
}

/** One Single Assert per row, dropped in a chain under Start; returns their ids in order. */
export async function buildAssertChain(page: Page, rows: readonly SheetRow[]): Promise<string[]> {
  const ids: string[] = []
  for (const row of rows) {
    const id = ids.length === 0 ? await dropUnderStart(page, 'assert') : await dropUnder(page, ids[ids.length - 1], null, 'assert')
    await configureSingleAssert(page, id, row)
    ids.push(id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Generated
// ---------------------------------------------------------------------------

/** One cell of a check truth table: a literal row on a variable and whether the check holds. */
export type CheckCell = {
  id: string
  variable: string
  valueType: CheckValueType
  operator: string
  /** The typed compare-to text; null for an operator that takes none. */
  reference: string | null
  holds: boolean
}

/** A Single-mode Assert holding the cell's one literal row; its Name is its id. */
export function cellAssert(cell: CheckCell): WorkflowNode {
  return controlNode({
    id: cell.id,
    label: cell.id,
    elementType: 'assert',
    category: 'flow',
    description: cell.id,
    values: {
      assertions: [literalCondition(`${cell.id}-row`, cell.variable, cell.valueType, cell.operator, cell.reference)],
      mode: 'single',
      fail_current_scope: false,
    },
  })
}

/** A `zz-` Test: one Single Assert per cell in a chain under Start, then a Log printing `bookend`. */
export function assertChainFixture(
  name: string,
  cells: readonly CheckCell[],
  variables: Record<string, unknown>,
  bookend: string,
): Record<string, unknown> {
  const nodes = [
    ...cells.map(cellAssert),
    markerNode({ id: `${bookend}-log`, description: 'bookend', text: bookend }),
  ]
  return {
    name,
    version: '1.0.0',
    description: name,
    workflow: { nodes: stackNodes(nodes), edges: chainEdges(nodes.map((node) => node.id)) },
    variables,
    metadata: {},
  }
}

/** Every cell's Assert paints success when the check holds and warning when it does not. */
export async function expectCellStatuses(page: Page, cells: readonly CheckCell[]): Promise<void> {
  const wrong = async (): Promise<string[]> => {
    const painted = new Map((await getNodeStatuses(page)).map((node) => [node.testId, node.status]))
    return cells
      .map((cell) => ({ cell, want: cell.holds ? 'success' : 'warning', got: painted.get(`workflow-node-${cell.id}`) }))
      .filter(({ want, got }) => want !== got)
      .map(({ cell, want, got }) => `${cell.id} (${cell.variable} ${cell.operator} ${cell.reference ?? ''}): want ${want}, got ${got ?? 'none'}`)
  }
  await expect.poll(wrong, { timeout: 15_000, message: 'every cell paints its answer' }).toEqual([])
}
