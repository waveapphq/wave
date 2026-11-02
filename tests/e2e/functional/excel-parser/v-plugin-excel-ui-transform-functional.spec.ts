/**
 * V-PLUGIN-EXCEL-UI-TRANSFORM: sorts and filters built in the Excel config sheet run as built
 * Design Decisions: XLS-3, CSV-7, CSV-8, CSV-9, CSV-12
 * REQ: REQ-3.4.1.13, REQ-3.1.3.25
 *
 * Seed: blank Tests (`POST /tests`, no blocks), each with its workbook uploaded as Test Data
 * (`helpers/testdata.ts` `uploadTestData`): `amounts.xlsx` (sheet `Amounts`: id / amount rows
 * a 3, b 8, c 12), `filters.xlsx` and `sorts.xlsx` (the shared filter and sort matrix rows of
 * `helpers/table-transform.ts`, a null cell left out of the sheet). Everything under test in
 * them is built through the UI: Excel blocks dropped under Start or under each other, the
 * workbook picked from Test Data, sorts, filter blocks with literal conditions and the Table
 * outputs bound to new variables; a Log prints the kept ids in the first test. Per "as" type,
 * one more Test (`POST /tests`, `filters.xlsx` uploaded) holds one Excel block per operator and
 * column, its filter generated in the shape the sheet stored (`filterMatrixSeed`).
 *
 * Pass Criteria:
 * 1. The saved block holds the sort and the filter in the one stored shape (CSV-12): a column
 *    reference `{mode, value}`, and a condition item with `variable: _cell`.
 * 2. The Excel Read block built in the sheet (sort `amount` descending; filter `amount` as
 *    Integer, greater than 5) runs: its status is success.
 * 3. The Log prints the kept rows in sort order: `c,b`.
 * 4. Per "as" type (String, Integer, Float, Boolean) a filter built in the sheet keeps the
 *    expected ids, and the generator writes exactly the shape the sheet stored.
 * 5. Every operator of each "as" type keeps the expected ids on a held column and on a column
 *    whose row b holds null; only not equals, does not contain and is null keep the null row (REQ-3.1.3.25).
 * 6. Sorts built in the sheet by name and by index, ascending and descending, order the rows;
 *    two keys keep their priority order; a null cell sorts last on a descending key.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { exprToggle } from '../../helpers/config-sheet'
import { getTest, runToken } from '../../helpers/element-types'
import { createValidTest, openTest, type RawTestSpec } from '../../helpers/fn-seed'
import { startRun } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  FILTER_COLUMNS,
  FILTER_DATA,
  PRIORITY_SORT_CELLS,
  SHEET_BUILT_CELLS,
  SINGLE_SORT_CELLS,
  SORT_DATA,
  addFilterBlock,
  addFilterLiteral,
  addSort,
  addSortOn,
  buildWorkbook,
  filterCell,
  filterMatrixSeed,
  keptIds,
  keptIdsByName,
  nameRef,
  runAndReadSession,
  storedFilter,
  storedSort,
  transformSource,
  withoutIds,
  type FilterColumnType,
  type SheetCell,
  type SortCell,
} from '../../helpers/table-transform'
import { uploadTestData } from '../../helpers/testdata'
import { dropBelow, dropUnderLane, dropUnderStart } from '../canvas-lanes/lanes-helpers'
import {
  deleteTest,
  expectRowValue,
  openConfig,
  openPicker,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'

const WORKBOOK_NAME = 'amounts.xlsx'
const WORKBOOK_ROWS: ReadonlyArray<readonly SheetCell[]> = [
  ['id', 'amount'],
  ['a', 3],
  ['b', 8],
  ['c', 12],
]
const ROWS_VARIABLE = 'rows'
const KEPT_IDS_EXPRESSION = "','.join(rows.col('id'))"
const KEPT_IDS = 'c,b'
const STORED_TRANSFORM = {
  sorts: [{ column: { mode: 'name', value: 'amount' }, direction: 'desc' }],
  filters: [
    {
      column: { mode: 'name', value: 'amount' },
      asType: 'integer',
      conditions: [
        {
          type: 'literal',
          variable: '_cell',
          value_type: 'integer',
          operator: 'greater_than',
          reference_value: '5',
          reference_is_expression: false,
        },
      ],
    },
  ],
}

const EXCEL_BLOCK = { term: 'excel', testId: 'palette-item-excel-parser' }
const FILTER_BOOK = 'filters.xlsx'
const SORT_BOOK = 'sorts.xlsx'
const AS_TYPES: readonly FilterColumnType[] = ['string', 'integer', 'float', 'boolean']
const AS_TYPE_TITLES: Record<FilterColumnType, string> = {
  string: 'String',
  integer: 'Integer',
  float: 'Float',
  boolean: 'Boolean',
}
const SORT_GROUPS: ReadonlyArray<{ title: string; cells: readonly SortCell[] }> = [
  {
    title: 'by name and by index, ascending',
    cells: SINGLE_SORT_CELLS.filter((cell) => cell.keys[0].direction === 'asc'),
  },
  {
    title: 'by name and by index, descending',
    cells: SINGLE_SORT_CELLS.filter((cell) => cell.keys[0].direction === 'desc'),
  },
  { title: 'two keys keep their priority order and a null cell sorts last', cells: PRIORITY_SORT_CELLS },
]

/** Bind an output to a variable the save creates. */
async function bindToNewVariable(sheet: Locator, outputLabel: string, name: string): Promise<void> {
  const assign = sheet.getByRole('combobox', { name: `Assign ${outputLabel} to`, exact: true })
  await assign.fill(name)
  await expect(sheet.page().getByTestId('output-new-var-hint').filter({ hasText: `“${name}”` })).toHaveText(
    `“${name}” will be created as a new variable`,
  )
  await assign.press('Escape')
  await expect(sheet).toBeVisible()
}

