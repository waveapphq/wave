/**
 * V-TABLE-FILTER-NULL: table.filter() reads a null cell by the check rule, typed in Variable Setter rows
 * Wireframe: none
 * Design Decisions: CSV-12, VARSET-6
 * REQ: REQ-3.1.3.25, REQ-3.4.1.14, REQ-3.4.3.3
 *
 * Seed: one Test (`POST /tests`) holding a CSV block under Start whose Table output binds the
 * table variable `t` (declared with no value): rows a (apple, 3), b (both cells null), c
 * (cherry, 12). Everything under test is built through the UI: a Variable Setter dropped under
 * the CSV block and nine expression rows typed in its sheet, one per filter operator, each
 * writing the ids the filter keeps into a new string variable.
 *
 * Pass Criteria:
 * 1. The saved Setter holds the nine rows as typed, each in expression mode, and the Save
 *    declares the nine targets as string variables.
 * 2. The run passes and the Setter succeeds.
 * 3. On the null row b: equals, contains, greater than, is not empty and not null drop it;
 *    not equals, does not contain, is empty and is null keep it; each row keeps
 *    exactly the expected ids.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { getTest, runToken } from '../../helpers/element-types'
import { sessionValue } from '../../helpers/fixture-import'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { chainEdges, stackNodes } from '../../helpers/k8s-nodes'
import { formatEntries } from '../../helpers/log-reader'
import {
  runAndReadSession,
  tableVariables,
  transformNode,
  transformSource,
  type SheetCell,
} from '../../helpers/table-transform'
import { dropUnderLane } from '../canvas-lanes/lanes-helpers'
import { deleteTest, openConfig, saveConfig, saveWorkbench } from '../file-picker/picker'

const SOURCE_ID = 'csv-source'
const TABLE = 't'
const SOURCE_ROWS: ReadonlyArray<readonly SheetCell[]> = [
  ['id', 'name', 'amount'],
  ['a', 'apple', 3],
  ['b', null, null],
  ['c', 'cherry', 12],
]
const SETTER = { term: 'var setter', testId: 'palette-item-variable-setter' }

/** One Setter row per filter operator: the target, the expression typed, the ids it keeps. */
const ROWS: ReadonlyArray<{ name: string; expression: string; kept: string }> = [
  { name: 'r_equals', expression: "','.join(t.filter('name').equals('apple').col('id'))", kept: 'a' },
  { name: 'r_not_equals', expression: "','.join(t.filter('name').not_equals('apple').col('id'))", kept: 'b,c' },
  { name: 'r_contains', expression: "','.join(t.filter('name').contains('e').col('id'))", kept: 'a,c' },
  {
    name: 'r_does_not_contain',
    expression: "','.join(t.filter('name').does_not_contain('e').col('id'))",
    kept: 'b',
  },
  { name: 'r_greater_than', expression: "','.join(t.filter('amount').greater_than(5).col('id'))", kept: 'c' },
  { name: 'r_is_empty', expression: "','.join(t.filter('amount').is_empty().col('id'))", kept: 'b' },
  { name: 'r_is_not_empty', expression: "','.join(t.filter('amount').is_not_empty().col('id'))", kept: 'a,c' },
  { name: 'r_is_null', expression: "','.join(t.filter('name').is_null().col('id'))", kept: 'b' },
  { name: 'r_is_not_null', expression: "','.join(t.filter('name').is_not_null().col('id'))", kept: 'a,c' },
]

/** Type one Setter row: the target name, expression mode, then the expression in one input. */
async function typeExpressionRow(
  page: Page,
  sheet: Locator,
  index: number,
  name: string,
  expression: string,
): Promise<void> {
  const add = sheet.locator('[data-testid="varset-add-button"]')
  const nameInput = sheet.locator(`[data-testid="varset-name-input-${index}"]`)
  if ((await nameInput.count()) === 0) await add.click()
  await expect(nameInput).toBeVisible()
  await nameInput.fill(name)
  // Focus moves off the name so its suggestion list closes without an Escape that could close the sheet.
  await add.focus()
  const toggle = sheet.locator(`[data-testid="varset-expression-toggle-${index}"]`)
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = sheet.locator(`[data-testid="param-input-${name}"] .cm-content`)
  await editor.click()
  await page.keyboard.insertText(expression)
  await expect(editor).toHaveText(expression)
  await leaveExpressionEditor(editor)
  await expect(sheet).toBeVisible()
  await expect(editor).toHaveText(expression)
}

test.describe('V-TABLE-FILTER-NULL: table.filter() on a null cell follows the check rule', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('nine filter operators typed in Variable Setter rows read the null row by the check rule', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const source = transformNode('csv', {
      id: SOURCE_ID,
      source: transformSource('csv', SOURCE_ROWS),
      table: TABLE,
    })
    testId = await createValidTest(request, {
      name: `zz-table-filter-null-${runToken()}`,
      nodes: stackNodes([source]),
      edges: chainEdges([SOURCE_ID]),
      variables: tableVariables([TABLE]),
    })
    await openTest(page, testId)

    let setterId = ''
    await test.step('a Variable Setter under the CSV block gets nine expression rows typed in its sheet', async () => {
      setterId = await dropUnderLane(page, SOURCE_ID, null, SETTER)
      const sheet = await openConfig(page, setterId)
      for (const [index, row] of ROWS.entries()) {
        await typeExpressionRow(page, sheet, index, row.name, row.expression)
      }
      await saveConfig(sheet)
    })

    await test.step('the saved Test holds the rows as typed and declares their targets', async () => {
      await saveWorkbench(page)
      const stored = await getTest(request, testId)
      expect(
        (stored.workflow.edges as Array<{ source: string; target: string }>).map((e) => [e.source, e.target]),
      ).toEqual([
        ['start-node', SOURCE_ID],
        [SOURCE_ID, setterId],
      ])
      const setter = (stored.workflow.nodes as Array<Record<string, any>>).find((node) => node.id === setterId)
      expect(setter?.data.config.values.variables, 'the stored Setter rows').toEqual(
        Object.fromEntries(ROWS.map((row) => [row.name, row.expression])),
      )
      expect([...(setter?.data.variableExpressionKeys ?? [])].sort(), 'every row is an expression').toEqual(
        ROWS.map((row) => row.name).sort(),
      )
      for (const row of ROWS) {
        expect(stored.variables[row.name]?.type, `the Save declares ${row.name}`).toBe('string')
      }
    })

    const run = await runAndReadSession(page)

    await test.step('every row keeps the ids the check rule gives on the null row', async () => {
      expect(run.verdict, `the run passes.\n${formatEntries(run.entries)}`).toBe('passed')
      await expect(page.locator(`[data-testid="workflow-node-${setterId}"]`)).toHaveAttribute(
        'data-execution-status',
        'success',
      )
      const variables = run.variables
      expect(
        Object.fromEntries(ROWS.map((row) => [row.name, sessionValue(variables, row.name)])),
        'the ids each filter keeps',
      ).toEqual(Object.fromEntries(ROWS.map((row) => [row.name, row.kept])))
    })
  })
})
