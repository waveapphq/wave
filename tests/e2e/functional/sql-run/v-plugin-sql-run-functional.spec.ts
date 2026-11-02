/**
 * V-PLUGIN-SQL-RUN-FUNCTIONAL: Run SQL, direct, on PostgreSQL, MariaDB, Oracle, SQL Server and SQLite
 * Wireframe: N/A
 * Design Decisions: SQL-1, SQL-2, SQL-3, SQL-8, SQL-9, SQL-10
 * REQ: REQ-3.4.1.6
 *
 * One workflow runs the same five blocks against each database, WAVE connecting itself: a script, an
 * insert followed by a failing statement, a Template read-back, a session probe (TLS and a driver
 * option) and a Log; PostgreSQL adds an expression SQL row. Every table the run makes carries a
 * per-run token, and the Finally path of the Try/Catch around it all drops each table and checks it
 * is gone. SQLite runs on a per-run file in the workbench session's artifacts, which the session
 * clear removes. A second test builds one SQL block through the canvas and its sheet.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero errors; its
 *    connection rows are the stack's, and the password and the TLS material come from config.
 * 2. Each script is split the way the database's own tool splits it: `;` (never inside a string),
 *    a PL/SQL block ended by a `/` line on Oracle, `GO` batches on SQL Server where a batch of two
 *    statements counts as one. The console shows the Connected line and one Statement line per
 *    statement, numbered in script order, with its rows or its rows changed.
 * 3. `:name` values are bound, not pasted: one entry used twice in a statement, a value holding a
 *    quote and a semicolon arrives unchanged, an expression entry binds a number, an empty value
 *    binds empty text and reads back empty (NULL on Oracle, which stores empty text as NULL), and
 *    an expression entry giving None binds NULL and reads back null (REQ-3.1.3.21).
 * 4. Outputs: Success true; Rows holds the SELECT, the last statement that returned rows, and not
 *    the UPDATE after it, with typed cells (integer, text, exact decimal, boolean where the
 *    database has one, NULL, a timestamp); Row count 2; Rows changed 5, the sum over every
 *    statement.
 * 5. No WAVE transaction: an INSERT followed by a failing statement under Record and continue ends
 *    amber with Reason DatabaseError and the database's own text, and a later block reads the
 *    inserted row back, beside the trailing UPDATE of the script.
 * 6. A Template body names the table through a `{{ }}` variable and runs on every database; a
 *    Plain body, the default, keeps `{{ pg_table }}` as literal text.
 * 7. TLS on with Verify Server Certificate and the WAVE Test CA connects on PostgreSQL, MariaDB and
 *    SQL Server, and each session is encrypted; the client certificate reaches PostgreSQL.
 * 8. Driver options reach the driver under its own names: application_name (PostgreSQL),
 *    init_command (MariaDB), program (Oracle), appname (SQL Server) and timeout (SQLite).
 * 9. The SQLite file is created where the block runs, in this run's artifacts, and is a SQLite
 *    database.
 * 10. Every bound value reaches a downstream Log line.
 * 11. The Finally path drops every table and finds each one gone, the Try/Catch caught nothing, no
 *     console line carries the password, and the run passes.
 * 12. A SQL row in expression mode gives the SQL text: an f-string builds `SELECT id, qty FROM
 *     {pg_table} WHERE qty >= :min_qty` on the per-run table and `:min_qty` (4, an expression
 *     entry) still binds, so Rows holds ids 1 and 2 (qty 4 and 16) and not id 3 (qty 1).
 * 13. Built through the sheet: an integer variable `limit` = 10 from the Variable Manager; a SQL
 *     block dropped under Start (Run SQL, PostgreSQL, the stack's PostgreSQL, TLS on with the WAVE
 *     Test CA) whose SQL row is switched to {} and given
 *     `f"SELECT n FROM generate_series(1, {limit}) AS n WHERE n >= :min_n"`, Parameters `min_n` = 7
 *     with its {} on, Rows and Row count bound to new variables. With {} on the row is the
 *     expression editor: no SQL coloring, no Get Tables chip, no Run. The saved Test holds exactly
 *     that; the run gives Rows 7, 8, 9, 10 and Row count 4.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette } from '../../helpers/canvas'
import { checkbox, editPreview, enumTrigger, exprToggle, numberInput } from '../../helpers/config-sheet'
import { expandButton } from '../../helpers/value-field'
import { getNode, getTest, saveAndCloseSheet, valueSheet } from '../../helpers/element-types'
import { createSimpleVariable } from '../../helpers/variable-create'
import { saveBtn } from '../../helpers/workbench'
import { expandGroup, openConfig, saveConfig } from '../file-picker/picker'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  MARIADB_PORT,
  MSSQL_PORT,
  ORACLE_PORT,
  ORACLE_SERVICE_NAME,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
  ensureEnvironment,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  injectServiceHost,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  type LogEntry,
} from '../../helpers/log-reader'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    expressionFields: string[]
    templateFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

const FIXTURE_FILE = 'fixture.json'
const BOOKEND = 'sql-run-done'
const SQLITE_HEADER = 'SQLite format 3\u0000'

type DbKey = 'pg' | 'my' | 'ora' | 'ms' | 'lite'

interface Database {
  /** The prefix of every block description, as the canvas and the console show it. */
  label: string
  type: string
  /** The name the Connected line gives the database type. */
  product: string
  port?: string
  database?: string
  /** Oracle reports unquoted names in upper case; the rest keep the case written. */
  upper: boolean
  /** The script's statement that returns rows. */
  selectAt: number
  /** Rows changed per statement, the SELECT counted as none. */
  changedPer: number[]
  active: [unknown, unknown]
  activeType: string
  created: [string, string]
  /** What the empty `:note` reads back as. */
  emptyText: string | null
}

