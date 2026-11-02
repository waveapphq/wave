/**
 * V-SQL-DRIVER-OPTIONS-TYPED: each Driver options row declares its type, and the database
 * driver receives the value as that type.
 * Wireframe: N/A
 * Design Decisions: SQL-8 (Driver options, a name / type / value list under Advanced)
 * REQ: REQ-3.4.1.6, REQ-3.1.3.19, REQ-3.1.3.14
 *
 * Two blocks carry typed options already saved (SQLite whole numbers, MariaDB boolean /
 * whole number / text); three are typed through the config sheet: a SQLite decimal, a
 * PostgreSQL block with text, whole-number, map and boolean rows, and a PostgreSQL block
 * with an expression row beside a text row.
 *
 * Pass Criteria:
 * 1. Driver options offers all six types on every row; the SQL Parameters map stays
 *    text-only (no type column).
 * 2. An expression row shows no type, and the expression toggle works beside typed rows;
 *    its result is used as it evaluates, and an exact decimal from a float variable reaches
 *    the driver as a platform number (`timeout` = `wait + 10`, 16.5).
 * 3. The saved nodes carry each row's declared type, expression rows excepted
 *    (GET /tests/{id}/workflow), and a reload reads every type back.
 * 4. The drivers receive the declared types: SQLite `timeout` 7 (whole number) and 2.5
 *    (decimal) become busy timeouts of 7000 and 2500 ms, `cached_statements` 16 is
 *    accepted; PostgreSQL keeps the application name "2024" as text, takes `timeout` 16
 *    as a number and `startup_params` as a map (search_path set); an expression row
 *    evaluates; MariaDB connects with `defer_connect` false as a real boolean and a
 *    whole-number `read_timeout`, and its text `init_command` runs.
 * 5. Get Tables from the SQL editor connects with the same typed and expression rows.
 *
 * Phase: functional-workflow (imports its own fixture; the SQLite file lives in the
 * run's artifacts, which the session clear removes; the Test is deleted after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import { withSqlStack } from '../../helpers/sql-stack'
import { configSheet, saveBtn, selectEnvironment } from '../../helpers/workbench'
import {
  deleteTest,
  expectMapRows,
  expectProbeLines,
  getNode,
  importValidated,
  pickElementType,
  readFixture,
  runToken,
  saveAndCloseSheet,
  settleRun,
  substitute,
  valueSheet,
  type MapRow,
} from '../../helpers/element-types'

const LITE_FLOAT = '3c69d810-19f9-4ee8-9da2-5507af7cba25'
const PG_TYPED = '07a51fa4-9801-4261-8fb5-24b3695e0a04'
const PG_EXPR = 'b1515500-139e-49e8-91f7-070fb4707912'

const ALL_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map']

const PG_ROWS: readonly MapRow[] = [
  { key: 'application_name', text: '2024', type: 'string' },
  { key: 'timeout', text: '16', type: 'integer' },
  { key: 'startup_params', text: '{"search_path": "typed_schema, public"}', type: 'map' },
  { key: 'tcp_keepalive', text: 'true', type: 'boolean' },
]

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

/** Open the Driver options sheet from the Advanced group. */
async function openDriverOptions(page: Page, dialog: Locator): Promise<Locator> {
  const row = dialog.locator('[data-testid="param-row-driver_options"]')
  if (!(await row.isVisible())) await dialog.locator('[data-testid="group-header-Advanced"]').click()
  await dialog.getByTestId('param-expand-driver_options').click()
  await expect(valueSheet(page)).toBeVisible()
  return valueSheet(page)
}

