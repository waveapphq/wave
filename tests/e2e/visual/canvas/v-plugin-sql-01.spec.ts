/**
 * V-PLUGIN-SQL-01: SQL block config sheet
 * Design Decisions: SQL-1, SQL-2, SQL-3, SQL-4, SQL-6, SQL-7, SQL-8, SQL-9, SQL-10, FIELD-2, FIELD-7,
 *                   FIELD-10, FIELDERR-1, FIELDERR-3
 * REQ: REQ-3.4.1.6, REQ-5.1.4
 *
 * Runs in the no-data project list. Each test seeds its own Test holding one SQL block and
 * afterAll deletes it. A block with empty required rows cannot pass POST /tests, so it is
 * persisted through the admin bulk route and the server's findings are asserted instead.
 * Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. Run SQL on open: the header carries the Database glyph in purple and the title
 *    "SQL - Edit Config", Version 1.0.0; the input table reads Parameter / Type / Value and the
 *    rows read Operation (Run SQL), Database type (PostgreSQL), Host*, Port (hint 5432, nothing
 *    stored), Database*, Username*, Password (secret, lock icon), Script Type (Source), SQL* (with
 *    the {} expression toggle), Parameters (`{}` in gray), Stop on error (ticked) and Timeout
 *    (300 in gray), then TLS / Certificates, Advanced, Failure Handling and Secrets, all collapsed.
 *    Operation, Database type and Script Type take no expression toggle.
 * 2. The empty required rows are exactly the ones the server names (Host, Database, Username,
 *    SQL); each is flagged as the sheet opens, and the note under the disabled Save is the
 *    generic "Save is disabled: the settings have errors".
 * 3. Operation offers Run SQL / Call procedure / Load table; Database type offers PostgreSQL /
 *    MySQL / MariaDB / Oracle / SQL Server / SQLite; Script Type File puts SQL File (required,
 *    Browse) where SQL was, and Source brings SQL back.
 * 4. TLS / Certificates opens to the TLS toggle alone, unticked, with no expression toggle and
 *    nothing under it; Advanced opens to Connect timeout (30 in gray), Max rows (10000 in gray)
 *    and Driver options (`{}` in gray); Failure Handling holds On error on Fail the block.
 * 5. The Port hint follows Database type: 3306 on MySQL / MariaDB, 1521 on Oracle, 1433
 *    on SQL Server, 5432 on PostgreSQL. SQL Server turns TLS on by default and shows Verify
 *    Server Certificate (ticked), CA Certificate, Client Certificate and Client Key (lock icon);
 *    the other types leave TLS off with nothing under it.
 * 6. SQLite: File (required, path hint, Browse) replaces Host, Port, Database, Username
 *    and Password, the TLS / Certificates group is gone and Operation offers Run SQL / Load
 *    table only; PostgreSQL brings the connection rows and the group back.
 * 7. Call procedure: Procedure* (empty), Arguments (`{}` in gray) and Out arguments (`[]` in gray,
 *    no expression toggle, FIELD-10) replace the script rows; the server names Host, Database,
 *    Username and Procedure; the Out arguments list editor opens empty and its Add argument adds
 *    argument 1. TLS stored on shows its four rows; unticking TLS
 *    removes them and ticking it brings them back. Advanced keeps Max rows. Database type
 *    SQLite keeps Call procedure shown but flags the Operation row at once with "Operation 'Call
 *    procedure' is not available on SQLite"; PostgreSQL clears it.
 * 8. Load table: Table* (typed Table, Browse), Target table*, Mode (Add; Add / Add or replace /
 *    Overwrite, no toggle) and Commit each batch (unticked, no toggle) take the script rows'
 *    place; the server names Host, Database, Username, Table and Target table. Add or replace
 *    reveals Key columns beneath Mode and Overwrite removes it; Commit each batch on reveals
 *    Stop on error (ticked) beneath it. Advanced reads Connect timeout, Batch size (1000 in gray) and
 *    Driver options, with no Max rows.
 * 9. Outputs read Parameter / Type / Secret / Assign to: Run SQL Success (Boolean), Rows
 *    (Table), Row count (Integer), Rows changed (Integer); Call procedure Success, Rows, Row
 *    count, Out values (Table); Load table Success, Rows changed; Error and Reason (String) join
 *    only under On error = Record and continue.
 * 10. SQL in expression mode: the literal SQL opens the SQL editor (the `:name` coloring, Get
 *    Tables, Run); {} on asks the switch warning (FIELD-7) and Clear makes the row the inline
 *    expression editor, empty; its full editor
 *    (Ctrl+E, "Edit SQL") has no SQL coloring, no Get Tables chip and no Run, and no SQL editor
 *    opens; the saved block lists `sql` among its expression fields with the expression as its
 *    value.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { expandGroup } from '../../functional/file-picker/picker'
import { getNode } from '../../helpers/element-types'
import { saveBtn } from '../../helpers/workbench'
import {
  browseButton,
  checkbox,
  closeValueEditor,
  editPreview,
  elementColor,
  enumTrigger,
  expectLayout,
  expectOptions,
  expectOutputs,
  exprToggle,
  groupHeader,
  headerTexts,
  listAddButton,
  listItems,
  listPositions,
  numberInput,
  openFieldEditor,
  openListEditor,
  outputRow,
  paramRow,
  pickEnum,
  requiredStar,
  resolvedColor,
  rowAlerts,
  rowError,
  rowLabel,
  saveButton,
  secretsTrigger,
  settingsNote,
} from '../../helpers/config-sheet'
import { resetButton, switchWarning } from '../../helpers/value-field'
import {
  SETTINGS_NOTE,
  SQL_NODE_ID,
  SQL_SHEET_TITLE,
  deleteSqlTests,
  openIncompleteSqlSheet,
  openValidSqlSheet,
} from './sql-sheet-seed'

// --- expected sheet content, verbatim from the shipped schema ---------------

type Control = 'edit' | 'select' | 'number' | 'checkbox' | 'map' | 'list'

interface RowSpec {
  label: string
  type: string
  control: Control
  required: boolean
  expression: boolean
  browse?: boolean
  secret?: boolean
}

const ROWS: Record<string, RowSpec> = {
  operation: { label: 'Operation', type: 'String', control: 'select', required: false, expression: false },
  database_type: { label: 'Database type', type: 'String', control: 'select', required: false, expression: false },
  host: { label: 'Host', type: 'String', control: 'edit', required: true, expression: true },
  port: { label: 'Port', type: 'Integer', control: 'number', required: false, expression: true },
  database: { label: 'Database', type: 'String', control: 'edit', required: true, expression: true },
  username: { label: 'Username', type: 'String', control: 'edit', required: true, expression: true },
  password: { label: 'Password', type: 'String', control: 'edit', required: false, expression: true, secret: true },
  file: { label: 'File', type: 'String', control: 'edit', required: true, expression: true, browse: true },
  script_type: { label: 'Script Type', type: 'String', control: 'select', required: false, expression: false },
  sql: { label: 'SQL', type: 'String', control: 'edit', required: true, expression: true },
  sql_file: { label: 'SQL File', type: 'String', control: 'edit', required: true, expression: true, browse: true },
  parameters: { label: 'Parameters', type: 'Map', control: 'map', required: false, expression: true },
  stop_on_error: { label: 'Stop on error', type: 'Boolean', control: 'checkbox', required: false, expression: true },
  procedure: { label: 'Procedure', type: 'String', control: 'edit', required: true, expression: true },
  arguments: { label: 'Arguments', type: 'Map', control: 'map', required: false, expression: true },
  out_arguments: { label: 'Out arguments', type: 'Array', control: 'list', required: false, expression: false },
  table: { label: 'Table', type: 'Table', control: 'edit', required: true, expression: true, browse: true },
  target_table: { label: 'Target table', type: 'String', control: 'edit', required: true, expression: true },
  mode: { label: 'Mode', type: 'String', control: 'select', required: false, expression: false },
  key_columns: { label: 'Key columns', type: 'String', control: 'edit', required: false, expression: true },
  commit_each_batch: { label: 'Commit each batch', type: 'Boolean', control: 'checkbox', required: false, expression: false },
  timeout: { label: 'Timeout', type: 'Integer', control: 'number', required: false, expression: true },
  tls: { label: 'TLS', type: 'Boolean', control: 'checkbox', required: false, expression: false },
  verify_ssl: { label: 'Verify Server Certificate', type: 'Boolean', control: 'checkbox', required: false, expression: true },
  ca_cert: { label: 'CA Certificate', type: 'String', control: 'edit', required: false, expression: true },
  client_cert: { label: 'Client Certificate', type: 'String', control: 'edit', required: false, expression: true },
  client_key: { label: 'Client Key', type: 'String', control: 'edit', required: false, expression: true, secret: true },
  connect_timeout: { label: 'Connect timeout', type: 'Integer', control: 'number', required: false, expression: true },
  max_rows: { label: 'Max rows', type: 'Integer', control: 'number', required: false, expression: true },
  batch_size: { label: 'Batch size', type: 'Integer', control: 'number', required: false, expression: true },
  driver_options: { label: 'Driver options', type: 'Map', control: 'map', required: false, expression: true },
  on_error: { label: 'On error', type: 'String', control: 'select', required: false, expression: false },
}

const HEAD = ['operation', 'database_type']
const CONNECTION = ['host', 'port', 'database', 'username', 'password']
const RUN_ROWS = [...HEAD, ...CONNECTION, 'script_type', 'sql', 'parameters', 'stop_on_error', 'timeout']
const RUN_FILE_ROWS = [...HEAD, ...CONNECTION, 'script_type', 'sql_file', 'parameters', 'stop_on_error', 'timeout']
const CALL_ROWS = [...HEAD, ...CONNECTION, 'procedure', 'arguments', 'out_arguments', 'timeout']
const LOAD_HEAD = [...HEAD, ...CONNECTION, 'table', 'target_table', 'mode']
const LOAD_ROWS = [...LOAD_HEAD, 'commit_each_batch', 'timeout']
const LOAD_REPLACE_ROWS = [...LOAD_HEAD, 'key_columns', 'commit_each_batch', 'timeout']
const LOAD_COMMIT_ROWS = [...LOAD_HEAD, 'key_columns', 'commit_each_batch', 'stop_on_error', 'timeout']
const SQLITE_ROWS = [...HEAD, 'file', 'script_type', 'sql', 'parameters', 'stop_on_error', 'timeout']
const TLS_ROWS = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
const RUN_ADVANCED = ['connect_timeout', 'max_rows', 'driver_options']
const LOAD_ADVANCED = ['connect_timeout', 'batch_size', 'driver_options']
const TLS_GROUP = 'TLS / Certificates'
const CLOSED_TAIL = [`[${TLS_GROUP}]`, '[Advanced]', '[Failure Handling]', '[Secrets]']
const SQLITE_TAIL = ['[Advanced]', '[Failure Handling]', '[Secrets]']
/** SQL-8: a row that reveals or hides other rows takes no expression. */
const REVEAL_ROWS = ['operation', 'database_type', 'tls', 'commit_each_batch']

