/**
 * V-NULL-CHECK-OPERATORS: every check block offers the operators of a row's type, is null and not null included
 * Wireframe: none (functional)
 * Design Decisions: none
 * REQ: REQ-3.1.3.25
 *
 * Seeds (API): one blank zz- Test per test declaring `v_string`, `v_integer`, `v_float`, `v_boolean`,
 * `v_array`, `v_map` and `v_table` (each holding a value), deleted after. Built through the UI: the
 * check block dropped from the palette under Start, seven literal condition rows (one per variable),
 * the operator picks, Save of the sheet and Save of the Test.
 *
 * Pass Criteria:
 * 1. In Assert, If/Else, Switch, While and Wait Until a row on a variable of each type offers exactly
 *    the operators of that type, in order: integer and float equals, not equals, less than, greater
 *    than, less or equal, greater or equal, is null, not null; string equals, not equals, contains,
 *    does not contain, starts with, ends with, matches regex, is null, not null; boolean is true,
 *    is false, is null, not null; array contains, does not contain, is empty, is not empty, length
 *    equals, is null, not null; map has key, does not have key, is empty, is not empty, is null, not
 *    null; table is null, not null, is empty, is not empty.
 * 2. Picking is null or not null hides the row's value box and its {} toggle, and the sheet saves.
 * 3. The saved Test holds each row as `is_null` / `is_not_null` with the row's type and no
 *    compare-to value, the same shape the generated checks of V-NULL-CHECK-ASSERT use.
 * 4. A row the variable pick lands on is true (boolean) or is null (table) shows no value box and
 *    is saved with no compare-to value; a pasted copy of its block is saved the same way.
 * 5. A row switched from is null back to not equals, its box left empty, is saved with the empty
 *    compare-to value a new row has, and the run compares with it: no null compare-to failure.
 * 6. A CSV filter row switched from String to Boolean lands on is true, shows no value box and is
 *    saved with no compare-to value.
 *
 * Tests 6-8 seed a blank zz- Test (test 6 with `v_boolean` and `v_table`, test 7 with `v_string`);
 * the Asserts, the copy, the CSV block, its filter and its rows are built through the UI.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  CHECK_BLOCK_PALETTE,
  addLiteralRow,
  openConditionBody,
  operatorOptions,
  operatorTrigger,
  pickConditionVariable,
  pickOperator,
  referenceToggle,
  rowPath,
  storedConditionRows,
  valueBox,
  type ConditionBlock,
} from '../../helpers/condition-builder'
import { ensureEnvironment } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { literalCondition, type CheckValueType } from '../../helpers/nesting-graph'
import { setStringParam } from '../../helpers/param-config'
import { addFilterBlock, addFilterLiteral, setFilterAsType } from '../../helpers/table-transform'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
import {
  canvasBlockIds,
  dropBelowStart,
  openBlockSheet,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { deleteTest } from '../canvas-lanes/lanes-helpers'

const NUMBER_OPERATORS = [
  'equals',
  'not equals',
  'less than',
  'greater than',
  'less or equal',
  'greater or equal',
  'is null',
  'not null',
]

interface TypeRow {
  type: CheckValueType
  variable: string
  value: unknown
  /** Options in order. */
  operators: readonly string[]
  /** The operator a fresh row keeps or falls to once the variable is picked takes a compare-to value. */
  binaryAtPick: boolean
}

const TYPES: readonly TypeRow[] = [
  {
    type: 'string',
    variable: 'v_string',
    value: 'abc',
    operators: [
      'equals',
      'not equals',
      'contains',
      'does not contain',
      'starts with',
      'ends with',
      'matches regex',
      'is null',
      'not null',
    ],
    binaryAtPick: true,
  },
  { type: 'integer', variable: 'v_integer', value: 5, operators: NUMBER_OPERATORS, binaryAtPick: true },
  { type: 'float', variable: 'v_float', value: 1.5, operators: NUMBER_OPERATORS, binaryAtPick: true },
  {
    type: 'boolean',
    variable: 'v_boolean',
    value: true,
    operators: ['is true', 'is false', 'is null', 'not null'],
    binaryAtPick: false,
  },
  {
    type: 'array',
    variable: 'v_array',
    value: [1, 2],
    operators: ['contains', 'does not contain', 'is empty', 'is not empty', 'length equals', 'is null', 'not null'],
    binaryAtPick: true,
  },
  {
    type: 'map',
    variable: 'v_map',
    value: { k: 1 },
    operators: ['has key', 'does not have key', 'is empty', 'is not empty', 'is null', 'not null'],
    binaryAtPick: true,
  },
  {
    type: 'table',
    variable: 'v_table',
    value: { columns: [{ name: 'host', type: 'string' }], rows: [['web']] },
    operators: ['is null', 'not null', 'is empty', 'is not empty'],
    binaryAtPick: false,
  },
]