async function saveConfig(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: /^Save$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** A row's type is picked before its text: a type change on a held value asks first and clears it (FIELD-7). */
async function addRow(page: Page, sheet: Locator, index: number, row: MapRow): Promise<void> {
  await sheet.locator('[data-testid="map-add-entry"]').click()
  await sheet.locator(`[data-testid="map-edit-key-${index}"]`).fill(row.key)
  await pickElementType(page, sheet.locator(`[data-testid="map-type-${index}"]`), row.type)
  await sheet.locator(`[data-testid="map-edit-value-${index}"]`).fill(row.text)
}

/** Get Tables from the block's SQL editor ends loaded, never failed. */
async function expectGetTables(page: Page, nodeId: string): Promise<void> {
  const dialog = await openConfig(page, nodeId)
  await dialog.getByTestId('param-expand-sql').click()
  const sheet = valueSheet(page)
  await expect(sheet).toBeVisible()
  const chip = sheet.locator('[data-testid="get-tables-chip"]')
  await chip.getByRole('button', { name: 'Get Tables' }).click()
  await expect(chip, 'Get Tables connects with the typed Driver options').toHaveAttribute(
    'data-state',
    /^(done|settled)$/,
    { timeout: 60_000 },
  )
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
  await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('V-SQL-DRIVER-OPTIONS-TYPED: typed Driver options reach the driver', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('Driver options rows keep their types from the sheet to the driver', async ({ page, request }) => {
    test.setTimeout(300_000)
    const fixture = withSqlStack(
      substitute(readFixture(__dirname, 'fixture-driver-options.json'), { __TOKEN__: runToken() }),
    )
    testId = await importValidated(request, fixture)
    await openTest(page, testId)

    await test.step('SQLite: one decimal row, picked from all six types', async () => {
      const dialog = await openConfig(page, LITE_FLOAT)
      const sheet = await openDriverOptions(page, dialog)
      await sheet.locator('[data-testid="map-add-entry"]').click()
      await sheet.locator('[data-testid="map-edit-key-0"]').fill('timeout')
      // The type is picked before the text: a type change on a held value clears it (FIELD-7).
      await sheet.locator('[data-testid="map-type-0"]').click()
      await expect(page.getByRole('option')).toHaveText(ALL_TYPES)
      await page.getByRole('option', { name: 'float', exact: true }).click()
      await expect(sheet.locator('[data-testid="map-type-0"]')).toHaveText('float')
      await sheet.locator('[data-testid="map-edit-value-0"]').fill('2.5')
      await saveAndCloseSheet(page)
      await saveConfig(dialog)
    })

    await test.step('PostgreSQL: text, whole-number, map and boolean rows; Parameters stays text-only', async () => {
      const dialog = await openConfig(page, PG_TYPED)
      const sheet = await openDriverOptions(page, dialog)
      for (const [index, row] of PG_ROWS.entries()) await addRow(page, sheet, index, row)
      await saveAndCloseSheet(page)

      await dialog.getByTestId('param-expand-parameters').click()
      await valueSheet(page).locator('[data-testid="map-add-entry"]').click()
      const pill = valueSheet(page).locator('[data-testid="map-type-0"]')
      await expect(pill, 'Parameters is text-only: its one type is a read-only pill').toHaveText('string')
      await expect(pill).not.toHaveAttribute('role', 'combobox')
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      const discard = page.locator('[data-testid="value-editor-unsaved-discard-button"]')
      if (await discard.isVisible().catch(() => false)) await discard.click()
      await expect(valueSheet(page)).toBeHidden()
      await saveConfig(dialog)
    })

    await test.step('PostgreSQL: an expression row beside a text row', async () => {
      const dialog = await openConfig(page, PG_EXPR)
      const sheet = await openDriverOptions(page, dialog)
      await addRow(page, sheet, 0, { key: 'application_name', text: 'typed-42', type: 'string' })
      await sheet.locator('[data-testid="map-add-entry"]').click()
      await sheet.locator('[data-testid="map-edit-key-1"]').fill('timeout')
      await sheet.locator('[data-testid="map-expr-toggle-1"]').click()
      await expect(sheet.locator('[data-testid="map-type-1"]'), 'an expression row shows no type').toHaveCount(0)
      const expression = sheet.locator('[data-testid="map-expr-value-1"] .cm-content')
      await expression.click()
      await page.keyboard.type('wait + 10')
      await page.keyboard.press('Escape')
      await expect(sheet.locator('[data-testid="map-type-0"]')).toHaveText('string')
      await saveAndCloseSheet(page)
      await saveConfig(dialog)
    })

    await test.step('save; the nodes carry each row type, expression rows excepted', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      const lite = await getNode(request, testId, LITE_FLOAT)
      expect(lite.data.config.values.driver_options).toEqual({ timeout: '2.5' })
      expect(lite.data.elementTypes).toEqual({ driver_options: { timeout: 'float' } })
      const pg = await getNode(request, testId, PG_TYPED)
      expect(pg.data.config.values.driver_options).toEqual({
        application_name: '2024',
        timeout: '16',
        startup_params: '{"search_path": "typed_schema, public"}',
        tcp_keepalive: true,
      })
      expect(pg.data.elementTypes).toEqual({
        driver_options: { application_name: 'string', timeout: 'integer', startup_params: 'map', tcp_keepalive: 'boolean' },
      })
      const expr = await getNode(request, testId, PG_EXPR)
      expect(expr.data.config.values.driver_options).toEqual({ application_name: 'typed-42', timeout: 'wait + 10' })
      expect(expr.data.expressionFields).toContain('driver_options.timeout')
      expect(expr.data.elementTypes).toEqual({ driver_options: { application_name: 'string' } })
    })

    await test.step('after a reload the Driver options rows read their types back', async () => {
      await openTest(page, testId)
      const dialog = await openConfig(page, PG_TYPED)
      await expectMapRows(await openDriverOptions(page, dialog), PG_ROWS)
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(valueSheet(page)).toBeHidden()
      await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    })

    await test.step('the drivers receive every row as its declared type', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [
        'SQL lite_int=7000 lite_float=2500 app=2024 app_is_text=True sp=typed_schema, public ' +
          'expr_app=typed-42 my=02134',
      ])
    })

    await test.step('Get Tables connects with the typed and the expression rows', async () => {
      await expectGetTables(page, PG_TYPED)
      await expectGetTables(page, PG_EXPR)
    })
  })
})