/** Drop a Log under the block and set its message to an expression; returns the Log id. */
async function addExpressionLog(page: Page, afterId: string, expression: string): Promise<string> {
  const logId = await dropBelow(page, afterId, null, 'log')
  const sheet = await openConfig(page, logId)
  const toggle = exprToggle(sheet, 'message')
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = sheet.locator('[data-testid="param-input-message"] .cm-content')
  await editor.click()
  await page.keyboard.insertText(expression)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeVisible()
  await expect(editor).toHaveText(expression)
  await saveConfig(sheet)
  return logId
}

/** Wait for the run to settle and its console to carry the Log line or the failure. */
async function settledEntries(page: Page, status: Locator): Promise<LogEntry[]> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = await getLogEntries(page)
        return entries.some((e) => e.source === 'Log' || e.level === 'ERROR' || e.level === 'FATAL')
      },
      { timeout: 30_000, message: 'the console carries the Log line or the failure' },
    )
    .toBe(true)
  return entries
}

/** A block's stored setting values. */
function storedValues(stored: Record<string, any>, nodeId: string): Record<string, any> {
  const node = (stored.workflow.nodes as Array<Record<string, any>>).find((candidate) => candidate.id === nodeId)
  expect(node, `block ${nodeId} is stored`).toBeTruthy()
  return node?.data.config.values ?? {}
}

/** Create a Test with its workbook in Test Data; the id joins `created` for cleanup. */
async function testWithWorkbook(
  request: APIRequestContext,
  created: string[],
  spec: Partial<RawTestSpec> & { name: string },
  workbook: string,
  rows: ReadonlyArray<readonly SheetCell[]>,
): Promise<string> {
  const id = await createValidTest(request, { nodes: [], edges: [], ...spec })
  created.push(id)
  await uploadTestData(request, id, '', workbook, buildWorkbook(rows))
  return id
}

