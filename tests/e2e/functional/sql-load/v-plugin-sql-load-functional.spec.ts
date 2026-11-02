/**
 * V-PLUGIN-SQL-LOAD-FUNCTIONAL: Load table against the real databases
 * Design Decisions: SQL-3, SQL-5, SQL-7, SQL-8, SQL-9
 * REQ: REQ-3.4.1.6, REQ-3.4.1.19
 *
 * One workflow chains every Load table permutation inside a Try/Finally whose Finally path drops
 * every table the run made. Each table name carries a per-run token, so parallel runs never
 * meet. The rows come from table variables the way an author makes them - a Run SQL's Rows and a
 * CSV Parser's Table - and from a CSV file in the test's own Test Data. Later SQL Blocks read
 * the rows back from the database.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests, the CSV lands in the test's Test Data, the test
 *    validates with zero errors and the run passes.
 * 2. The source variables are typed tables: the Run SQL rows keep integer, text and boolean
 *    columns, the CSV Parser rows are text.
 * 3. Add inserts every row: Rows changed 3, one batch line, the total line, and the INSERT printed
 *    once at DEBUG in PostgreSQL's $n form.
 * 4. Add or replace with Key columns empty matches the primary key: the existing row is updated,
 *    the new one inserted, and the ON CONFLICT statement names the primary key.
 * 5. Add is insert-only and one transaction: a clash in its last row fails the block under Fail
 *    with `Row 3: 23505: ...`, the Try/Catch catches that message, the rows before it did not
 *    land, and the console says the transaction rolled back with 0 rows into the table.
 * 6. A Table column the target lacks fails at once with `Column 'color' is not in {table}`,
 *    Reason Validation, and nothing is sent.
 * 7. Overwrite from the Test Data CSV leaves only the file's rows (an empty cell is NULL, text
 *    converts to integer and boolean), and the table keeps its comment and both indexes: it was
 *    emptied, not dropped.
 * 8. Commit each batch off: a bad row in batch 3 of 4 leaves the table as it was - the Overwrite's
 *    DELETE rolls back with the rows - Rows changed 0, and the error names the row. The console
 *    says the transaction rolled back with 0 rows into the table, and no line claims rows landed.
 * 9. Commit each batch on with Stop on error on: the two batches before the bad row stay
 *    committed, Rows changed is the 4 rows committed, and the block records the row's error.
 * 10. Commit each batch on with Stop on error off: the failing batch is skipped with a WARN line,
 *     the batch after it lands, Rows changed 5, and the block passes.
 * 11. Commit each batch on with a batch whose COMMIT the database refuses (a deferred unique
 *     constraint): the batch before it stays, Rows changed 2, the block records the database's
 *     error, and no console line claims the rolled-back batch.
 * 12. Add or replace on a table with no primary key and Key columns empty fails with
 *     `Key columns are required: {table} has no primary key`; with Key columns `code` it upserts.
 * 13. Add or replace on MariaDB, Oracle, SQL Server and SQLite with each dialect's own upsert
 *     statement: MariaDB also matches its unique key, the others match the primary key only, and
 *     booleans land as 1 and 0 on Oracle and SQL Server.
 * 14. On SQLite a load is one transaction: an Add whose last row clashes with a row of the table,
 *     and an Overwrite whose last row repeats a key of its own load, each record
 *     `Row 3: UNIQUE constraint failed: {table}.id` with Reason DatabaseError and Rows changed 0,
 *     say the transaction rolled back with 0 rows into the table, and leave the rows from before.
 * 15. On SQLite a load waits for another writer: one Parallel branch holds a write inside its own
 *     BEGIN IMMEDIATE ... COMMIT while the other loads into the same file with Connect timeout 30;
 *     the load passes with its rows and both branches' rows are in the file.
 * 16. Every bound value reaches a downstream Log, the recorded Blocks paint the warning state, the
 *     failed Block paints failed, and the Finally path leaves no table behind on any database.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  MARIADB_PORT,
  MSSQL_PORT,
  ORACLE_PORT,
  POSTGRES_PORT,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
  type WaveTable,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import { withSqlStack } from '../../helpers/sql-stack'
import { uploadTestData } from '../../helpers/testdata'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: { label: string; elementType: string; description: string }
}

interface Fixture extends Record<string, unknown> {
  workflow: { nodes: FixtureNode[] }
}

type Line = string | RegExp

const FIXTURE_FILE = 'fixture.json'
const CSV_FILE = 'sql-load-overwrite.csv'
const BOOKEND = 'sql-load-done'
const LABEL = 'SQL'

/** The Name of each Load table Block the spec reads by its console lines (EXEC-25). */
const BLOCK = {
  add: 'Load add',
  upsertPk: 'Add or replace by primary key',
  clash: 'Load add clash fail',
  missing: 'Load missing column recorded',
  csv: 'Load overwrite from Test Data',
  oneTx: 'Overwrite one transaction',
  stop: 'Batches stop on error',
  skip: 'Load batches skip failed batch',
  commitRefused: 'Batches refused commit',
  noKey: 'Add or replace without a key',
  byKey: 'Add or replace by key columns',
  mysql: 'MariaDB add or replace',
  oracle: 'Oracle add or replace',
  mssql: 'SQL Server add or replace',
  sqlite: 'SQLite add or replace',
  sqliteClash: 'SQLite add clash',
  sqliteOverwrite: 'SQLite overwrite clash',
  sqliteHold: 'SQLite hold a write',
  sqliteWait: 'SQLite load while held',
} as const