const TS = ['2026-09-23T10:11:12', '2026-01-02T03:04:05'] as [string, string]
const PRICES = [12.5, 7.25]
const PRICE_COLUMN = 3

const DATABASES: Record<DbKey, Database> = {
  pg: {
    label: 'PG',
    type: 'postgresql',
    product: 'PostgreSQL',
    port: POSTGRES_PORT,
    database: SQL_STACK_DATABASE,
    upper: false,
    selectAt: 5,
    changedPer: [0, 1, 1, 2, 0, 1],
    active: [true, false],
    activeType: 'boolean',
    created: TS,
    emptyText: '',
  },
  my: {
    label: 'MariaDB',
    type: 'mysql',
    product: 'MySQL',
    port: MARIADB_PORT,
    database: SQL_STACK_DATABASE,
    upper: false,
    selectAt: 5,
    changedPer: [0, 1, 1, 2, 0, 1],
    // MariaDB has no boolean type: BOOLEAN is TINYINT(1).
    active: [1, 0],
    activeType: 'integer',
    created: TS,
    emptyText: '',
  },
  ora: {
    label: 'Oracle',
    type: 'oracle',
    product: 'Oracle',
    port: ORACLE_PORT,
    database: ORACLE_SERVICE_NAME,
    upper: true,
    selectAt: 5,
    changedPer: [0, 1, 1, 2, 0, 1],
    active: [true, false],
    activeType: 'boolean',
    created: TS,
    // Oracle stores empty text as NULL.
    emptyText: null,
  },
  ms: {
    label: 'SQL Server',
    type: 'mssql',
    product: 'SQL Server',
    port: MSSQL_PORT,
    database: SQL_STACK_DATABASE,
    upper: false,
    selectAt: 4,
    changedPer: [0, 2, 2, 0, 1],
    active: [true, false],
    activeType: 'boolean',
    created: TS,
    emptyText: '',
  },
  lite: {
    label: 'SQLite',
    type: 'sqlite',
    product: 'SQLite',
    upper: false,
    selectAt: 5,
    changedPer: [0, 1, 1, 2, 0, 1],
    // SQLite stores a BOOLEAN as 0 / 1 and a TIMESTAMP as the text written.
    active: [1, 0],
    activeType: 'integer',
    created: ['2026-09-23 10:11:12', '2026-01-02 03:04:05'],
    emptyText: '',
  },
}
const DB_KEYS = Object.keys(DATABASES) as DbKey[]
const TLS_DATABASES: DbKey[] = ['pg', 'my', 'ms']

const createdTests: string[] = []

// --- fixture helpers -----------------------------------------------------
function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function nodeOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

function valuesOf(fixture: Fixture, description: string): Record<string, unknown> {
  return nodeOf(fixture, description).data.config.values
}

function sqlNodes(fixture: Fixture): FixtureNode[] {
  return fixture.workflow.nodes.filter((node) => node.data.elementType === 'sql-client')
}

function dbOf(node: FixtureNode): Database {
  const found = DB_KEYS.map((key) => DATABASES[key]).find((db) =>
    node.data.description.startsWith(`${db.label} `),
  )
  expect(found, `"${node.data.description}" belongs to one database`).toBeTruthy()
  return found as Database
}

