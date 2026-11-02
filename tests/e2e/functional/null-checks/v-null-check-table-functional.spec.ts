/**
 * V-NULL-CHECK-TABLE: a table in a check offers is null, not null, is empty and is not empty only
 * Wireframe: none (functional)
 * Design Decisions: none
 * REQ: REQ-3.1.3.25
 *
 * Seeds (API): one blank zz- Test per test declaring the table variable `hosts`, null, empty (one
 * column, no rows) or filled (two rows), deleted after. Built through the UI: four Single Asserts in
 * a chain under Start, one row each on `hosts` with is null, not null, is empty and is not empty.
 *
 * Pass Criteria:
 * 1. A row on a table variable offers exactly is null, not null, is empty, is not empty; no equals
 *    and no not equals.
 * 2. The stored rows equal the generated row shape (`value_type: table`, no compare-to value).
 * 3. On a null table is null and is empty hold; on an empty table not null and is empty hold; on a
 *    filled table not null and is not empty hold. A true check paints success, a false one warning,
 *    and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { operatorOptions } from '../../helpers/condition-builder'
import { ensureEnvironment } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import { createValidTest } from '../../helpers/fn-seed'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import { literalCondition } from '../../helpers/nesting-graph'
import { runToEnd } from '../../helpers/workbench'
import { LANE_VIEWPORT, deleteTest, openConfig, openLaneCanvas, saveCanvas } from '../canvas-lanes/lanes-helpers'
import { buildAssertChain, type SheetRow } from './check-chain'

const TABLE_OPERATORS = ['is null', 'not null', 'is empty', 'is not empty']
const WIRE: Record<string, string> = {
  'is null': 'is_null',
  'not null': 'is_not_null',
  'is empty': 'is_empty',
  'is not empty': 'is_not_empty',
}
const COLUMNS = [{ name: 'host', type: 'string' }]

const STATES: ReadonlyArray<{ name: string; value: unknown; holds: readonly boolean[] }> = [
  { name: 'a null table', value: null, holds: [true, false, true, false] },
  { name: 'an empty table', value: { columns: COLUMNS, rows: [] }, holds: [false, true, true, false] },
  { name: 'a filled table', value: { columns: COLUMNS, rows: [['web'], ['db']] }, holds: [false, true, false, true] },
]

test.describe('V-NULL-CHECK-TABLE: the four table checks on a null, an empty and a filled table', () => {
  test.use({ viewport: LANE_VIEWPORT })

  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = undefined
  })

  for (const state of STATES) {
    test(`is null, not null, is empty and is not empty answer on ${state.name}`, async ({ page, request }) => {
      const rows: SheetRow[] = TABLE_OPERATORS.map((operator) => ({ variable: 'hosts', operator }))
      let ids: string[] = []

      await test.step(`a blank Test whose hosts is ${state.name}`, async () => {
        await ensureEnvironment(request)
        testId = await createValidTest(request, {
          name: `zz-V-NULL-CHECK-TABLE ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          nodes: [],
          variables: { hosts: { type: 'table', scope: 'test', value: state.value } },
        })
        await openLaneCanvas(page, testId)
      })

      await test.step('four Single Asserts on hosts built in the sheet', async () => {
        ids = await buildAssertChain(page, rows)
        await saveCanvas(page)
      })

      await test.step('a table row offers the four table operators and nothing else', async () => {
        const sheet = await openConfig(page, ids[0])
        // Per REQ-3.1.3.25: a table offers no equals and no not equals.
        expect(await operatorOptions(page, sheet, '0')).toEqual(TABLE_OPERATORS)
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
      })

      await test.step('the stored rows have the generated shape', async () => {
        const stored = await getTest(request, testId!)
        for (const [index, operator] of TABLE_OPERATORS.entries()) {
          const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === ids[index])
          const saved = node?.data.config?.values?.assertions?.[0] as Record<string, unknown>
          expect.soft({ ...saved, reference_value: saved?.reference_value ?? null }, `stored ${operator} row`).toEqual(
            literalCondition(String(saved?.id), 'hosts', 'table', WIRE[operator], null),
          )
        }
      })

      await test.step(`Run: each check answers on ${state.name}`, async () => {
        const run = await runToEnd(page)
        expect(run.verdict, formatEntries(run.entries)).toBe('passed')
        for (const [index, operator] of TABLE_OPERATORS.entries()) {
          await test.step(`${operator} ${state.holds[index] ? 'holds' : 'does not hold'}`, async () => {
            await expectNodeStatus(page, ids[index], state.holds[index] ? 'success' : 'warning')
          })
        }
      })
    })
  }
})