const OPERATIONS = ['Run SQL', 'Call procedure', 'Load table']
const DATABASE_TYPES = ['PostgreSQL', 'MySQL / MariaDB', 'Oracle', 'SQL Server', 'SQLite']
const DEFAULT_PORTS: Array<[string, string]> = [
  ['MySQL / MariaDB', '3306'],
  ['Oracle', '1521'],
  ['SQL Server', '1433'],
  ['PostgreSQL', '5432'],
]
const FILE_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'
const CALL_ON_SQLITE = "Operation 'Call procedure' is not available on SQLite"

/** SQL-10: the same statement as a literal body and as an expression that gives its text. */
const LITERAL_SQL = 'SELECT id, qty FROM orders WHERE qty >= :min_qty'
const EXPRESSION_SQL = `"${LITERAL_SQL}"`

const RUN_MISSING = ['host', 'database', 'username', 'sql']
const CALL_MISSING = ['host', 'database', 'username', 'procedure']
const LOAD_MISSING = ['host', 'database', 'username', 'table', 'target_table']

const OUTPUTS: Record<string, { label: string; type: string }> = {
  success: { label: 'Success', type: 'Boolean' },
  rows: { label: 'Rows', type: 'Table' },
  row_count: { label: 'Row count', type: 'Integer' },
  rows_changed: { label: 'Rows changed', type: 'Integer' },
  out_values: { label: 'Out values', type: 'Table' },
  error: { label: 'Error', type: 'String' },
  reason: { label: 'Reason', type: 'String' },
}