/** Even rows pick is null, odd rows not null. */
function unaryPick(index: number): { label: string; wire: string } {
  return index % 2 === 0 ? { label: 'is null', wire: 'is_null' } : { label: 'not null', wire: 'is_not_null' }
}

const BLOCKS: ReadonlyArray<{ block: ConditionBlock; name: string }> = [
  { block: 'assert', name: 'Assert' },
  { block: 'if-else', name: 'If/Else' },
  { block: 'switch', name: 'Switch' },
  { block: 'while', name: 'While' },
  { block: 'wait-until', name: 'Wait Until' },
]

function seedVariables(): Record<string, unknown> {
  return Object.fromEntries(TYPES.map((t) => [t.variable, { type: t.type, scope: 'test', value: t.value }]))
}

test.describe('V-NULL-CHECK-OPERATORS: the operator list of every check block', () => {
  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = undefined
  })

  for (const { block, name } of BLOCKS) {
    test(`${name} offers the operators of each type in order, and a unary pick hides the value box and saves`, async ({
      page,
      request,
    }) => {
      await ensureEnvironment(request)
      testId = await createValidTest(request, {
        name: `zz-V-NULL-CHECK-OPERATORS ${block} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [],
        variables: seedVariables(),
      })
      await openTest(page, testId)
      const blockId = await dropBelowStart(page, CHECK_BLOCK_PALETTE[block])
      const sheet = await openBlockSheet(page, blockId)
      const body = await openConditionBody(sheet, block)

      for (const [index, row] of TYPES.entries()) {
        const path = rowPath(index)
        await test.step(`a ${row.type} row offers its operators in order`, async () => {
          await addLiteralRow(body)
          await pickConditionVariable(page, body, path, row.variable)
          await expect(body.locator(`[data-testid="assert-type-badge-${path}"]`)).toHaveText(row.type)
          expect(await operatorOptions(page, body, path), `${name}: the ${row.type} operators`).toEqual(row.operators)
          await expect(sheet, 'closing the operator list keeps the sheet open').toBeVisible()
          await expect(valueBox(body, path), `the ${row.type} row's first operator`).toHaveCount(row.binaryAtPick ? 1 : 0)
        })

        await test.step(`a ${row.type} row picked ${unaryPick(index).label} hides the value box`, async () => {
          await pickOperator(page, body, path, unaryPick(index).label)
          await expect(valueBox(body, path)).toHaveCount(0)
          await expect(referenceToggle(body, path)).toHaveCount(0)
        })
      }

      await test.step('the sheet and the Test save', async () => {
        if (block === 'wait-until') await sheet.locator('[data-testid="param-input-timeout"]').fill('1000')
        await saveBlockSheet(sheet)
        await saveTest(page)
      })

      await test.step('the saved rows read is_null / is_not_null with no compare-to value', async () => {
        const stored = await getTest(request, testId!)
        const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === blockId)
        expect(node, `the ${name} is stored`).toBeTruthy()
        const rows = storedConditionRows(node!.data.config?.values ?? {}, block)
        expect(rows, JSON.stringify(rows)).toHaveLength(TYPES.length)
        for (const [index, row] of TYPES.entries()) {
          const saved = rows[index]
          // Per REQ-3.1.3.25: is null and not null take no compare-to value.
          expect.soft({ ...saved, reference_value: saved.reference_value ?? null }, `${name} row ${index}`).toEqual(
            literalCondition(String(saved.id), row.variable, row.type, unaryPick(index).wire, null),
          )
        }
      })
    })
  }

  test('a row the variable pick lands on is true or is null stores no compare-to value, and so does a pasted copy', async ({
    page,
    request,
  }) => {
    const landings = [
      { variable: 'v_boolean', type: 'boolean' as const, label: 'is true', wire: 'is_true' },
      { variable: 'v_table', type: 'table' as const, label: 'is null', wire: 'is_null' },
    ]
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-V-NULL-CHECK-OPERATORS landing ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: [],
      variables: Object.fromEntries(
        TYPES.filter((t) => landings.some((l) => l.variable === t.variable)).map((t) => [
          t.variable,
          { type: t.type, scope: 'test', value: t.value },
        ]),
      ),
    })
    await openTest(page, testId)
    const sourceId = await dropBelowStart(page, CHECK_BLOCK_PALETTE.assert)

    await test.step('picking the variable lands each row on its first operator with no value box', async () => {
      const sheet = await openBlockSheet(page, sourceId)
      for (const [index, landing] of landings.entries()) {
        const path = rowPath(index)
        await addLiteralRow(sheet)
        await pickConditionVariable(page, sheet, path, landing.variable)
        await expect(operatorTrigger(sheet, path)).toHaveText(landing.label)
        await expect(valueBox(sheet, path)).toHaveCount(0)
      }
      await saveBlockSheet(sheet)
    })

    let pastedId = ''
    await test.step('the Assert is copied and pasted', async () => {
      const before = await canvasBlockIds(page)
      const source = page.locator(`[data-testid="workflow-node-${sourceId}"]`)
      await source.locator('button').first().click()
      await expect(source).toHaveAttribute('data-selected', 'true')
      await page.keyboard.press('ControlOrMeta+c')
      await page.keyboard.press('ControlOrMeta+v')
      await expect
        .poll(async () => {
          pastedId = (await canvasBlockIds(page)).find((id) => !before.includes(id)) ?? ''
          return pastedId
        }, { message: 'the paste added one Block' })
        .not.toBe('')
      await saveTest(page)
    })

    await test.step('both Asserts store the rows with no compare-to value', async () => {
      const stored = await getTest(request, testId!)
      for (const id of [sourceId, pastedId]) {
        const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === id)
        const rows = storedConditionRows(node?.data.config?.values ?? {}, 'assert')
        // Per REQ-3.1.3.25: an operator that takes no compare-to value stores none.
        expect(rows, `the rows of ${id}`).toEqual(
          landings.map((l, index) => literalCondition(String(rows[index]?.id), l.variable, l.type, l.wire, null)),
        )
      }
    })
  })

  test('a row switched from is null back to not equals stores the empty value a new row has and runs', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-V-NULL-CHECK-OPERATORS switch-back ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: [],
      variables: { v_string: { type: 'string', scope: 'test', value: 'abc' } },
    })
    await openTest(page, testId)
    const assertId = await dropBelowStart(page, CHECK_BLOCK_PALETTE.assert)

    await test.step('v_string is null, then not equals with the box left empty', async () => {
      const sheet = await openBlockSheet(page, assertId)
      const single = sheet.getByRole('radio', { name: 'Single', exact: true })
      await single.click()
      await expect(single).toHaveAttribute('data-state', 'checked')
      await addLiteralRow(sheet)
      await pickConditionVariable(page, sheet, '0', 'v_string')
      await pickOperator(page, sheet, '0', 'is null')
      await expect(valueBox(sheet, '0')).toHaveCount(0)
      await pickOperator(page, sheet, '0', 'not equals')
      await expect(valueBox(sheet, '0')).toHaveValue('')
      await saveBlockSheet(sheet)
      await saveTest(page)
    })

    await test.step('the stored row holds the empty compare-to value', async () => {
      const stored = await getTest(request, testId!)
      const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === assertId)
      const [row] = storedConditionRows(node?.data.config?.values ?? {}, 'assert')
      expect(row).toEqual(literalCondition(String(row?.id), 'v_string', 'string', 'not_equals', ''))
    })

    await test.step("Run: 'abc' not equals '' holds and nothing names a null compare-to value", async () => {
      await selectEnvironment(page)
      const run = await runToEnd(page)
      expect(run.verdict, formatEntries(run.entries)).toBe('passed')
      await expectNodeStatus(page, assertId, 'success')
      expect(run.entries.filter((e) => e.message.includes('The value compared with'))).toEqual([])
    })
  })

  test('a CSV filter row switched from String to Boolean lands on is true and stores no compare-to value', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-V-NULL-CHECK-OPERATORS filter ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nodes: [],
    })
    await openTest(page, testId)
    const csvId = await dropBelowStart(page, { term: 'csv', testId: 'palette-item-csv-parser' })

    await test.step('a String filter row on flag equals yes is switched to Boolean', async () => {
      const sheet = await openBlockSheet(page, csvId)
      await setStringParam(sheet, page, 'csv_content', 'flag')
      const block = await addFilterBlock(page, sheet, 'flag', 'string')
      const operator = await addFilterLiteral(page, block, 'equals', 'yes')
      await setFilterAsType(page, block, 'boolean')
      await expect(operator).toHaveText('is true')
      await expect(block.locator('[data-testid^="filter-condition-value-"]')).toHaveCount(0)
      await saveBlockSheet(sheet)
      await saveTest(page)
    })

    await test.step('the stored row is is_true with no compare-to value', async () => {
      const stored = await getTest(request, testId!)
      const node = (stored.workflow.nodes as Array<Record<string, any>>).find((n) => n.id === csvId)
      const filters = (node?.data.config?.values?.filters ?? []) as Array<{ conditions: Array<Record<string, unknown>> }>
      const row = filters[0]?.conditions?.[0]
      expect(row, JSON.stringify(filters)).toEqual(literalCondition(String(row?.id), '_cell', 'boolean', 'is_true', null))
    })
  })
})