/** Every SQL block dials the stack as config names it; secrets and PEMs are filled here, never stored. */
function prepareFixture(fixture: Fixture, token: string): Fixture {
  for (const node of sqlNodes(fixture)) {
    const db = dbOf(node)
    const values = node.data.config.values
    const what = `"${node.data.description}"`
    expect(node.data.label, `${what} carries its Description as its Name`).toBe(node.data.description)
    expect(values.operation, `${what} runs SQL`).toBe('run_sql')
    expect(values.database_type, `${what} names its database type`).toBe(db.type)
    if (db.type === 'sqlite') {
      expect(values.file, `${what} opens this run's own file`).toBe(`artifact://sqlrun-${token}.db`)
      continue
    }
    expect(values.host, `${what} carries the host sentinel the import rewrites`).toBe(
      SSH_FIXTURE_HOST_SENTINEL,
    )
    expect(String(values.port), `${what} dials the published port`).toBe(db.port)
    expect(values.database, `${what} names the stack database`).toBe(db.database)
    expect(values.username, `${what} logs in as the stack user`).toBe(SQL_STACK_USER)
    expect(values.password, `${what} stores no password`).toBe('')
    values.password = SQL_STACK_PASSWORD
    if (values.tls === true) {
      expect(values.verify_ssl, `${what} verifies the server certificate`).toBe(true)
      values.ca_cert = CA_CERT_PEM
    }
    if ('client_cert' in values) {
      values.client_cert = TLS_LAB_CLIENT_CERT_PEM
      values.client_key = TLS_LAB_CLIENT_KEY_PEM
    }
  }
  return injectServiceHost(fixture, SQL_TARGET_HOST) as unknown as Fixture
}

// --- reading the run back ------------------------------------------------
function boundText(variables: SessionVariables, name: string): string {
  const value = sessionValue(variables, name)
  expect(typeof value, `"${name}" holds text`).toBe('string')
  return value as string
}

function col(db: Database, name: string): string {
  return db.upper ? name.toUpperCase() : name
}

/** Measured figures and the server's version are blanked; everything else is compared exactly. */
function normalize(message: string, sqliteFile: string | null): string {
  let text = message
    .replace(/, \d+ ms$/, ', {ms} ms')
    .replace(/^Connected to (PostgreSQL|MySQL|Oracle|SQL Server|SQLite) \S+ at /, 'Connected to $1 {version} at ')
  if (sqliteFile) text = text.replace(sqliteFile, '{file}')
  return text
}

/** The console lines of the SQL block of that Name, sorted: the console harvest does not keep their order. */
function sqlLines(entries: readonly LogEntry[], name: string, sqliteFile: string | null): string[] {
  const source = blockSource('SQL', name)
  return entries
    .filter((entry) => entry.source === source)
    .map((entry) => `${entry.level} ${normalize(entry.message, sqliteFile)}`)
    .sort()
}

function expectSqlLines(
  entries: readonly LogEntry[],
  name: string,
  sqliteFile: string | null,
  expected: string[],
): void {
  expect(
    sqlLines(entries, name, sqliteFile),
    `the console lines of "${name}".\n${formatEntries(entries)}`,
  ).toEqual([...expected].sort())
}

function connectedLine(db: Database): string {
  const where = db.type === 'sqlite' ? '{file}' : `${SQL_TARGET_HOST}:${db.port}`
  return `INFO Connected to ${db.product} {version} at ${where}`
}

function statementLines(changed: number[], rowsAt: Record<number, number>): string[] {
  return changed.map((count, index) => {
    const number = index + 1
    return number in rowsAt
      ? `INFO Statement ${number}: ${rowsAt[number]} rows, {ms} ms`
      : `INFO Statement ${number}: ${count} rows changed, {ms} ms`
  })
}

/** The database's own text for the insert into the table that does not exist. */
function missingTableError(key: DbKey, token: string): RegExp {
  const name = `sqlrun_${key}_missing_${token}`
  const texts: Record<DbKey, string> = {
    pg: `^42P01: relation "${name}" does not exist$`,
    my: `^1146: Table '${SQL_STACK_DATABASE}\\.${name}' doesn't exist$`,
    ora: `^ORA-00942: table or view "${SQL_STACK_USER.toUpperCase()}"\\."${name.toUpperCase()}" does not exist`,
    ms: `^208: Invalid object name '${name}'\\.$`,
    lite: `^no such table: ${name}$`,
  }
  return new RegExp(texts[key])
}

// --- the block built through the sheet ----------------------------------
const SHEET_SQL = 'f"SELECT n FROM generate_series(1, {limit}) AS n WHERE n >= :min_n"'
const SHEET_ROWS = 'series_rows'
const SHEET_COUNT = 'series_count'