// --- locators and small helpers ---------------------------------------------

const created: string[] = []

// FIELD-1, FIELD-10: text, map and list rows are each the one value field's line.
const CONTROL_LOCATOR: Record<Control, (sheet: Locator, name: string) => Locator> = {
  edit: editPreview,
  select: enumTrigger,
  number: numberInput,
  checkbox,
  map: editPreview,
  list: editPreview,
}

/** A not-set field shows its default as real text in Text Muted, with no reset icon (FIELD-2). */
async function expectGrayDefault(page: Page, sheet: Locator, name: string, shown: string): Promise<void> {
  const box = CONTROL_LOCATOR[ROWS[name].control](sheet, name)
  await expect(box, `${name} shows its default`).toHaveValue(shown)
  expect(await elementColor(box, 'color'), `${name}: the default is gray`).toBe(
    await resolvedColor(page, 'var(--color-text-muted)'),
  )
  await expect(resetButton(sheet, name), `${name}: no reset while not set`).toHaveCount(0)
}

/** Label, Type text, (i) badge, required marker, value control, toggle, Browse and lock of each row. */
async function expectRows(sheet: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const spec = ROWS[name]
    const row = paramRow(sheet, name)
    expect(await rowLabel(sheet, name), name).toBe(spec.label)
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(spec.type, { useInnerText: true })
    await expect(row.locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
    await expect(requiredStar(sheet, name), `${name} required marker`).toHaveCount(spec.required ? 1 : 0)
    await expect(CONTROL_LOCATOR[spec.control](sheet, name), `${name} ${spec.control}`).toHaveCount(1)
    await expect(exprToggle(sheet, name), `${name} expression toggle`).toHaveCount(spec.expression ? 1 : 0)
    await expect(browseButton(sheet, name), `${name} Browse`).toHaveCount(spec.browse ? 1 : 0)
    await expect(row.locator('svg.lucide-lock'), `${name} lock icon`).toHaveCount(spec.secret ? 1 : 0)
  }
}