/** Build an Excel Read block under Start or under `afterId`: the workbook, its shaping, the Table bound. */
async function buildExcelBlock(
  page: Page,
  afterId: string | null,
  workbook: string,
  table: string,
  shape: (sheet: Locator) => Promise<void>,
): Promise<string> {
  const id =
    afterId === null ? await dropUnderStart(page, EXCEL_BLOCK) : await dropUnderLane(page, afterId, null, EXCEL_BLOCK)
  const sheet = await openConfig(page, id)
  const picker = await openPicker(page, sheet, 'workbook', 'file')
  await picker.testDataTab.click()
  await picker.file(workbook).dblclick()
  await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
  await expectRowValue(sheet, 'workbook', `testdata://${workbook}`)
  await shape(sheet)
  await bindToNewVariable(sheet, 'Table', table)
  await saveConfig(sheet)
  return id
}

test.describe('V-PLUGIN-EXCEL-UI-TRANSFORM: sorts and filters built in the Excel sheet run', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('a sort and a filter built in the sheet run', async ({ page, request }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-excel-ui-transform-${runToken()}`,
      nodes: [],
      edges: [],
    })
    await uploadTestData(request, testId, '', WORKBOOK_NAME, buildWorkbook(WORKBOOK_ROWS, 'Amounts'))
    await openTest(page, testId)

    let excelId = ''
    let logId = ''
    await test.step('the Excel block is built in its sheet: the workbook, a sort, a filter, the Table bound', async () => {
      excelId = await dropUnderStart(page, { term: 'excel', testId: 'palette-item-excel-parser' })
      const sheet = await openConfig(page, excelId)
      const picker = await openPicker(page, sheet, 'workbook', 'file')
      await picker.testDataTab.click()
      await picker.file(WORKBOOK_NAME).dblclick()
      await expect(picker.sheet).toBeHidden({ timeout: 10_000 })
      await expectRowValue(sheet, 'workbook', `testdata://${WORKBOOK_NAME}`)
      // Per CSV-7: one sort key, amount descending.
      await addSort(page, sheet, 'amount', 'desc')
      // Per CSV-8: one filter block on amount as Integer, greater than 5.
      const block = await addFilterBlock(page, sheet, 'amount', 'integer')
      await addFilterLiteral(page, block, 'greater than', '5')
      await bindToNewVariable(sheet, 'Table', ROWS_VARIABLE)
      await saveConfig(sheet)
    })

    await test.step('a Log under it prints the kept ids', async () => {
      logId = await addExpressionLog(page, excelId, KEPT_IDS_EXPRESSION)
    })

    await test.step('the saved Test holds the two blocks in a line from Start', async () => {
      await saveWorkbench(page)
      const stored = await getTest(request, testId)
      expect(
        (stored.workflow.edges as Array<{ source: string; target: string }>).map((e) => [e.source, e.target]),
      ).toEqual([
        ['start-node', excelId],
        [excelId, logId],
      ])
      expect(stored.variables[ROWS_VARIABLE]?.type, JSON.stringify(stored.variables)).toBe('table')
      const excel = (stored.workflow.nodes as Array<Record<string, any>>).find((node) => node.id === excelId)
      expect(excel?.data.config.values, 'the sheet stores the one sort and filter shape (CSV-12)').toMatchObject(
        STORED_TRANSFORM,
      )
    })

    const status = await startRun(page)
    const entries = await settledEntries(page, status)

    await test.step('the Excel block runs and the Log prints the kept rows in sort order', async () => {
      await expect(
        page.locator(`[data-testid="workflow-node-${excelId}"]`),
        `the Excel block built in the sheet runs.\n${formatEntries(entries)}`,
      ).toHaveAttribute('data-execution-status', 'success')
      expectConsoleLine(entries, 'INFO', KEPT_IDS)
    })
  })
})