/** Type a text row's value in its Edit value sheet (the row's expand), Save it and close the sheet. */
async function fillTextRow(page: Page, dialog: Locator, name: string, text: string): Promise<void> {
  await expandButton(dialog, name).click()
  const sheet = valueSheet(page)
  await expect(sheet).toBeVisible()
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // insertText, not type: auto-closing brackets and quotes leave it alone.
  await page.keyboard.insertText(text)
  await saveAndCloseSheet(page)
}

/** The block the canvas drop made: the only workflow node on it. */
async function droppedNodeId(page: Page): Promise<string> {
  const nodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
  await expect(nodes).toHaveCount(1)
  return ((await nodes.getAttribute('data-testid')) ?? '').replace('workflow-node-', '')
}

// --- suite ---------------------------------------------------------------
test.describe('V-PLUGIN-SQL-RUN-FUNCTIONAL: Run SQL on the five databases', () => {
  test.afterAll(async ({ request }) => {
    // Clearing the session also removes its artifacts, the SQLite file among them.
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('scripts, bound values, typed rows, no transaction, Template, TLS and driver options', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const token = newToken()
    const fixture = prepareFixture(withToken(loadFixture(), token), token)
    const idOf = (description: string): string => nodeOf(fixture, description).id
    const scriptParameters = valuesOf(fixture, 'PG script').parameters as Record<string, string>
    const label = scriptParameters.label
    expect(label, 'the bound text holds a quote and a semicolon').toMatch(/'.*;/)
    expect(scriptParameters.note, 'an empty value binds empty text').toBe('')
    expect(scriptParameters.memo, 'None, an expression, binds NULL').toBe('None')
    for (const key of DB_KEYS) {
      const script = nodeOf(fixture, `${DATABASES[key].label} script`)
      expect(script.data.config.values.parameters, `${key}: one Parameters list for all five`).toEqual(
        scriptParameters,
      )
      expect(script.data.expressionFields, `${key}: qty and memo bind as expressions`).toEqual([
        'parameters.qty',
        'parameters.memo',
      ])
      expect(script.data.templateFields, `${key}: the script is Plain, the default`).toEqual([])
      expect(
        nodeOf(fixture, `${DATABASES[key].label} read back`).data.templateFields,
        `${key}: the read-back opts into Template`,
      ).toEqual(['sql'])
    }

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)
    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 240_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    const sqliteConnected = entries.find(
      (entry) =>
        entry.source === blockSource('SQL', 'SQLite script') &&
        entry.message.startsWith('Connected to SQLite '),
    )
    expect(sqliteConnected, `the SQLite script connects.\n${formatEntries(entries)}`).toBeTruthy()
    const sqliteFile = (sqliteConnected as LogEntry).message.replace(/^Connected to SQLite \S+ at /, '')
    expect(sqliteFile, 'SQLite opens the per-run file by its absolute path on WAVE').toMatch(
      new RegExp(`^/.+/sqlrun-${token}\\.db$`),
    )

    await test.step('every block ends in the state its case calls for', async () => {
      for (const key of DB_KEYS) {
        const name = DATABASES[key].label
        for (const suffix of ['script', 'read back', 'session', 'proof', 'drop']) {
          await expectNodeStatus(page, idOf(`${name} ${suffix}`), 'success')
        }
        await expectNodeStatus(page, idOf(`${name} no transaction`), 'warning')
      }
      await expectNodeStatus(page, idOf('PG expression'), 'success')
      await expectNodeStatus(page, idOf('Cleanup proof'), 'success')
      await expectNodeStatus(page, idOf('Done'), 'success')
    })

    for (const key of DB_KEYS) {
      const db = DATABASES[key]
      const name = db.label
      await test.step(`${name}: the script splits its own way and returns typed rows (SQL-2, SQL-3, SQL-9)`, () => {
        const rowCount = 2
        expectSqlLines(entries, `${name} script`, sqliteFile, [
          connectedLine(db),
          ...statementLines(db.changedPer, { [db.selectAt]: rowCount }),
        ])
        expect(sessionValue(variables, `${key}_ok`), `${name}: Success`).toBe(true)
        expect(sessionValue(variables, `${key}_count`), `${name}: Row count`).toBe(rowCount)
        expect(
          sessionValue(variables, `${key}_changed`),
          `${name}: Rows changed is the sum over every statement`,
        ).toBe(db.changedPer.reduce((sum, count) => sum + count, 0))
        const table = sessionTable(variables, `${key}_rows`)
        expect(table.columns, `${name}: the column types follow the database`).toEqual([
          { name: col(db, 'id'), type: 'integer' },
          { name: col(db, 'name'), type: 'string' },
          { name: col(db, 'qty'), type: 'integer' },
          { name: col(db, 'price'), type: 'float' },
          { name: col(db, 'active'), type: db.activeType },
          { name: col(db, 'note'), type: 'string' },
          { name: col(db, 'created'), type: 'string' },
          { name: col(db, 'memo'), type: 'string' },
        ])
        for (const row of table.rows) {
          expect(
            String(row[PRICE_COLUMN]),
            `${name}: a decimal crosses as exact text, never a binary float`,
          ).toMatch(/^\d+\.\d+$/)
        }
        expect(
          table.rows.map((row) =>
            row.map((cell, index) => (index === PRICE_COLUMN ? Number(cell) : cell)),
          ),
          `${name}: Rows holds the SELECT (qty before the trailing UPDATE), :label twice, empty text for the empty :note, NULL for :memo given None`,
        ).toEqual([
          [1, label, 4, PRICES[0], db.active[0], label, db.created[0], 'given'],
          [2, 'plain; with semicolon', 6, PRICES[1], db.active[1], db.emptyText, db.created[1], null],
        ])
      })

      await test.step(`${name}: no WAVE transaction keeps the insert before the failing statement (SQL-3)`, () => {
        const error = boundText(variables, `${key}_notx_error`)
        expect(error, `${name}: the database's own text naming the missing table`).toMatch(
          missingTableError(key, token),
        )
        expect(sessionValue(variables, `${key}_notx_ok`), `${name}: Success under Record`).toBe(false)
        expect(boundText(variables, `${key}_notx_reason`)).toBe('DatabaseError')
        const missing = `sqlrun_${key}_missing_${token}`
        expectSqlLines(entries, `${name} no transaction`, sqliteFile, [
          connectedLine(db),
          'INFO Statement 1: 1 rows changed, {ms} ms',
          `ERROR Statement 2 (INSERT INTO ${missing} (id) VALUES (4)) failed: ${error}`,
          `WARN Run SQL failed (DatabaseError): ${error}`,
        ])
        const back = sessionTable(variables, `${key}_back_rows`)
        expect(back.columns, `${name}: the read-back columns`).toEqual([
          { name: col(db, 'id'), type: 'integer' },
          { name: col(db, 'name'), type: 'string' },
          { name: col(db, 'qty'), type: 'integer' },
        ])
        expect(
          back.rows,
          `${name}: the trailing UPDATE ran and the insert before the failure stayed`,
        ).toEqual([
          [2, 'plain; with semicolon', 16],
          [3, 'kept without a transaction', 1],
        ])
        expectSqlLines(entries, `${name} read back`, sqliteFile, [
          connectedLine(db),
          'INFO Statement 1: 2 rows, {ms} ms',
        ])
      })
    }

    await test.step('PG: an expression SQL row gives the SQL text and :min_qty still binds (SQL-10)', () => {
      const block = nodeOf(fixture, 'PG expression')
      expect(block.data.expressionFields, 'the SQL row and min_qty are expressions').toEqual([
        'sql',
        'parameters.min_qty',
      ])
      expect(block.data.config.values.sql).toBe(
        'f"SELECT id, qty FROM {pg_table} WHERE qty >= :min_qty ORDER BY id"',
      )
      expect(block.data.config.values.parameters).toEqual({ min_qty: '4' })
      expect(
        sessionTable(variables, 'pg_expr_rows'),
        'ids 1 and 2 (qty 4 and 16), not id 3 (qty 1): the per-run table, filtered by the bound 4',
      ).toEqual({
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'qty', type: 'integer' },
        ],
        rows: [
          [1, 4],
          [2, 16],
        ],
      })
      expectSqlLines(entries, 'PG expression', sqliteFile, [
        connectedLine(DATABASES.pg),
        'INFO Statement 1: 2 rows, {ms} ms',
      ])
    })

    await test.step('TLS with a verified certificate encrypts the session; the client certificate reaches PostgreSQL (SQL-8)', () => {
      for (const key of TLS_DATABASES) {
        const node = valuesOf(fixture, `${DATABASES[key].label} session`)
        expect(node.tls, `${key}: TLS on`).toBe(true)
        expect(node.ca_cert, `${key}: trusts the WAVE Test CA`).toBe(CA_CERT_PEM)
        expect(sessionValue(variables, `${key}_session_ok`), `${key}: the verified session connects`).toBe(
          true,
        )
      }
      const pg = sessionTable(variables, 'pg_session_rows')
      expect(pg.columns).toEqual([
        { name: 'ssl', type: 'boolean' },
        { name: 'version', type: 'string' },
        { name: 'client_dn', type: 'string' },
        { name: 'app', type: 'string' },
        { name: 'plain_text', type: 'string' },
      ])
      expect(pg.rows, 'one row for this session').toHaveLength(1)
      const [ssl, version, clientDn] = pg.rows[0]
      expect(ssl, 'pg_stat_ssl says this session is encrypted').toBe(true)
      expect(version).toMatch(/^TLSv1\.[23]$/)
      expect(String(clientDn), 'PostgreSQL saw the tls-lab client certificate').toContain(
        'CN=wave-e2e-client',
      )

      const my = sessionTable(variables, 'my_session_rows')
      expect(my.columns).toEqual([
        { name: 'probe', type: 'string' },
        { name: 'tls_version', type: 'string' },
      ])
      expect(my.rows[0][1], 'MariaDB reports the session TLS version').toMatch(/^TLSv1\.[23]$/)

      const ms = sessionTable(variables, 'ms_session_rows')
      expect(ms.columns).toEqual([
        { name: 'encrypt_option', type: 'string' },
        { name: 'app', type: 'string' },
      ])
      expect(ms.rows[0][0], 'SQL Server says this connection is encrypted').toBe('TRUE')
    })

    await test.step('Driver options reach each driver under its own name; Plain keeps {{ }} literal (SQL-8, SQL-10)', () => {
      const app = `sqlrun-${token}`
      expect(sessionTable(variables, 'pg_session_rows').rows[0][3], 'application_name').toBe(app)
      expect(sessionTable(variables, 'pg_session_rows').rows[0][4], 'a Plain body is sent as written').toBe(
        '{{ pg_table }}',
      )
      expect(sessionTable(variables, 'my_session_rows').rows[0][0], 'init_command ran').toBe(app)
      expect(sessionTable(variables, 'ms_session_rows').rows[0][1], 'appname').toBe(app)
      const ora = sessionTable(variables, 'ora_session_rows')
      expect(ora.columns).toEqual([{ name: 'PROGRAM', type: 'string' }])
      expect(ora.rows, 'program').toEqual([[app]])
      expect(sessionValue(variables, 'ora_session_ok')).toBe(true)
      const lite = sessionTable(variables, 'lite_session_rows')
      expect(lite.columns).toEqual([{ name: 'timeout', type: 'integer' }])
      expect(lite.rows, 'the timeout option, in seconds, becomes the busy timeout in milliseconds').toEqual([
        [7000],
      ])
      expect(sessionValue(variables, 'lite_session_ok')).toBe(true)
      for (const key of DB_KEYS) {
        expectSqlLines(entries, `${DATABASES[key].label} session`, sqliteFile, [
          connectedLine(DATABASES[key]),
          'INFO Statement 1: 1 rows, {ms} ms',
        ])
      }
    })

    await test.step('SQLite created its file in this run\'s artifacts, where the block runs', async () => {
      const listing = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(listing.ok(), `GET session artifacts failed: ${listing.status()}`).toBeTruthy()
      const items = ((await listing.json()) as { items: Array<{ path: string; size_bytes: number }> })
        .items
      const file = items.find((item) => item.path === `sqlrun-${token}.db`)
      expect(file, `the artifacts list the file. Listed: ${JSON.stringify(items)}`).toBeTruthy()
      expect(file?.size_bytes ?? 0).toBeGreaterThan(0)
      const content = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/sqlrun-${token}.db`,
      )
      expect(content.ok(), `GET the SQLite file failed: ${content.status()}`).toBeTruthy()
      const head = (await content.body()).subarray(0, SQLITE_HEADER.length).toString('latin1')
      expect(head, 'the file is a SQLite database').toBe(SQLITE_HEADER)
    })

    await test.step('bound values reach a downstream Log for every database', () => {
      const pg = sessionTable(variables, 'pg_session_rows').rows[0]
      const my = sessionTable(variables, 'my_session_rows').rows[0]
      const app = `sqlrun-${token}`
      const common = (key: DbKey): string => {
        const db = DATABASES[key]
        const active = typeof db.active[0] === 'boolean' ? 'True' : String(db.active[0])
        const price = sessionTable(variables, `${key}_rows`).rows[0][PRICE_COLUMN]
        // An f-string writes Python's own None for a null cell.
        const note = db.emptyText ?? 'None'
        return (
          `sql-${key} ok=True count=2 changed=5 name=${label} price=${String(price)} ` +
          `active=${active} note2=${note} memo2=None notx=False/DatabaseError ` +
          'back=16/kept without a transaction session=True'
        )
      }
      expectConsoleLine(entries, 'INFO', `${common('pg')} app=${app} version=${pg[1]}`)
      expectConsoleLine(entries, 'INFO', `${common('my')} probe=${app} tls_version=${my[1]}`)
      expectConsoleLine(entries, 'INFO', `${common('ora')} PROGRAM=${app}`)
      expectConsoleLine(entries, 'INFO', `${common('ms')} app=${app} encrypt_option=TRUE`)
      expectConsoleLine(entries, 'INFO', `${common('lite')} timeout=7000`)
    })

    await test.step('the Finally path drops every table and finds it gone; nothing leaks', () => {
      for (const key of DB_KEYS) {
        const db = DATABASES[key]
        expect(sessionValue(variables, `${key}_drop_ok`), `${db.label}: the drop succeeded`).toBe(true)
        expect(sessionTable(variables, `${key}_gone`), `${db.label}: the table is gone`).toEqual({
          columns: [{ name: col(db, 'n'), type: 'integer' }],
          rows: [[0]],
        })
        expectSqlLines(entries, `${db.label} drop`, sqliteFile, [
          connectedLine(db),
          'INFO Statement 1: 0 rows changed, {ms} ms',
          'INFO Statement 2: 1 rows, {ms} ms',
        ])
      }
      expectConsoleLine(
        entries,
        'INFO',
        `sql-run-cleanup ${DB_KEYS.map((key) => `${key}=True/0`).join(' ')}`,
      )
      expect(sessionValue(variables, 'sqlrun_caught'), 'no block in the Try path failed').toBe(false)
      expectConsoleLine(entries, 'INFO', `${BOOKEND} caught=False`)
      const leaked = entries.filter((entry) => entry.message.includes(SQL_STACK_PASSWORD))
      expect(leaked, 'no console line carries the password').toEqual([])
    })
  })

  test('the SQL row as an expression, built through the sheet: the expression gives the SQL, :min_n still binds', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `V-PLUGIN-SQL-RUN-FUNCTIONAL sheet ${newToken()}`,
      nodes: [],
      edges: [],
    })
    createdTests.push(testId)
    await openTest(page, testId)

    await test.step('an integer variable limit = 10 from the Variable Manager', async () => {
      await createSimpleVariable(page, 'limit', { type: 'integer', value: '10' })
    })

    let nodeId = ''
    await test.step('a SQL block dropped under Start is linked from it', async () => {
      // The palette shares the row with the canvas: open it before measuring.
      await expandPalette(page)
      const [canvasBox, startBox] = await Promise.all([
        page.getByTestId('workflow-canvas').boundingBox(),
        page.getByTestId('start-node').boundingBox(),
      ])
      expect(canvasBox && startBox, 'the canvas and Start are laid out').toBeTruthy()
      await dragPaletteItemToCanvas(page, 'sql', {
        x: startBox!.x - canvasBox!.x + startBox!.width / 2,
        y: startBox!.y - canvasBox!.y + startBox!.height + 60,
      })
      nodeId = await droppedNodeId(page)
      await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    })

    const dialog = await openConfig(page, nodeId)
    await test.step('the connection rows: the stack PostgreSQL, TLS on with the WAVE Test CA', async () => {
      await expect(dialog.getByRole('heading', { name: 'SQL - Edit Config' })).toBeVisible()
      await expect(enumTrigger(dialog, 'operation')).toHaveText('Run SQL')
      await expect(enumTrigger(dialog, 'database_type')).toHaveText('PostgreSQL')
      await fillTextRow(page, dialog, 'host', SQL_TARGET_HOST)
      // Typed key by key: the first key replaces the gray default (FIELD-2).
      await numberInput(dialog, 'port').click()
      await numberInput(dialog, 'port').press('ControlOrMeta+a')
      await numberInput(dialog, 'port').pressSequentially(String(POSTGRES_PORT))
      await expect(numberInput(dialog, 'port')).toHaveValue(String(POSTGRES_PORT))
      await fillTextRow(page, dialog, 'database', SQL_STACK_DATABASE)
      await fillTextRow(page, dialog, 'username', SQL_STACK_USER)
      await fillTextRow(page, dialog, 'password', SQL_STACK_PASSWORD)
      await expandGroup(dialog, 'TLS / Certificates')
      await checkbox(dialog, 'tls').click()
      await expect(checkbox(dialog, 'tls')).toHaveAttribute('data-state', 'checked')
      await expect(checkbox(dialog, 'verify_ssl')).toHaveAttribute('data-state', 'checked')
      await fillTextRow(page, dialog, 'ca_cert', CA_CERT_PEM)
    })

    await test.step('{} on the SQL row: the expression editor, no SQL coloring, no Get Tables, no Run (SQL-10)', async () => {
      const toggle = exprToggle(dialog, 'sql')
      await toggle.click()
      await expect(toggle).toHaveAttribute('data-state', 'on')
      await expect(editPreview(dialog, 'sql'), 'no SQL editor preview in expression mode').toHaveCount(0)
      const inline = dialog.locator('[data-testid="param-input-sql"]')
      await inline.locator('.cm-content').click()
      await page.keyboard.insertText(SHEET_SQL)
      await page.keyboard.press('Escape')
      await expect(dialog, 'Escape left the inline editor, not the sheet').toBeVisible()
      await expect(inline.locator('.cm-content')).toHaveText(SHEET_SQL)
      await expect(inline.locator('.cm-sql-placeholder')).toHaveCount(0)

      await inline.locator('.cm-content').click()
      await page.keyboard.press('Control+e')
      const modal = page.getByTestId('expression-editor-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('h2').first()).toHaveText('Edit SQL')
      await expect(modal.locator('.cm-content')).toHaveText(SHEET_SQL)
      await expect(modal.locator('.cm-sql-placeholder'), 'no SQL coloring').toHaveCount(0)
      await expect(modal.getByTestId('get-tables-chip'), 'no Get Tables chip').toHaveCount(0)
      await expect(modal.getByRole('button', { name: /^Run/ }), 'no Run').toHaveCount(0)
      await expect(valueSheet(page), 'no SQL editor opens').toHaveCount(0)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(modal).toBeHidden()
    })

    await test.step('Parameters min_n = 7 with its {} on; Rows and Row count bound to new variables', async () => {
      await expandButton(dialog, 'parameters').click()
      const map = valueSheet(page)
      await expect(map).toBeVisible()
      await map.getByTestId('map-add-entry').click()
      await map.getByTestId('map-edit-key-0').fill('min_n')
      await map.getByTestId('map-expr-toggle-0').click()
      await map.locator('[data-testid="map-expr-value-0"] .cm-content').click()
      await page.keyboard.type('7')
      await leaveExpressionEditor(map)
      await saveAndCloseSheet(page)

      for (const [label, name] of [
        ['Rows', SHEET_ROWS],
        ['Row count', SHEET_COUNT],
      ]) {
        const assign = dialog.getByRole('combobox', { name: `Assign ${label} to`, exact: true })
        const hint = page.getByTestId('output-new-var-hint').filter({ hasText: `“${name}”` })
        await assign.fill(name)
        await expect(hint, `${name} is a new variable`).toHaveText(`“${name}” will be created as a new variable`)
        await assign.press('Escape')
        await expect(hint, 'Escape closes the suggestion list').toHaveCount(0)
        await expect(dialog).toBeVisible()
      }
      await saveConfig(dialog)
    })

    await test.step('the saved Test holds the block as built', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      const node = await getNode(request, testId, nodeId)
      expect([...(node.data.expressionFields as string[])].sort()).toEqual(['parameters.min_n', 'sql'])
      expect(node.data.config.values).toMatchObject({
        host: SQL_TARGET_HOST,
        database: SQL_STACK_DATABASE,
        username: SQL_STACK_USER,
        tls: true,
        sql: SHEET_SQL,
        parameters: { min_n: '7' },
      })
      expect(Number(node.data.config.values.port)).toBe(Number(POSTGRES_PORT))
      expect(node.data.config.outputBindings).toMatchObject({ rows: SHEET_ROWS, row_count: SHEET_COUNT })
      const stored = await getTest(request, testId)
      expect(
        (stored.workflow.edges as Array<{ source: string; target: string }>).map((edge) => [edge.source, edge.target]),
      ).toEqual([['start-node', nodeId]])
      expect(stored.variables.limit?.type, JSON.stringify(stored.variables)).toBe('integer')
      expect(Number(stored.variables.limit?.value)).toBe(10)
    })

    await test.step('the run: Rows 7, 8, 9, 10 and Row count 4', async () => {
      const status = await startRun(page)
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      expect(await status.getAttribute('data-status'), formatEntries(entries)).toBe('passed')
      const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
      expect(sessionTable(variables, SHEET_ROWS)).toEqual({
        columns: [{ name: 'n', type: 'integer' }],
        rows: [[7], [8], [9], [10]],
      })
      expect(sessionValue(variables, SHEET_COUNT)).toBe(4)
      expect(
        entries
          .filter((entry) => entry.message.startsWith('Statement '))
          .map((entry) => `${entry.level} ${normalize(entry.message, null)}`),
        formatEntries(entries),
      ).toEqual(['INFO Statement 1: 4 rows, {ms} ms'])
    })
  })
})