async function expectNoRevealToggles(sheet: Locator): Promise<void> {
  for (const name of REVEAL_ROWS) {
    if ((await paramRow(sheet, name).count()) === 0) continue
    await expect(exprToggle(sheet, name), `${name} reveals rows, so it takes no expression`).toHaveCount(0)
  }
}

async function expectAbsent(sheet: Locator, names: string[], label: string): Promise<void> {
  for (const name of names) await expect(paramRow(sheet, name), `${name} ${label}`).toHaveCount(0)
}

async function expectOutputRows(sheet: Locator, names: string[]): Promise<void> {
  for (const name of names) {
    const { label, type } = OUTPUTS[name]
    const row = outputRow(sheet, name)
    await expect(row.locator('td:nth-child(2)'), name).toHaveText(label)
    await expect(row.locator('td:nth-child(3)'), name).toHaveText(type, { useInnerText: true })
    await expect(row.locator('td:first-child .cursor-help'), `${name} info badge`).toHaveCount(1)
    await expect(sheet.locator(`[data-testid="output-secret-${name}"]`), name).toHaveAttribute(
      'data-state',
      'unchecked',
    )
    const assign = row.getByRole('combobox', { name: `Assign ${label} to` })
    await expect(assign, name).toHaveAttribute('placeholder', 'variable_name')
    await expect(assign, name).toHaveValue('')
  }
}

async function tickBox(sheet: Locator, name: string, state: 'checked' | 'unchecked'): Promise<void> {
  const box = checkbox(sheet, name)
  await box.scrollIntoViewIfNeeded()
  await box.click()
  await expect(box).toHaveAttribute('data-state', state)
}

// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-SQL-01: SQL block config sheet', () => {
  test.afterAll(async ({ request }) => {
    await deleteSqlTests(request, created)
  })

  test('V-PLUGIN-SQL-01 run SQL: the rows in order, their defaults, four sections collapsed', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-PLUGIN-SQL-01 run', {}, RUN_MISSING)
    created.push(testId)

    const glyph = sheet.getByRole('heading', { name: SQL_SHEET_TITLE }).locator('svg.lucide-database')
    await expect(glyph).toHaveCount(1)
    await expect(glyph).toHaveClass(/\btext-purple-500\b/)
    await expect(sheet.locator('[data-testid="version-selector"]')).toContainText('1.0.0')

    await expect(sheet.getByRole('heading', { name: 'Input Parameters' })).toBeVisible()
    expect(await headerTexts(sheet.locator('table:has([data-testid="param-row-host"])'))).toEqual([
      '',
      'Parameter',
      'Type',
      'Value',
    ])

    // SQL-1, SQL-8: Operation first, then the connection rows, the script rows and Timeout last.
    await expectLayout(sheet, [...RUN_ROWS, ...CLOSED_TAIL], 'run SQL on open')
    await expectRows(sheet, RUN_ROWS)
    await expectNoRevealToggles(sheet)

    await expect(enumTrigger(sheet, 'operation')).toHaveText('Run SQL')
    await expect(enumTrigger(sheet, 'database_type')).toHaveText('PostgreSQL')
    await expect(enumTrigger(sheet, 'script_type')).toHaveText('Source')
    for (const name of ['host', 'database', 'username', 'password', 'sql']) {
      await expect(editPreview(sheet, name), `${name} starts empty`).toHaveValue('')
    }
    await expectGrayDefault(page, sheet, 'parameters', '{}')
    // SQL-3: Stop on error is ticked by default.
    await expect(checkbox(sheet, 'stop_on_error')).toHaveAttribute('data-state', 'checked')
    // SQL-8: a blank Port means the type's default, shown as the hint; nothing is stored.
    await expect(numberInput(sheet, 'port'), 'port default').toHaveAttribute('placeholder', '5432')
    await expect(numberInput(sheet, 'port'), 'port stores nothing').toHaveValue('')
    await expectGrayDefault(page, sheet, 'timeout', '300')

    await expectAbsent(sheet, ['file', 'sql_file', 'procedure', 'table', 'mode', 'tls', ...TLS_ROWS], 'absent')
    for (const group of [TLS_GROUP, 'Advanced', 'Failure Handling']) {
      await expect(groupHeader(sheet, group), `${group} collapsed`).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(secretsTrigger(sheet)).toHaveAttribute('aria-expanded', 'false')

    // FIELDERR-1, FIELDERR-3: every empty required row is flagged at once; the note stays generic.
    for (const name of RUN_MISSING) await expect(rowError(sheet, name), `${name} flagged on open`).toHaveCount(1)
    await expect(rowAlerts(sheet)).toHaveCount(RUN_MISSING.length)
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(sheet)).toBeDisabled()
  })

  test('V-PLUGIN-SQL-01 run SQL selects: Operation, Database type and Script Type', async ({ page }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-PLUGIN-SQL-01 selects', {}, RUN_MISSING)
    created.push(testId)

    await expectOptions(page, sheet, 'operation', OPERATIONS)
    await expectOptions(page, sheet, 'database_type', DATABASE_TYPES)
    await expectOptions(page, sheet, 'script_type', ['Source', 'File'])

    // A .sql file takes the place of the typed SQL; Source brings the typed SQL back.
    await pickEnum(page, sheet, 'script_type', 'File')
    await expectLayout(sheet, [...RUN_FILE_ROWS, ...CLOSED_TAIL], 'script type file')
    await expectRows(sheet, ['sql_file'])
    await expect(editPreview(sheet, 'sql_file')).toHaveAttribute('placeholder', FILE_PLACEHOLDER)
    await expect(editPreview(sheet, 'sql_file')).toHaveValue('')
    await expect(paramRow(sheet, 'sql')).toHaveCount(0)

    await pickEnum(page, sheet, 'script_type', 'Source')
    await expectLayout(sheet, [...RUN_ROWS, ...CLOSED_TAIL], 'script type source again')
    await expect(paramRow(sheet, 'sql_file')).toHaveCount(0)
  })

  test('V-PLUGIN-SQL-01 run SQL groups: TLS off with nothing under it, Advanced, Failure Handling', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-PLUGIN-SQL-01 groups', {}, RUN_MISSING)
    created.push(testId)

    // SQL-8: TLS is a toggle with no expression; off, nothing shows under it.
    await expandGroup(sheet, TLS_GROUP)
    await expectLayout(
      sheet,
      [...RUN_ROWS, `[${TLS_GROUP}]`, 'tls', '[Advanced]', '[Failure Handling]', '[Secrets]'],
      'TLS group open',
    )
    await expectRows(sheet, ['tls'])
    await expect(checkbox(sheet, 'tls')).toHaveAttribute('data-state', 'unchecked')

    // SQL-4, SQL-8: Connect timeout 30, Max rows 10000 and the driver's own options.
    await expandGroup(sheet, 'Advanced')
    await expectLayout(
      sheet,
      [...RUN_ROWS, `[${TLS_GROUP}]`, 'tls', '[Advanced]', ...RUN_ADVANCED, '[Failure Handling]', '[Secrets]'],
      'Advanced open',
    )
    await expectRows(sheet, RUN_ADVANCED)
    await expectGrayDefault(page, sheet, 'connect_timeout', '30')
    await expectGrayDefault(page, sheet, 'max_rows', '10000')
    await expectGrayDefault(page, sheet, 'driver_options', '{}')
    await expect(paramRow(sheet, 'batch_size'), 'Batch size belongs to Load table').toHaveCount(0)

    await expandGroup(sheet, 'Failure Handling')
    await expectLayout(
      sheet,
      [
        ...RUN_ROWS,
        `[${TLS_GROUP}]`,
        'tls',
        '[Advanced]',
        ...RUN_ADVANCED,
        '[Failure Handling]',
        'on_error',
        '[Secrets]',
      ],
      'Failure Handling open',
    )
    await expectRows(sheet, ['on_error'])
    await expect(enumTrigger(sheet, 'on_error')).toHaveText('Fail the block')
  })

  test('V-PLUGIN-SQL-01 database type: the Port default and TLS follow it, SQLite swaps in File', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-PLUGIN-SQL-01 types', {}, RUN_MISSING)
    created.push(testId)
    await expandGroup(sheet, TLS_GROUP)
    const tlsOff = [...RUN_ROWS, `[${TLS_GROUP}]`, 'tls', '[Advanced]', '[Failure Handling]', '[Secrets]']
    const tlsOn = [...RUN_ROWS, `[${TLS_GROUP}]`, 'tls', ...TLS_ROWS, '[Advanced]', '[Failure Handling]', '[Secrets]']

    // SQL-8: a blank Port reads the type's default; TLS is on by default on SQL Server only.
    for (const [type, port] of DEFAULT_PORTS) {
      await pickEnum(page, sheet, 'database_type', type)
      await expect(numberInput(sheet, 'port'), `${type} default port`).toHaveAttribute('placeholder', port)
      await expect(numberInput(sheet, 'port')).toHaveValue('')
      const sqlServer = type === 'SQL Server'
      await expect(checkbox(sheet, 'tls'), `${type} TLS default`).toHaveAttribute(
        'data-state',
        sqlServer ? 'checked' : 'unchecked',
      )
      await expectLayout(sheet, sqlServer ? tlsOn : tlsOff, `${type} rows`)
      if (sqlServer) {
        await expectRows(sheet, TLS_ROWS)
        await expect(checkbox(sheet, 'verify_ssl')).toHaveAttribute('data-state', 'checked')
        for (const name of ['ca_cert', 'client_cert', 'client_key']) {
          await expect(editPreview(sheet, name), `${name} starts empty`).toHaveValue('')
        }
      }
    }
    await expectNoRevealToggles(sheet)

    // SQL-6, SQL-8: SQLite is a file, so File replaces the connection rows and TLS goes.
    await pickEnum(page, sheet, 'database_type', 'SQLite')
    await expectLayout(sheet, [...SQLITE_ROWS, ...SQLITE_TAIL], 'SQLite rows')
    await expectRows(sheet, ['file'])
    await expect(editPreview(sheet, 'file')).toHaveAttribute('placeholder', FILE_PLACEHOLDER)
    await expectAbsent(sheet, [...CONNECTION, 'tls'], 'absent on SQLite')
    await expect(groupHeader(sheet, TLS_GROUP)).toHaveCount(0)
    await expectOptions(page, sheet, 'operation', ['Run SQL', 'Load table'])
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)

    await pickEnum(page, sheet, 'database_type', 'PostgreSQL')
    await expectLayout(sheet, tlsOff, 'back to PostgreSQL')
    await expect(paramRow(sheet, 'file')).toHaveCount(0)
    await expectOptions(page, sheet, 'operation', OPERATIONS)
  })

  test('V-PLUGIN-SQL-01 call procedure: Procedure, Arguments and Out arguments, TLS on with its rows', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(
      page,
      'V-PLUGIN-SQL-01 call',
      { operation: 'call_procedure', tls: true },
      CALL_MISSING,
    )
    created.push(testId)

    // SQL-6: the procedure rows take the place of the script rows.
    await expectLayout(sheet, [...CALL_ROWS, ...CLOSED_TAIL], 'call procedure on open')
    await expectRows(sheet, CALL_ROWS)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Call procedure')
    await expect(editPreview(sheet, 'procedure')).toHaveValue('')
    await expectGrayDefault(page, sheet, 'arguments', '{}')
    await expectGrayDefault(page, sheet, 'out_arguments', '[]')
    await expectAbsent(sheet, ['script_type', 'sql', 'sql_file', 'parameters', 'stop_on_error'], 'absent on Call')
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)

    // FIELD-10: Out arguments opens the shared list editor, numbered from 1.
    const outArguments = await openListEditor(page, sheet, 'out_arguments')
    await expect(listItems(outArguments)).toHaveCount(0)
    await expect(listAddButton(outArguments)).toHaveText('Add argument')
    await listAddButton(outArguments).click()
    await expect(listItems(outArguments)).toHaveCount(1)
    expect(await listPositions(outArguments)).toEqual(['1'])
    await closeValueEditor(page, outArguments)

    // SQL-8: TLS on shows the four trust rows; the toggle alone adds and removes them.
    await expandGroup(sheet, TLS_GROUP)
    const tlsOn = [...CALL_ROWS, `[${TLS_GROUP}]`, 'tls', ...TLS_ROWS, '[Advanced]', '[Failure Handling]', '[Secrets]']
    await expectLayout(sheet, tlsOn, 'TLS on')
    await expectRows(sheet, ['tls', ...TLS_ROWS])
    await expect(checkbox(sheet, 'tls')).toHaveAttribute('data-state', 'checked')
    await expect(checkbox(sheet, 'verify_ssl')).toHaveAttribute('data-state', 'checked')
    await tickBox(sheet, 'tls', 'unchecked')
    await expectLayout(
      sheet,
      [...CALL_ROWS, `[${TLS_GROUP}]`, 'tls', '[Advanced]', '[Failure Handling]', '[Secrets]'],
      'TLS off',
    )
    await tickBox(sheet, 'tls', 'checked')
    await expectLayout(sheet, tlsOn, 'TLS on again')

    // SQL-4: Max rows caps what Call procedure keeps too.
    await expandGroup(sheet, 'Advanced')
    await expectLayout(
      sheet,
      [...CALL_ROWS, `[${TLS_GROUP}]`, 'tls', ...TLS_ROWS, '[Advanced]', ...RUN_ADVANCED, '[Failure Handling]', '[Secrets]'],
      'Advanced open on Call',
    )

    // SQL-6, FIELDERR-1: SQLite has no procedures, and the Operation row says so at once.
    await pickEnum(page, sheet, 'database_type', 'SQLite')
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Call procedure')
    await expect(rowError(sheet, 'operation')).toHaveText(CALL_ON_SQLITE)
    await expect(enumTrigger(sheet, 'operation')).toHaveAttribute('aria-invalid', 'true')
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await pickEnum(page, sheet, 'database_type', 'PostgreSQL')
    await expect(rowError(sheet, 'operation')).toHaveCount(0)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Call procedure')
  })

  test('V-PLUGIN-SQL-01 load table: Mode, Key columns, Commit each batch and Batch size', async ({ page }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(
      page,
      'V-PLUGIN-SQL-01 load',
      { operation: 'load_table' },
      LOAD_MISSING,
    )
    created.push(testId)

    // SQL-7: a WAVE table or a Test Data file goes into a table that already exists.
    await expectLayout(sheet, [...LOAD_ROWS, ...CLOSED_TAIL], 'load table on open')
    await expectRows(sheet, LOAD_ROWS)
    await expectNoRevealToggles(sheet)
    await expect(enumTrigger(sheet, 'operation')).toHaveText('Load table')
    await expect(editPreview(sheet, 'table')).toHaveValue('')
    await expect(editPreview(sheet, 'target_table')).toHaveValue('')
    await expect(enumTrigger(sheet, 'mode')).toHaveText('Add')
    await expect(checkbox(sheet, 'commit_each_batch')).toHaveAttribute('data-state', 'unchecked')
    await expectAbsent(sheet, ['script_type', 'sql', 'parameters', 'procedure', 'key_columns', 'stop_on_error'], 'absent')
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)

    await expectOptions(page, sheet, 'mode', ['Add', 'Add or replace', 'Overwrite'])
    await pickEnum(page, sheet, 'mode', 'Add or replace')
    await expectLayout(sheet, [...LOAD_REPLACE_ROWS, ...CLOSED_TAIL], 'add or replace')
    await expectRows(sheet, ['key_columns'])
    await expect(editPreview(sheet, 'key_columns')).toHaveValue('')
    await pickEnum(page, sheet, 'mode', 'Overwrite')
    await expectLayout(sheet, [...LOAD_ROWS, ...CLOSED_TAIL], 'overwrite')
    await pickEnum(page, sheet, 'mode', 'Add or replace')
    await expectLayout(sheet, [...LOAD_REPLACE_ROWS, ...CLOSED_TAIL], 'add or replace again')

    // SQL-7: Commit each batch on reveals Stop on error, ticked, directly beneath it.
    await tickBox(sheet, 'commit_each_batch', 'checked')
    await expectLayout(sheet, [...LOAD_COMMIT_ROWS, ...CLOSED_TAIL], 'commit each batch on')
    await expectRows(sheet, ['stop_on_error'])
    await expect(checkbox(sheet, 'stop_on_error')).toHaveAttribute('data-state', 'checked')
    await tickBox(sheet, 'commit_each_batch', 'unchecked')
    await expectLayout(sheet, [...LOAD_REPLACE_ROWS, ...CLOSED_TAIL], 'commit each batch off')
    await tickBox(sheet, 'commit_each_batch', 'checked')

    // SQL-7, SQL-8: Batch size 1000 in Advanced; Max rows does not apply to a load.
    await expandGroup(sheet, 'Advanced')
    await expectLayout(
      sheet,
      [...LOAD_COMMIT_ROWS, `[${TLS_GROUP}]`, '[Advanced]', ...LOAD_ADVANCED, '[Failure Handling]', '[Secrets]'],
      'Advanced open on Load',
    )
    await expectRows(sheet, LOAD_ADVANCED)
    await expectGrayDefault(page, sheet, 'batch_size', '1000')
    await expect(paramRow(sheet, 'max_rows')).toHaveCount(0)
  })

  test('V-PLUGIN-SQL-01 outputs: per operation, with Error and Reason under Record and continue', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-PLUGIN-SQL-01 outputs', {}, RUN_MISSING)
    created.push(testId)

    await expect(sheet.getByRole('heading', { name: 'Output Variables' })).toBeVisible()
    expect(await headerTexts(sheet.locator('table:has([data-testid="output-row-success"])'))).toEqual([
      '',
      'Parameter',
      'Type',
      'Secret',
      'Assign to',
    ])

    // SQL-9: Rows and Row count on Run SQL and Call procedure, Rows changed on Run SQL and Load table.
    await expectOutputs(sheet, ['success', 'rows', 'row_count', 'rows_changed'], 'run SQL')
    await expectOutputRows(sheet, ['success', 'rows', 'row_count', 'rows_changed'])

    await expandGroup(sheet, 'Failure Handling')
    await pickEnum(page, sheet, 'on_error', 'Record and continue')
    await expectOutputs(sheet, ['success', 'rows', 'row_count', 'rows_changed', 'error', 'reason'], 'run, record')
    await expectOutputRows(sheet, ['error', 'reason'])

    await pickEnum(page, sheet, 'operation', 'Call procedure')
    await expectOutputs(sheet, ['success', 'rows', 'row_count', 'out_values', 'error', 'reason'], 'call, record')
    await expectOutputRows(sheet, ['out_values'])

    await pickEnum(page, sheet, 'operation', 'Load table')
    await expectOutputs(sheet, ['success', 'rows_changed', 'error', 'reason'], 'load, record')

    await pickEnum(page, sheet, 'on_error', 'Fail the block')
    await expectOutputs(sheet, ['success', 'rows_changed'], 'load, fail the block')

    await pickEnum(page, sheet, 'operation', 'Run SQL')
    await expectOutputs(sheet, ['success', 'rows', 'row_count', 'rows_changed'], 'run SQL again')
  })

  test('V-PLUGIN-SQL-01 SQL as an expression: the expression editor, no SQL editor and no Run', async ({
    page,
    request,
  }) => {
    const { testId, sheet } = await openValidSqlSheet(
      page,
      'V-PLUGIN-SQL-01 expression',
      {
        host: 'db.example.com',
        database: 'shop',
        username: 'reader',
        sql: LITERAL_SQL,
        parameters: { min_qty: '4' },
      },
      { expressionFields: ['parameters.min_qty'] },
    )
    created.push(testId)
    const toggle = exprToggle(sheet, 'sql')
    const inline = sheet.locator('[data-testid="param-input-sql"]')

    await test.step('the literal SQL opens the SQL editor, with its coloring, Get Tables and Run', async () => {
      await expect(toggle).toHaveAttribute('data-state', 'off')
      const sqlEditor = await openFieldEditor(page, sheet, 'sql')
      await expect
        .poll(async () => (await sqlEditor.locator('.cm-sql-placeholder').allTextContents()).join(''), {
          message: 'SQL-10: :name takes the SQL coloring',
        })
        .toBe(':min_qty')
      await expect(sqlEditor.getByTestId('get-tables-chip')).toHaveCount(1)
      await expect(sqlEditor.getByTestId('value-editor-run-button')).toHaveCount(1)
      await sqlEditor.getByTestId('value-editor-cancel-button').click()
      await expect(sqlEditor).toBeHidden()
    })

    await test.step('{} makes the row an expression that gives the SQL text', async () => {
      // FIELD-7: the row holds the literal SQL, so the switch warning asks first; Clear never carries it.
      await toggle.click()
      const warning = switchWarning(page)
      await expect(warning).toBeVisible()
      await warning.locator('[data-testid="switch-mode-clear-default"]').click()
      await expect(warning).toHaveCount(0)
      await expect(toggle).toHaveAttribute('data-state', 'on')
      await expect(inline.locator('.cm-content'), 'the switch starts the expression empty').toHaveText('')
      await expect(editPreview(sheet, 'sql'), 'no SQL editor preview in expression mode').toHaveCount(0)
      await inline.locator('.cm-content').click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.insertText(EXPRESSION_SQL)
      await page.keyboard.press('Escape')
      await expect(sheet, 'Escape left the inline editor, not the sheet').toBeVisible()
      await expect(inline.locator('.cm-content')).toHaveText(EXPRESSION_SQL)
      await expect(inline.locator('.cm-sql-placeholder'), 'no SQL coloring inline').toHaveCount(0)
      await expect(rowError(sheet, 'sql')).toHaveCount(0)
    })

    await test.step('its full editor is the expression editor: no SQL coloring, no Get Tables, no Run', async () => {
      await inline.locator('.cm-content').click()
      await page.keyboard.press('Control+e')
      const modal = page.getByTestId('expression-editor-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('h2').first()).toHaveText('Edit SQL')
      await expect(modal.locator('.cm-content')).toHaveText(EXPRESSION_SQL)
      await expect(modal.locator('.cm-sql-placeholder')).toHaveCount(0)
      await expect(modal.getByTestId('get-tables-chip')).toHaveCount(0)
      await expect(modal.getByTestId('value-editor-run-button')).toHaveCount(0)
      await expect(modal.getByRole('button', { name: /^Run/ })).toHaveCount(0)
      await expect(page.locator('[data-testid="value-editor-sheet"]'), 'no SQL editor opens').toHaveCount(0)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(modal).toBeHidden()
    })

    await test.step('the saved block lists sql among its expression fields', async () => {
      await expect(saveButton(sheet)).toBeEnabled()
      await saveButton(sheet).click()
      await expect(sheet).toBeHidden()
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      const node = await getNode(request, testId, SQL_NODE_ID)
      expect([...(node.data.expressionFields as string[])].sort()).toEqual(['parameters.min_qty', 'sql'])
      expect(node.data.config.values.sql).toBe(EXPRESSION_SQL)
    })
  })
})