test.describe('V-PLUGIN-EXCEL-UI-TRANSFORM: every filter operator and sort', () => {
  const created: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTest(request, id)
  })

  for (const asType of AS_TYPES) {
    const title = AS_TYPE_TITLES[asType]
    const columns = FILTER_COLUMNS[asType]

    test(`${title} filters keep the right rows on held cells and on a column with a null cell`, async ({
      page,
      request,
    }) => {
      test.setTimeout(300_000)
      await ensureEnvironment(request)
      const built = SHEET_BUILT_CELLS[asType]
      const cell = filterCell(asType, built.operator)
      const column = columns[built.side]
      const table = `ui_${asType}`
      const testId = await testWithWorkbook(
        request,
        created,
        { name: `zz-excel-filter-${asType}-${runToken()}` },
        FILTER_BOOK,
        FILTER_DATA,
      )
      await openTest(page, testId)

      let excelId = ''
      await test.step(`a ${title} filter is built in the sheet: ${cell.label} on ${column}`, async () => {
        excelId = await buildExcelBlock(page, null, FILTER_BOOK, table, async (sheet) => {
          // Per CSV-8: one filter block with one literal condition.
          const block = await addFilterBlock(page, sheet, column, asType)
          await addFilterLiteral(page, block, cell.label, cell.value)
        })
        await saveWorkbench(page)
      })

      await test.step('the generator writes the shape the sheet stored (CSV-12)', async () => {
        const values = storedValues(await getTest(request, testId), excelId)
        expect(withoutIds(values.filters)).toEqual(
          withoutIds([storedFilter('sheet', nameRef(column), asType, cell.operator, cell.value)]),
        )
      })

      await test.step('the filter built in the sheet keeps its rows', async () => {
        const run = await runAndReadSession(page)
        expect(run.verdict, `the run passes.\n${formatEntries(run.entries)}`).toBe('passed')
        expect(keptIds(run.variables, table)).toBe(cell[built.side])
      })

      await test.step(`every ${title} operator on ${columns.held} and on ${columns.withNull}`, async () => {
        const seed = filterMatrixSeed('excel', asType, transformSource('excel', FILTER_DATA, FILTER_BOOK))
        const seededId = await testWithWorkbook(
          request,
          created,
          {
            name: `zz-excel-filter-matrix-${asType}-${runToken()}`,
            nodes: seed.nodes,
            edges: seed.edges,
            variables: seed.variables,
          },
          FILTER_BOOK,
          FILTER_DATA,
        )
        await openTest(page, seededId)
        const run = await runAndReadSession(page)
        expect(run.verdict, `the run passes.\n${formatEntries(run.entries)}`).toBe('passed')
        expect(keptIdsByName(run.variables, Object.keys(seed.expected)), 'the ids each filter keeps').toEqual(
          seed.expected,
        )
      })
    })
  }

  for (const group of SORT_GROUPS) {
    test(`sorts built in the sheet run: ${group.title}`, async ({ page, request }) => {
      test.setTimeout(240_000)
      await ensureEnvironment(request)
      const testId = await testWithWorkbook(
        request,
        created,
        { name: `zz-excel-sorts-${runToken()}` },
        SORT_BOOK,
        SORT_DATA,
      )
      await openTest(page, testId)

      const ids: string[] = []
      await test.step('one Excel block per sort cell is built in its sheet', async () => {
        for (const cell of group.cells) {
          const id = await buildExcelBlock(page, ids.at(-1) ?? null, SORT_BOOK, cell.name, async (sheet) => {
            // Per CSV-7: the keys in priority order.
            for (const key of cell.keys) await addSortOn(page, sheet, key.column, key.direction)
          })
          ids.push(id)
        }
        await saveWorkbench(page)
      })

      await test.step('each block stores its keys in priority order in the one shape (CSV-12)', async () => {
        const stored = await getTest(request, testId)
        for (const [index, cell] of group.cells.entries()) {
          expect(withoutIds(storedValues(stored, ids[index]).sorts), cell.name).toEqual(
            withoutIds(cell.keys.map((key, k) => storedSort(`${k}`, key.column, key.direction))),
          )
        }
      })

      await test.step('the run orders each table as its keys say', async () => {
        const run = await runAndReadSession(page)
        expect(run.verdict, `the run passes.\n${formatEntries(run.entries)}`).toBe('passed')
        expect(
          keptIdsByName(
            run.variables,
            group.cells.map((cell) => cell.name),
          ),
          'the ids in the order each table leaves',
        ).toEqual(Object.fromEntries(group.cells.map((cell) => [cell.name, cell.order])))
      })
    })
  }
})