const RECORDED = [
  BLOCK.missing,
  BLOCK.oneTx,
  BLOCK.stop,
  BLOCK.commitRefused,
  BLOCK.noKey,
  BLOCK.sqliteClash,
  BLOCK.sqliteOverwrite,
]

const createdTests: string[] = []

function loadFixture(token: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
  return withSqlStack(withToken(raw, token))
}


/** The rows of a read-back table, after checking its column names. */
function readBack(variables: SessionVariables, name: string, columns: string[]): unknown[][] {
  const table = sessionTable(variables, name)
  expect(
    table.columns.map((column) => column.name),
    `"${name}" reads back the columns it selected`,
  ).toEqual(columns)
  return table.rows
}

/** The SQL Block of that Name: its INFO, WARN and ERROR lines, in the order the harvest gives them. */
function blockLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource(LABEL, name)
  return entries
    .filter((entry) => entry.source === source && entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message}`)
}

/** The statement a Load table Block printed at DEBUG, once, in the database's placeholder form. */
function debugStatements(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource(LABEL, name)
  return entries
    .filter(
      (entry) =>
        entry.source === source &&
        entry.level === 'DEBUG' &&
        /^(INSERT|MERGE) INTO /.test(entry.message),
    )
    .map((entry) => entry.message)
}

/** The Block wrote exactly these lines, in any order: the harvest does not keep console order. */
function expectLines(entries: readonly LogEntry[], name: string, expected: Line[]): void {
  const left = blockLines(entries, name)
  const report = `the console lines of "${name}".\nGot:\n${left.join('\n')}\n\nConsole:\n${formatEntries(entries)}`
  for (const line of expected) {
    const index = left.findIndex((candidate) =>
      typeof line === 'string' ? candidate === line : line.test(candidate),
    )
    expect(index, `missing ${String(line)} in ${report}`).toBeGreaterThanOrEqual(0)
    left.splice(index, 1)
  }
  expect(left, `unexpected lines in ${report}`).toEqual([])
}

function connected(name: string, port: string): RegExp {
  return new RegExp(`^INFO Connected to ${name} \\S+ at ${escapeRegExp(SQL_TARGET_HOST)}:${port}$`)
}

function loaded(rows: number, table: string): RegExp {
  return new RegExp(`^INFO ${rows} rows into ${escapeRegExp(table)}, \\d+\\.\\d s$`)
}

/** The line a one-transaction load writes when it rolls back: nothing landed (SQL-7). */
function rolledBack(table: string): string {
  return `INFO Transaction rolled back: 0 rows into ${table}`
}

/** Lines that claim rows landed: a total above 0. */
function landedLines(entries: readonly LogEntry[], name: string): string[] {
  return blockLines(entries, name).filter((line) => /^INFO [1-9]\d* rows into /.test(line))
}

function notNull(table: string, row: number): string {
  return `Row ${row}: 23502: null value in column "name" of relation "${table}" violates not-null constraint`
}

test.describe('V-PLUGIN-SQL-LOAD-FUNCTIONAL: Load table on the real databases', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('Add, Add or replace and Overwrite from table variables and Test Data, batches and refusals', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const token = newToken()
    const main = `wave_ld_main_${token}`
    const stop = `wave_ld_stop_${token}`
    const skip = `wave_ld_skip_${token}`
    const defer = `wave_ld_defer_${token}`
    const keyed = `wave_ld_key_${token}`
    const up = `wave_ld_up_${token}`
    const tx = `wave_ld_tx_${token}`
    const par = `wave_ld_par_${token}`
    const fixture = loadFixture(token)
    const idOf = (name: string): string => {
      const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
      expect(found, `the fixture must declare one block named "${name}"`).toHaveLength(1)
      return found[0].id
    }
    const idByDescription = (description: string): string => {
      const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
      expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
      return found[0].id
    }
    const csv = fs.readFileSync(path.resolve(__dirname, CSV_FILE))

    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)

    expect(
      await uploadTestData(page.request, testId, '', CSV_FILE, csv),
      "the CSV lands at the root of the test's own Test Data",
    ).toEqual({ path: CSV_FILE, size_bytes: csv.length, replaced: false })

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 240_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const pgConnected = connected('PostgreSQL', POSTGRES_PORT)
    const sqliteConnected = new RegExp(`^INFO Connected to SQLite \\S+ at .*wave-ld-${token}\\.db$`)

    await test.step('every Block ends in the state its permutation calls for', async () => {
      const recorded = RECORDED.map(idOf)
      const failed = idOf(BLOCK.clash)
      const stateOf = (id: string): string => {
        if (recorded.includes(id)) return 'warning'
        return id === failed ? 'failed' : 'success'
      }
      for (const node of fixture.workflow.nodes) {
        if (node.data.elementType !== 'try-catch-finally') {
          await expectNodeStatus(page, node.id, stateOf(node.id))
        }
      }
    })

    await test.step('the rows come from typed table variables (SQL-9)', () => {
      expect(sessionTable(variables, 'ld_seed')).toEqual({
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
          { name: 'qty', type: 'integer' },
          { name: 'active', type: 'boolean' },
        ],
        rows: [
          [1, 'alpha', 10, true],
          [2, 'beta', 20, false],
          [3, 'gamma', 30, true],
        ],
      })
      expect(sessionTable(variables, 'ld_keyed'), 'the CSV Parser Table').toEqual({
        columns: [
          { name: 'code', type: 'string' },
          { name: 'name', type: 'string' },
        ],
        rows: [
          ['k1', 'new-k1'],
          ['k2', 'new-k2'],
        ],
      })
      const generated = sessionTable(variables, 'ld_gen')
      expect(generated.rows.map((row) => row[0]), 'seven generated rows').toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(generated.rows[5], 'row 6 carries the NULL the target refuses').toEqual([6, null])
    })

    await test.step('Add inserts every row (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_add_ok')).toBe(true)
      expect(sessionValue(variables, 'ld_add_changed'), 'Rows changed = rows committed').toBe(3)
      expectLines(entries, BLOCK.add, [pgConnected, 'INFO batch 1/1: 3 rows', loaded(3, main)])
      expect(debugStatements(entries, BLOCK.add), 'the statement is printed once').toEqual([
        `INSERT INTO ${main} ("id", "name", "qty", "active") VALUES ($1, $2, $3, $4)`,
      ])
    })

    await test.step('Add or replace with Key columns empty matches the primary key (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_upk_ok')).toBe(true)
      expect(sessionValue(variables, 'ld_upk_changed')).toBe(2)
      expect(
        readBack(variables, 'ld_main_upserted', ['id', 'name', 'qty', 'active']),
        'row 2 replaced, row 4 added, rows 1 and 3 untouched',
      ).toEqual([
        [1, 'alpha', 10, true],
        [2, 'beta-2', 22, true],
        [3, 'gamma', 30, true],
        [4, 'delta', 40, false],
      ])
      expectLines(entries, BLOCK.upsertPk, [pgConnected, 'INFO batch 1/1: 2 rows', loaded(2, main)])
      expect(debugStatements(entries, BLOCK.upsertPk)).toEqual([
        `INSERT INTO ${main} ("id", "name", "qty", "active") VALUES ($1, $2, $3, $4) ` +
          'ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "qty" = EXCLUDED."qty", ' +
          '"active" = EXCLUDED."active"',
      ])
    })

    const clashMessage = `Row 3: 23505: duplicate key value violates unique constraint "${main}_pkey"`

    await test.step('Add is insert-only and one transaction: a clash fails the block (SQL-5, SQL-7)', () => {
      expect(sessionValue(variables, 'ld_clash_caught'), 'the Try/Catch caught the failure').toBe(true)
      const error = sessionValue(variables, 'ld_clash_error') as Record<string, unknown>
      expect(error.message, "the error names the row and carries the database's text").toBe(
        clashMessage,
      )
      expect(error.node_id, 'the error points at the Load Block').toBe(idOf(BLOCK.clash))
      expectConsoleLine(entries, 'ERROR', `Block '${BLOCK.clash}' failed: ${clashMessage}`)
      expectConsoleLine(entries, 'INFO', `ld-clash-caught ${clashMessage}`)
      expectLines(entries, BLOCK.clash, [pgConnected, rolledBack(main)])
      expect(
        readBack(variables, 'ld_main_after_refusals', ['id', 'name']),
        'rows 5 and 6, sent before the clash, did not land',
      ).toEqual([
        [1, 'alpha'],
        [2, 'beta-2'],
        [3, 'gamma'],
        [4, 'delta'],
      ])
    })

    const missingMessage = `Column 'color' is not in ${main}`

    await test.step('A Table column the target lacks fails by name before any row (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_miss_ok')).toBe(false)
      expect(sessionValue(variables, 'ld_miss_error')).toBe(missingMessage)
      expect(sessionValue(variables, 'ld_miss_reason')).toBe('Validation')
      expect(sessionValue(variables, 'ld_miss_changed')).toBe(0)
      expectLines(entries, BLOCK.missing, [
        pgConnected,
        `WARN Load table failed (Validation): ${missingMessage}`,
      ])
      expect(debugStatements(entries, BLOCK.missing), 'no statement was built').toEqual([])
    })

    await test.step('Overwrite from a Test Data CSV empties the table, never drops it (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_csv_ok')).toBe(true)
      expect(sessionValue(variables, 'ld_csv_changed')).toBe(2)
      expect(
        readBack(variables, 'ld_main_overwritten', ['id', 'name', 'qty', 'active']),
        "only the file's rows are left; the empty cell is NULL",
      ).toEqual([
        [10, 'csv-ten', 100, true],
        [11, 'csv-eleven', null, false],
      ])
      expect(
        readBack(variables, 'ld_main_kept', ['note', 'indexes']),
        'the comment and both indexes survive, so the table was never dropped',
      ).toEqual([['wave-keep', 2]])
      expectLines(entries, BLOCK.csv, [pgConnected, 'INFO batch 1/1: 2 rows', loaded(2, main)])
    })

    const oneTxMessage = notNull(main, 6)

    await test.step('Commit each batch off: a bad row leaves the table as it was (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_one_ok')).toBe(false)
      expect(sessionValue(variables, 'ld_one_changed'), 'nothing was committed').toBe(0)
      expect(sessionValue(variables, 'ld_one_error')).toBe(oneTxMessage)
      expect(sessionValue(variables, 'ld_one_reason')).toBe('DatabaseError')
      expect(
        readBack(variables, 'ld_main_after_one_tx', ['id', 'name']),
        "the Overwrite's DELETE rolled back with the batches",
      ).toEqual([
        [10, 'csv-ten'],
        [11, 'csv-eleven'],
      ])
      expectLines(entries, BLOCK.oneTx, [
        pgConnected,
        'INFO batch 1/4: 2 rows',
        'INFO batch 2/4: 2 rows',
        rolledBack(main),
        `WARN Load table failed (DatabaseError): ${oneTxMessage}`,
      ])
      expect(landedLines(entries, BLOCK.oneTx), 'no line claims the rolled-back rows landed').toEqual([])
    })

    const stopMessage = notNull(stop, 6)

    await test.step('Commit each batch on, Stop on error on: earlier batches stay (SQL-3, SQL-7)', () => {
      expect(sessionValue(variables, 'ld_stop_ok')).toBe(false)
      expect(sessionValue(variables, 'ld_stop_changed'), 'Rows changed = the 4 rows committed').toBe(4)
      expect(sessionValue(variables, 'ld_stop_error')).toBe(stopMessage)
      expect(sessionValue(variables, 'ld_stop_reason')).toBe('DatabaseError')
      expect(readBack(variables, 'ld_stop_rows', ['id', 'name'])).toEqual([
        [1, 'row-1'],
        [2, 'row-2'],
        [3, 'row-3'],
        [4, 'row-4'],
      ])
      expectLines(entries, BLOCK.stop, [
        pgConnected,
        'INFO batch 1/4: 2 rows',
        'INFO batch 2/4: 2 rows',
        `WARN Load table failed (DatabaseError): ${stopMessage}`,
      ])
    })

    await test.step('Commit each batch on, Stop on error off: the failing batch is skipped (SQL-3, SQL-7)', () => {
      expect(sessionValue(variables, 'ld_skip_ok'), 'the block passes').toBe(true)
      expect(sessionValue(variables, 'ld_skip_changed')).toBe(5)
      expect(
        readBack(variables, 'ld_skip_rows', ['id', 'name']).map((row) => row[0]),
        'batch 3 (rows 5 and 6) is skipped; batch 4 lands',
      ).toEqual([1, 2, 3, 4, 7])
      expectLines(entries, BLOCK.skip, [
        pgConnected,
        'INFO batch 1/4: 2 rows',
        'INFO batch 2/4: 2 rows',
        `WARN batch 3/4 failed: ${notNull(skip, 6)}`,
        'INFO batch 4/4: 1 rows',
        loaded(5, skip),
      ])
    })

    const deferMessage = `23505: duplicate key value violates unique constraint "${defer}_name_key"`

    await test.step('Commit each batch on: a batch whose COMMIT is refused writes no batch line (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_defer_ok')).toBe(false)
      expect(sessionValue(variables, 'ld_defer_changed'), 'Rows changed = the 2 rows committed').toBe(2)
      expect(sessionValue(variables, 'ld_defer_error')).toBe(deferMessage)
      expect(sessionValue(variables, 'ld_defer_reason')).toBe('DatabaseError')
      expect(
        readBack(variables, 'ld_defer_rows', ['id', 'name']),
        'batch 2 rolled back at its COMMIT; batch 1 and the seeded row stay',
      ).toEqual([
        [1, 'row-1'],
        [2, 'row-2'],
        [100, 'row-3'],
      ])
      expectLines(entries, BLOCK.commitRefused, [
        pgConnected,
        'INFO batch 1/4: 2 rows',
        `WARN Load table failed (DatabaseError): ${deferMessage}`,
      ])
    })

    const noKeyMessage = `Key columns are required: ${keyed} has no primary key`

    await test.step('Add or replace needs Key columns when the target has no primary key (SQL-7)', () => {
      expect(sessionValue(variables, 'ld_nokey_ok')).toBe(false)
      expect(sessionValue(variables, 'ld_nokey_error')).toBe(noKeyMessage)
      expect(sessionValue(variables, 'ld_nokey_reason')).toBe('Validation')
      expectLines(entries, BLOCK.noKey, [
        pgConnected,
        `WARN Load table failed (Validation): ${noKeyMessage}`,
      ])
      expect(sessionValue(variables, 'ld_bykey_ok')).toBe(true)
      expect(sessionValue(variables, 'ld_bykey_changed')).toBe(2)
      expect(readBack(variables, 'ld_key_rows', ['code', 'name'])).toEqual([
        ['k1', 'new-k1'],
        ['k2', 'new-k2'],
      ])
      expect(debugStatements(entries, BLOCK.byKey)).toEqual([
        `INSERT INTO ${keyed} ("code", "name") VALUES ($1, $2) ` +
          'ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name"',
      ])
    })

    await test.step('Add or replace on every other database, each with its own upsert (SQL-7)', () => {
      const keyOnly = [
        [1, 'c1', 'old-1', 0],
        [2, 'c2', 'new-2', 1],
        [3, 'c3', 'new-3', 0],
        [9, 'c1', 'via-code', 1],
      ]
      const cases = [
        {
          block: BLOCK.mysql,
          prefix: 'ld_my',
          connected: connected('MySQL', MARIADB_PORT),
          // MariaDB matches its unique code key too: row 9 lands on row 1.
          rows: [
            [1, 'c1', 'via-code', 1],
            [2, 'c2', 'new-2', 1],
            [3, 'c3', 'new-3', 0],
          ],
          statement:
            `INSERT INTO ${up} (\`id\`, \`code\`, \`name\`, \`active\`) VALUES (%s, %s, %s, %s) ` +
            'ON DUPLICATE KEY UPDATE `code` = VALUES(`code`), `name` = VALUES(`name`), ' +
            '`active` = VALUES(`active`)',
        },
        {
          block: BLOCK.oracle,
          prefix: 'ld_or',
          connected: connected('Oracle', ORACLE_PORT),
          rows: keyOnly,
          statement:
            `MERGE INTO ${up} d USING (SELECT :1 AS "ID", :2 AS "CODE", :3 AS "NAME", :4 AS "ACTIVE" ` +
            'FROM dual) s ON (d."ID" = s."ID") WHEN MATCHED THEN UPDATE SET d."CODE" = s."CODE", ' +
            'd."NAME" = s."NAME", d."ACTIVE" = s."ACTIVE" WHEN NOT MATCHED THEN INSERT ("ID", "CODE", ' +
            '"NAME", "ACTIVE") VALUES (s."ID", s."CODE", s."NAME", s."ACTIVE")',
        },
        {
          block: BLOCK.mssql,
          prefix: 'ld_ms',
          connected: connected('SQL Server', MSSQL_PORT),
          rows: keyOnly,
          statement:
            `MERGE INTO ${up} AS d USING (SELECT %s AS [id], %s AS [code], %s AS [name], %s AS [active]) ` +
            'AS s ON (d.[id] = s.[id]) WHEN MATCHED THEN UPDATE SET d.[code] = s.[code], ' +
            'd.[name] = s.[name], d.[active] = s.[active] WHEN NOT MATCHED THEN INSERT ([id], [code], ' +
            '[name], [active]) VALUES (s.[id], s.[code], s.[name], s.[active]);',
        },
        {
          block: BLOCK.sqlite,
          prefix: 'ld_lite',
          connected: sqliteConnected,
          rows: keyOnly,
          statement:
            `INSERT INTO ${up} ("id", "code", "name", "active") VALUES (?, ?, ?, ?) ` +
            'ON CONFLICT ("id") DO UPDATE SET "code" = excluded."code", "name" = excluded."name", ' +
            '"active" = excluded."active"',
        },
      ]
      for (const each of cases) {
        expect(sessionValue(variables, `${each.prefix}_ok`), each.block).toBe(true)
        expect(sessionValue(variables, `${each.prefix}_changed`), each.block).toBe(3)
        const table = sessionTable(variables, `${each.prefix}_rows`)
        expect(table.columns, `${each.block}: active reads back as a number`).toEqual([
          { name: 'id', type: 'integer' },
          { name: 'code', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'active', type: 'integer' },
        ])
        expect(table.rows, `${each.block}: the rows read back`).toEqual(each.rows)
        expectLines(entries, each.block, [each.connected, 'INFO batch 1/1: 3 rows', loaded(3, up)])
        expect(debugStatements(entries, each.block), `${each.block}: the dialect's upsert`).toEqual([
          each.statement,
        ])
      }
    })

    const uniqueMessage = `Row 3: UNIQUE constraint failed: ${tx}.id`

    await test.step('SQLite: a clash rolls an Add and an Overwrite back whole (SQL-7, REQ-3.4.1.19)', () => {
      expect(
        sessionTable(variables, 'ld_clash').rows,
        'the Add source: its last row carries id 1, which the table holds',
      ).toEqual([
        [5, 'epsilon'],
        [6, 'zeta'],
        [1, 'alpha-again'],
      ])
      expect(
        sessionTable(variables, 'ld_lite_dupe').rows,
        'the Overwrite source: its last row repeats the id of its first',
      ).toEqual([
        [5, 'epsilon'],
        [6, 'zeta'],
        [5, 'epsilon-again'],
      ])
      for (const each of [
        { block: BLOCK.sqliteClash, prefix: 'ld_lite_clash' },
        { block: BLOCK.sqliteOverwrite, prefix: 'ld_lite_over' },
      ]) {
        expect(sessionValue(variables, `${each.prefix}_ok`), each.block).toBe(false)
        expect(sessionValue(variables, `${each.prefix}_error`), each.block).toBe(uniqueMessage)
        expect(sessionValue(variables, `${each.prefix}_reason`), each.block).toBe('DatabaseError')
        expect(
          sessionValue(variables, `${each.prefix}_changed`),
          `${each.block}: nothing was committed`,
        ).toBe(0)
        expectLines(entries, each.block, [
          sqliteConnected,
          rolledBack(tx),
          `WARN Load table failed (DatabaseError): ${uniqueMessage}`,
        ])
        expect(
          landedLines(entries, each.block),
          `${each.block}: no line claims the rolled-back rows landed`,
        ).toEqual([])
        expect(
          readBack(variables, `${each.prefix}_rows`, ['id', 'name']),
          `${each.block}: only the rows from before are in the table`,
        ).toEqual([
          [1, 'kept-1'],
          [2, 'kept-2'],
        ])
      }
    })

    await test.step('SQLite: a load waits for another writer on the same file, then lands (SQL-7, REQ-3.4.1.19)', () => {
      expect(sessionValue(variables, 'ld_lite_wait_ok'), 'the load passes').toBe(true)
      expect(sessionValue(variables, 'ld_lite_wait_changed'), 'Rows changed = its 3 rows').toBe(3)
      expectLines(entries, BLOCK.sqliteWait, [sqliteConnected, 'INFO batch 1/1: 3 rows', loaded(3, par)])
      expectLines(entries, BLOCK.sqliteHold, [
        sqliteConnected,
        /^INFO Statement 1: 0 rows changed, \d+ ms$/,
        /^INFO Statement 2: 1 rows changed, \d+ ms$/,
        /^INFO Statement 3: 1 rows, \d+ ms$/,
        /^INFO Statement 4: 0 rows changed, \d+ ms$/,
      ])
      expect(
        readBack(variables, 'ld_lite_wait_rows', ['id', 'name']),
        "the holder's row 50 and the load's three rows are all in the file",
      ).toEqual([
        [1, 'alpha-again'],
        [5, 'epsilon'],
        [6, 'zeta'],
        [50, 'held'],
      ])
    })

    await test.step('every bound value reaches a downstream Log', () => {
      const expected = [
        `ld-clash-caught ${clashMessage}`,
        'ld-modes add=3 upsert=2 rows=4 id2=beta-2 clash-caught=True after-refusals=4 ' +
          'missing=Validation csv=2 csv-first=csv-ten note=wave-keep indexes=2',
        'ld-batches one-tx=False/0/DatabaseError after-one-tx=2 stop=False/4/DatabaseError ' +
          'stop-rows=4 skip=True/5 skip-rows=5 defer=False/2/DatabaseError defer-rows=3 ' +
          'nokey=Validation bykey=2 k1=new-k1',
        'ld-dbs mysql=3/3 oracle=3/4 mssql=3/4 sqlite=3/4 my-c1=via-code or-active=1 ms-active=1',
        'ld-lite add=False/0/DatabaseError add-rows=2 over=False/0/DatabaseError over-rows=2 ' +
          'wait=True/3 wait-rows=4',
        BOOKEND,
      ]
      for (const line of expected) {
        expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
      }
    })

    await test.step('the Finally path leaves no table behind on any database', async () => {
      for (const name of ['ld_pg_left', 'ld_my_left', 'ld_or_left', 'ld_ms_left', 'ld_lite_left']) {
        expect(readBack(variables, name, ['n']), `${name}: no table is left`).toEqual([[0]])
      }
      for (const description of [
        'PostgreSQL cleanup',
        'MariaDB cleanup',
        'Oracle cleanup',
        'SQL Server cleanup',
        'SQLite cleanup',
      ]) {
        await expectNodeStatus(page, idByDescription(description), 'success')
      }
    })
  })
})
