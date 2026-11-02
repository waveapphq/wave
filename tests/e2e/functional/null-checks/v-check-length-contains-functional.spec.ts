/**
 * V-CHECK-LENGTH-CONTAINS: `length equals` and array `contains` compare typed values, not text
 * Wireframe: N/A
 * Design Decisions: none
 * REQ: REQ-3.3.1.4, REQ-3.1.3.25
 *
 * Seeds (API): a blank zz- Test per test; the second one also declares `nums_null` (array, null).
 * Built through the UI: the array variable `nums` with integer items 1, 2, 3 created in the Variable
 * Manager (items typed in the Edit value window); Single-mode Asserts dropped in a chain under Start
 * with their rows typed in the sheet; a bookend Log after them.
 *
 * Pass Criteria:
 * 1. The saved `nums` declares every item an integer.
 * 2. `nums` length equals 3 passes: the typed 3 is read as a number.
 * 3. `nums` contains 2 passes: the typed 2 is compared as the integer item.
 * 4. On the held `[1, 2, 3]` length equals 3 and contains 2 hold, length equals 0 and does not
 *    contain 2 do not; on a null list length equals 0 and does not contain 2 hold, length equals 3
 *    and contains 2 do not. A true check paints success, a false one warning.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasBoxStable } from '../../helpers/canvas'
import { ensureEnvironment } from '../../helpers/config'
import { fillListRows, getTest, type ListRow } from '../../helpers/element-types'
import { createValidTest } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries, getLogEntries, waitForLogText } from '../../helpers/log-reader'
import {
  closeValueEditor,
  createModal,
  openCreateModal,
  openValueEditor,
  saveValueEditor,
  setCreateName,
  setCreateType,
  submitCreate,
  variableRow,
} from '../../helpers/variable-create'
import {
  LANE_VIEWPORT,
  deleteTest,
  nodeLocator,
  openLaneCanvas,
  saveCanvas,
  setLogText,
} from '../canvas-lanes/lanes-helpers'
import { buildAssertChain, configureSingleAssert, dropUnder, dropUnderStart, type SheetRow } from './check-chain'

test.use({ viewport: LANE_VIEWPORT })

const NUMS: readonly ListRow[] = [
  { text: '1', type: 'integer' },
  { text: '2', type: 'integer' },
  { text: '3', type: 'integer' },
]
const BOOKEND = 'length-contains-done'

/** nums = [1, 2, 3] with integer items, created in the Variable Manager. */
async function createNums(page: Page): Promise<void> {
  const modal = await openCreateModal(page)
  await setCreateName(page, 'nums', modal)
  await setCreateType(page, 'array', modal)
  // The items and their types are typed in the Edit value window the value field opens.
  const sheet = await openValueEditor(page, modal)
  await fillListRows(page, sheet, NUMS)
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await submitCreate(page, modal)
  await expect(createModal(page)).toBeHidden()
  await expect(variableRow(page, 'nums')).toBeVisible()
  const manager = page.locator('[data-testid="variable-manager"]')
  await page.locator('button[aria-label="Collapse Variable Manager"]').first().click()
  await expect(manager).toHaveAttribute('data-state', 'collapsed')
  await waitForCanvasBoxStable(page)
}

async function runToBookend(page: Page) {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', /passed|failed|stopped|skipped/, { timeout: 120_000 })
  await waitForLogText(page, BOOKEND, 30_000)
  return getLogEntries(page)
}

test.describe('V-CHECK-LENGTH-CONTAINS: length equals and contains on a typed list', () => {
  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = undefined
  })

  test('length equals reads the typed number', async ({ page, request }) => {
    test.setTimeout(240_000)
    const ids = { length: '', contains: '', done: '' }

    await test.step('a blank Test open on the canvas', async () => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: `zz-V-CHECK-LENGTH-CONTAINS ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [],
        edges: [],
      })
      await openLaneCanvas(page, testId)
    })

    await test.step('nums = [1, 2, 3] with integer items, created in the Variable Manager', async () => {
      await createNums(page)
    })

    await test.step('Assert nums length equals 3, then Assert nums contains 2, then a bookend Log', async () => {
      ids.length = await dropUnderStart(page, 'assert')
      await configureSingleAssert(page, ids.length, { variable: 'nums', operator: 'length equals', reference: '3' })
      ids.contains = await dropUnder(page, ids.length, null, 'assert')
      await configureSingleAssert(page, ids.contains, { variable: 'nums', operator: 'contains', reference: '2' })
      ids.done = await dropUnder(page, ids.contains, null, 'log')
      await setLogText(page, ids.done, BOOKEND)
      await saveCanvas(page)
    })

    await test.step('the saved nums declares integer items', async () => {
      const stored = await getTest(request, testId!)
      expect(stored.variables.nums.elementTypes, JSON.stringify(stored.variables.nums)).toEqual([
        'integer',
        'integer',
        'integer',
      ])
    })

    const entries = await test.step('Run', async () => runToBookend(page))

    await test.step('length equals 3 passes', async () => {
      // Per REQ-3.3.1.4: the item count is compared as a number.
      await expect(
        nodeLocator(page, ids.length),
        `the length Assert passes.\n${formatEntries(entries)}`,
      ).toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('contains 2 passes', async () => {
      await expectNodeStatus(page, ids.contains, 'success')
    })
  })

  test('length equals and contains answer on a held and on a null list', async ({ page, request }) => {
    test.setTimeout(300_000)
    const checks: ReadonlyArray<{ operator: string; reference: string; held: boolean; onNull: boolean }> = [
      { operator: 'length equals', reference: '3', held: true, onNull: false },
      { operator: 'length equals', reference: '0', held: false, onNull: true },
      { operator: 'contains', reference: '2', held: true, onNull: false },
      { operator: 'does not contain', reference: '2', held: false, onNull: true },
    ]
    const cells: Array<SheetRow & { holds: boolean }> = [
      ...checks.map((c) => ({ variable: 'nums', operator: c.operator, reference: c.reference, holds: c.held })),
      ...checks.map((c) => ({ variable: 'nums_null', operator: c.operator, reference: c.reference, holds: c.onNull })),
    ]
    let ids: string[] = []

    await test.step('a Test declaring nums_null, open on the canvas', async () => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: `zz-V-CHECK-LENGTH-CONTAINS 2d ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [],
        edges: [],
        variables: { nums_null: { type: 'array', scope: 'test', value: null } },
      })
      await openLaneCanvas(page, testId)
    })

    await test.step('nums = [1, 2, 3] with integer items, created in the Variable Manager', async () => {
      await createNums(page)
    })

    await test.step('eight Single Asserts built in the sheet, then a bookend Log', async () => {
      ids = await buildAssertChain(page, cells)
      const done = await dropUnder(page, ids[ids.length - 1], null, 'log')
      await setLogText(page, done, BOOKEND)
      await saveCanvas(page)
    })

    const entries = await test.step('Run', async () => runToBookend(page))

    for (const [index, cell] of cells.entries()) {
      await test.step(`${cell.variable} ${cell.operator} ${cell.reference} ${cell.holds ? 'holds' : 'does not hold'}`, async () => {
        // Per REQ-3.1.3.25: a null list holds nothing, so it answers as an empty one.
        await expect(nodeLocator(page, ids[index]), formatEntries(entries)).toHaveAttribute(
          'data-execution-status',
          cell.holds ? 'success' : 'warning',
        )
      })
    }
  })
})
