/**
 * V-PLUGIN-SQL-SQLITE-FUNCTIONAL: Run SQL on SQLite, WAVE's bundled build
 * Wireframe: N/A
 * Design Decisions: SQL-2, SQL-3, SQL-4, SQL-5, SQL-8, SQL-9
 * REQ: REQ-3.4.1.19, REQ-3.4.1.6
 *
 * One workflow chains the SQLite cases on one per-run file in the workbench session's artifacts,
 * which the session clear removes, and on a database the spec builds and uploads into the Test's
 * own Test Data. Every block that must fail sits under Record and continue, so its Reason and
 * Error are read from its outputs and the next block runs. A second Test holds two blocks whose
 * File names a Test Data database that is not there: one under Record and continue, then one
 * under Fail the block, which ends that run.
 *
 * Pass Criteria:
 * 1. Both fixtures import through POST /tests with no repairs and validate with zero errors.
 * 2. With no `timeout` Driver option the Connect timeout is the wait on a locked file:
 *    `PRAGMA busy_timeout` returns one row, 30000 for Connect timeout 30 and 12000 for 12.
 * 3. The script's own BEGIN and ROLLBACK are honored: the four Statement lines read
 *    `0 rows changed`, `1 rows changed`, `0 rows changed` and `1 rows`, the count is the 5 from
 *    before, and Rows changed is 1.
 * 4. Max rows 2 on a 5-row SELECT followed by a DELETE on the same table: the WARN line
 *    `Stopped after 2 rows (Max rows)`, Row count 2, the first two rows kept, and the DELETE's
 *    `1 rows changed` line.
 * 5. Timeout 3 ends an endless recursive query: Reason Timeout, Error
 *    `Statement timed out after 3 seconds`, the failure lands about 3 seconds after the block
 *    starts, and the next block reads the same file (4 rows: the DELETE landed, the rolled-back
 *    insert did not).
 * 6. A File in a folder that does not exist: Reason Unreachable, Error
 *    `Could not open the SQLite file {file}: unable to open database file`, no Connected line,
 *    and nothing is created.
 * 7. A placeholder with no value fails its statement with Reason Validation: `@name` and `$name`
 *    give `Placeholder {name} has no value: write :{name} and add {name} to Parameters`; `?1` and
 *    `:1` give `Numbered placeholder 1 has no value: write :name and add name to Parameters`; `?`
 *    gives `A ? placeholder has no value: write :name and add name to Parameters`.
 * 8. `CREATE VIRTUAL TABLE` reports `0 rows changed` and Rows changed 0.
 * 9. Driver option `isolation_level` is refused with Reason Validation and
 *    `SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and
 *    cached_statements`; the block never connects and its file is not created.
 * 10. A `testdata://` database opens read-only: a SELECT returns its rows, an INSERT gives Reason
 *     DatabaseError and `attempt to write a readonly database`, and the stored file is unchanged.
 * 11. A `testdata://` name that is not there never connects and is named as typed: Error
 *     `Could not open the SQLite file testdata://{name}: unable to open database file`. Under
 *     Record and continue the Reason is Unreachable, the WARN line
 *     `Run SQL failed (Unreachable): {Error}` is the block's only line, the outputs are the empty
 *     ones and the next block runs. Under Fail the block the engine writes
 *     `Block '{Name}' failed: {Error}` and the run fails there.
 * 12. That failure shows no server path: no console line, DEBUG lines included, and no output
 *     holds a folder of the WAVE host or a `Searched paths` text, and no file appears in Test
 *     Data.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import {
  elapsedMs,
  escapeRegExp,
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  getLogRows,
  setConsoleMinimumLevel,
  type LogEntry,
  type LogRow,
} from '../../helpers/log-reader'
import { listTestDataPaths, readTestDataBytes, uploadTestData } from '../../helpers/testdata'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

type Column = { name: string; type: string }

const FIXTURE_FILE = 'fixture-sqlite.json'
const MISSING_FIXTURE_FILE = 'fixture-sqlite-missing-testdata.json'
const BOOKEND = 'sqlite-functional-done'
const RECORDED_DONE = 'sqlite-missing-recorded-done'
const NEVER_RUNS = 'sqlite-missing-never-runs'
const RUN_HALTED = 'halted with status: failed'
const ENGINE_SOURCE = 'SYSTEM'
const BEFORE_TIMEOUT = 'sqlite-before-timeout'
const READ_ONLY_FILE = 'sqlite-readonly.db'
const READ_ONLY_ROWS: Array<[number, string]> = [
  [1, 'alpha'],
  [2, 'beta'],
  [3, 'gamma'],
]
const SEEDED_ROWS = 5
/** The server's clock keeps whole milliseconds, so a deadline can read 1 ms early. */
const TIMER_GRANULARITY_MS = 1
/** How late the Timeout failure may land; the query it cuts short never ends. */
const TIMEOUT_SLACK_MS = 5_000
const REFUSED_OPTION =
  "SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and cached_statements"
const READ_ONLY_ERROR = 'attempt to write a readonly database'
const USE_A_NAME = 'write :name and add name to Parameters'

const BLOCK = {
  seed: 'Seed items',
  busy30: 'Busy timeout 30',
  busy12: 'Busy timeout 12',
  scriptTx: 'Script transaction',
  maxRows: 'Max rows',
  beforeTimeout: 'Before timeout',
  timeout: 'Timeout',
  afterTimeout: 'After timeout',
  missingFolder: 'Missing folder',
  virtualTable: 'Virtual table',
  refusedOption: 'Refused option',
  readOnlySelect: 'Read-only select',
  readOnlyInsert: 'Read-only insert',
  readOnlyBack: 'Read-only read back',
  done: 'Done',
  missingRecorded: 'Missing recorded',
  afterRecorded: 'After recorded',
  missingFail: 'Missing fail',
  afterFail: 'After fail',
} as const

const BUSY_TIMEOUTS = [
  { block: BLOCK.busy30, prefix: 'bt30', seconds: 30 },
  { block: BLOCK.busy12, prefix: 'bt12', seconds: 12 },
]

const PLACEHOLDERS = [
  {
    block: 'Placeholder at name',
    prefix: 'ph_at',
    marker: '@at_name',
    error: 'Placeholder at_name has no value: write :at_name and add at_name to Parameters',
  },
  {
    block: 'Placeholder dollar name',
    prefix: 'ph_dollar',
    marker: '$dollar_name',
    error: 'Placeholder dollar_name has no value: write :dollar_name and add dollar_name to Parameters',
  },
  {
    block: 'Placeholder question number',
    prefix: 'ph_qnum',
    marker: '?1',
    error: `Numbered placeholder 1 has no value: ${USE_A_NAME}`,
  },
  {
    block: 'Placeholder colon number',
    prefix: 'ph_cnum',
    marker: ':1',
    error: `Numbered placeholder 1 has no value: ${USE_A_NAME}`,
  },
  {
    block: 'Placeholder question mark',
    prefix: 'ph_q',
    marker: '?',
    error: `A ? placeholder has no value: ${USE_A_NAME}`,
  },
]

const PASSING_BLOCKS = [
  BLOCK.seed,
  BLOCK.busy30,
  BLOCK.busy12,
  BLOCK.scriptTx,
  BLOCK.maxRows,
  BLOCK.beforeTimeout,
  BLOCK.afterTimeout,
  BLOCK.virtualTable,
  BLOCK.readOnlySelect,
  BLOCK.readOnlyBack,
  BLOCK.done,
]
const RECORDED_BLOCKS = [
  BLOCK.timeout,
  BLOCK.missingFolder,
  ...PLACEHOLDERS.map((placeholder) => placeholder.block),
  BLOCK.refusedOption,
  BLOCK.readOnlyInsert,
]

const createdTests: string[] = []

// --- fixture helpers -----------------------------------------------------
function loadFixture(file: string, token: string): Fixture {
  const template = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
  return withToken(template, token)
}

function blockOf(fixture: Fixture, name: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
  expect(found, `the fixture must declare one block named "${name}"`).toHaveLength(1)
  return found[0]
}

function settingOf(fixture: Fixture, name: string, setting: string): unknown {
  return blockOf(fixture, name).data.config.values[setting]
}

function wholeNumber(fixture: Fixture, name: string, setting: string): number {
  const value = settingOf(fixture, name, setting)
  expect(Number.isInteger(value), `"${name}" sets ${setting} to a whole number`).toBe(true)
  return value as number
}

/** The statement as the console shows it: its text with the closing semicolon removed. */
function shownStatement(fixture: Fixture, name: string): string {
  return String(settingOf(fixture, name, 'sql')).trim().replace(/;$/, '')
}

/** Every SQL block is SQLite, and each opens the file its case calls for. */
function expectFixtureFiles(fixture: Fixture, files: Record<string, string>, fallback: string): void {
  for (const node of fixture.workflow.nodes) {
    if (node.data.elementType !== 'sql-client') continue
    const values = node.data.config.values
    const what = `"${node.data.label}"`
    expect(values.operation, `${what} runs SQL`).toBe('run_sql')
    expect(values.database_type, `${what} is a SQLite block`).toBe('sqlite')
    expect(values.file, `${what} opens its own file`).toBe(files[node.data.label] ?? fallback)
  }
}

function expectRecorded(fixture: Fixture, names: readonly string[]): void {
  for (const name of names) {
    expect(settingOf(fixture, name, 'on_error'), `"${name}" records its failure`).toBe('record')
  }
}

/** A SQLite database with three rows, built in a folder of its own and read back as bytes. */
function readOnlyDatabase(): Buffer {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-sqlite-'))
  try {
    const file = path.join(folder, READ_ONLY_FILE)
    const database = new DatabaseSync(file)
    database.exec('CREATE TABLE readonly_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const insert = database.prepare('INSERT INTO readonly_items (id, name) VALUES (?, ?)')
    for (const [id, name] of READ_ONLY_ROWS) insert.run(id, name)
    database.close()
    return fs.readFileSync(file)
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

/** Import the fixture and open it, place the database in its Test Data, and check it validates. */
async function importWithDatabase(page: Page, fixture: Fixture, database: Buffer): Promise<string> {
  const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
  createdTests.push(testId)
  expect(
    await uploadTestData(page.request, testId, '', READ_ONLY_FILE, database),
    "the database lands at the root of the Test's own Test Data",
  ).toEqual({ path: READ_ONLY_FILE, size_bytes: database.length, replaced: false })
  const validation = await validateTest(page.request, testId, 'run')
  expect(validation.status, `validate answered ${validation.status}`).toBe(200)
  expect(
    validation.errors,
    `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
  ).toHaveLength(0)
  return testId
}

// --- reading the run back ------------------------------------------------
/** The varying parts of a SQL console line: the build's version, the folder and the milliseconds. */
function normalize(message: string): string {
  return message
    .replace(/^Connected to SQLite \d+\.\d+\.\d+ at \/.*\/([^/]+)$/, 'Connected to SQLite # at #/$1')
    .replace(/^(Statement \d+: \d+ rows(?: changed)?), \d+ ms$/, '$1, # ms')
}

/** Every line one SQL block wrote, as "LEVEL message", sorted: copy texts arrive out of order. */
function sqlLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('SQL', name)
  return entries
    .filter((entry) => entry.source === source)
    .map((entry) => `${entry.level} ${normalize(entry.message)}`)
    .sort()
}

function expectSqlLines(entries: readonly LogEntry[], name: string, expected: string[]): void {
  expect(
    sqlLines(entries, name),
    `the console lines of "${name}".\n${formatEntries(entries)}`,
  ).toEqual([...expected].sort())
}

function connectedTo(file: string): string {
  return `INFO Connected to SQLite # at #/${file}`
}

function rowWith(rows: readonly LogRow[], message: string): LogRow {
  const hit = rows.filter((row) => row.message === message)
  expect(hit, `the console must carry the line "${message}" once`).toHaveLength(1)
  return hit[0]
}

/** Each named variable holds exactly the expected value. */
function expectVariables(variables: SessionVariables, expected: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(expected)) {
    expect(variables[name], `variable "${name}" is missing from the session`).toBeTruthy()
    expect(variables[name].value, `variable "${name}"`).toEqual(value)
  }
}

function table(columns: Column[], rows: unknown[][]): { columns: Column[]; rows: unknown[][] } {
  return { columns, rows }
}

function count(value: number): { columns: Column[]; rows: unknown[][] } {
  return table([{ name: 'n', type: 'integer' }], [[value]])
}

/** The open failure of the one file whose name ends as given. */
function cannotOpen(tail: string): RegExp {
  return new RegExp(`^Could not open the SQLite file .*${escapeRegExp(tail)}: unable to open database file$`)
}

/** The open failure of a Test Data name that is not there: the File as typed, never a path. */
function cannotOpenTyped(file: string): string {
  return `Could not open the SQLite file ${file}: unable to open database file`
}

/** The console carries this line once, written by this Source. */
function expectSourcedLine(
  entries: readonly LogEntry[],
  level: string,
  source: string,
  message: string,
): void {
  const hit = entries.filter(
    (entry) => entry.level === level && entry.source === source && entry.message === message,
  )
  expect(hit, `one [${level}] ${source}: "${message}".\n${formatEntries(entries)}`).toHaveLength(1)
}

async function readRun(page: Page): Promise<{ variables: SessionVariables; entries: LogEntry[] }> {
  const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
  return { variables, entries: consoleEntriesFromCopy(await getLogCopyTexts(page)) }
}

// --- suite ---------------------------------------------------------------
test.describe("V-PLUGIN-SQL-SQLITE-FUNCTIONAL: Run SQL on WAVE's bundled SQLite", () => {
  test.afterAll(async ({ request }) => {
    // Clearing the session also removes its artifacts, the SQLite file among them.
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('busy timeout, script transaction, Max rows, Timeout, refusals and a read-only Test Data database', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const token = newToken()
    const fixture = loadFixture(FIXTURE_FILE, token)
    const idOf = (name: string): string => blockOf(fixture, name).id
    const liteFile = `sqlite-${token}.db`
    const absentFile = `sqlite-absent-${token}/sqlite.db`
    const readOnly = `testdata://${READ_ONLY_FILE}`
    expectFixtureFiles(
      fixture,
      {
        [BLOCK.missingFolder]: `artifact://${absentFile}`,
        [BLOCK.refusedOption]: `artifact://sqlite-refused-${token}.db`,
        [BLOCK.readOnlySelect]: readOnly,
        [BLOCK.readOnlyInsert]: readOnly,
        [BLOCK.readOnlyBack]: readOnly,
      },
      `artifact://${liteFile}`,
    )
    expectRecorded(fixture, RECORDED_BLOCKS)
    const timeoutSeconds = wholeNumber(fixture, BLOCK.timeout, 'timeout')
    const maxRows = wholeNumber(fixture, BLOCK.maxRows, 'max_rows')
    const timeoutError = `Statement timed out after ${timeoutSeconds} seconds`
    const connected = connectedTo(liteFile)
    const database = readOnlyDatabase()

    const testId = await importWithDatabase(page, fixture, database)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 120_000)
    const { variables, entries } = await readRun(page)

    await test.step('every block ends in the state its case calls for', async () => {
      for (const name of PASSING_BLOCKS) await expectNodeStatus(page, idOf(name), 'success')
      for (const name of RECORDED_BLOCKS) await expectNodeStatus(page, idOf(name), 'warning')
    })

    await test.step('the seed script makes the per-run file with its five rows', () => {
      expectSqlLines(entries, BLOCK.seed, [
        connected,
        'INFO Statement 1: 0 rows changed, # ms',
        `INFO Statement 2: ${SEEDED_ROWS} rows changed, # ms`,
      ])
      expectVariables(variables, { seed_ok: true, seed_rows_changed: SEEDED_ROWS })
    })

    await test.step('with no timeout option the Connect timeout is the busy timeout (SQL-8)', () => {
      for (const { block, prefix, seconds } of BUSY_TIMEOUTS) {
        expect(settingOf(fixture, block, 'connect_timeout'), `"${block}" sets Connect timeout`).toBe(seconds)
        expect(settingOf(fixture, block, 'driver_options'), `"${block}" has no Driver options`).toBeUndefined()
        expectSqlLines(entries, block, [connected, 'INFO Statement 1: 1 rows, # ms'])
        expectVariables(variables, {
          [`${prefix}_ok`]: true,
          [`${prefix}_rows`]: table([{ name: 'timeout', type: 'integer' }], [[seconds * 1000]]),
        })
      }
    })

    await test.step("BEGIN and ROLLBACK in the script are the script's own (SQL-3)", () => {
      expectSqlLines(entries, BLOCK.scriptTx, [
        connected,
        'INFO Statement 1: 0 rows changed, # ms',
        'INFO Statement 2: 1 rows changed, # ms',
        'INFO Statement 3: 0 rows changed, # ms',
        'INFO Statement 4: 1 rows, # ms',
      ])
      expectVariables(variables, {
        tx_ok: true,
        tx_rows: count(SEEDED_ROWS),
        tx_row_count: 1,
        tx_rows_changed: 1,
      })
    })

    await test.step('Max rows keeps the first rows and does not hold the table (SQL-4)', () => {
      expectSqlLines(entries, BLOCK.maxRows, [
        connected,
        `INFO Statement 1: ${maxRows} rows, # ms`,
        `WARN Stopped after ${maxRows} rows (Max rows)`,
        'INFO Statement 2: 1 rows changed, # ms',
      ])
      expectVariables(variables, {
        mr_ok: true,
        mr_row_count: maxRows,
        mr_rows_changed: 1,
        mr_rows: table(
          [
            { name: 'id', type: 'integer' },
            { name: 'name', type: 'string' },
          ],
          [
            [1, 'one'],
            [2, 'two'],
          ],
        ),
      })
    })

    await test.step('Timeout ends a running statement and leaves the file usable (SQL-5)', async () => {
      expectSqlLines(entries, BLOCK.timeout, [connected, `WARN Run SQL failed (Timeout): ${timeoutError}`])
      expectVariables(variables, { to_ok: false, to_reason: 'Timeout', to_error: timeoutError })
      const rows = await getLogRows(page)
      const elapsed = elapsedMs(
        rowWith(rows, BEFORE_TIMEOUT),
        rowWith(rows, `Run SQL failed (Timeout): ${timeoutError}`),
      )
      expect(elapsed, 'the block ran its whole Timeout').toBeGreaterThanOrEqual(
        timeoutSeconds * 1000 - TIMER_GRANULARITY_MS,
      )
      expect(elapsed, 'the failure arrived at the Timeout').toBeLessThan(
        timeoutSeconds * 1000 + TIMEOUT_SLACK_MS,
      )
      expectSqlLines(entries, BLOCK.afterTimeout, [connected, 'INFO Statement 1: 1 rows, # ms'])
      expectVariables(variables, { after_ok: true, after_rows: count(SEEDED_ROWS - 1) })
    })

    await test.step('a File in a folder that does not exist is Unreachable (SQL-5)', () => {
      const error = sessionValue(variables, 'mf_error') as string
      expect(error, 'the error names the file and carries the open error').toMatch(cannotOpen(absentFile))
      expectVariables(variables, { mf_ok: false, mf_reason: 'Unreachable' })
      expectSqlLines(entries, BLOCK.missingFolder, [`WARN Run SQL failed (Unreachable): ${error}`])
    })

    await test.step('a placeholder with no value fails its statement with Reason Validation (SQL-2)', () => {
      for (const { block, prefix, marker, error } of PLACEHOLDERS) {
        const statement = shownStatement(fixture, block)
        expect(statement, `"${block}" writes the marker`).toContain(marker)
        expect(settingOf(fixture, block, 'parameters'), `"${block}" binds one name`).toEqual({
          bound: 'kept',
        })
        expectVariables(variables, {
          [`${prefix}_ok`]: false,
          [`${prefix}_reason`]: 'Validation',
          [`${prefix}_error`]: error,
        })
        expectSqlLines(entries, block, [
          connected,
          `ERROR Statement 1 (${statement}) failed: ${error}`,
          `WARN Run SQL failed (Validation): ${error}`,
        ])
      }
    })

    await test.step('CREATE VIRTUAL TABLE reports no changed rows (SQL-9)', () => {
      expect(shownStatement(fixture, BLOCK.virtualTable)).toMatch(/^CREATE VIRTUAL TABLE /)
      expectSqlLines(entries, BLOCK.virtualTable, [connected, 'INFO Statement 1: 0 rows changed, # ms'])
      expectVariables(variables, { vt_ok: true, vt_rows_changed: 0 })
    })

    await test.step('a Driver option SQLite does not take is refused before the file is opened (SQL-8)', async () => {
      expect(settingOf(fixture, BLOCK.refusedOption, 'driver_options')).toEqual({
        isolation_level: 'DEFERRED',
      })
      expectVariables(variables, { m3_ok: false, m3_reason: 'Validation', m3_error: REFUSED_OPTION })
      expectSqlLines(entries, BLOCK.refusedOption, [`WARN Run SQL failed (Validation): ${REFUSED_OPTION}`])

      const listing = await page.request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(listing.ok(), `GET session artifacts failed: ${listing.status()}`).toBeTruthy()
      const made = ((await listing.json()) as { items: Array<{ path: string }> }).items
        .map((item) => item.path)
        .filter((item) => item.includes(token))
      expect(made, 'only the per-run file exists: no refused file, nothing in the absent folder').toEqual([
        liteFile,
      ])
    })

    await test.step('a Test Data database reads, refuses writes and is left as uploaded (SQL-8)', async () => {
      const connectedReadOnly = connectedTo(READ_ONLY_FILE)
      expectSqlLines(entries, BLOCK.readOnlySelect, [
        connectedReadOnly,
        `INFO Statement 1: ${READ_ONLY_ROWS.length} rows, # ms`,
      ])
      expectSqlLines(entries, BLOCK.readOnlyInsert, [
        connectedReadOnly,
        `ERROR Statement 1 (${shownStatement(fixture, BLOCK.readOnlyInsert)}) failed: ${READ_ONLY_ERROR}`,
        `WARN Run SQL failed (DatabaseError): ${READ_ONLY_ERROR}`,
      ])
      expectSqlLines(entries, BLOCK.readOnlyBack, [connectedReadOnly, 'INFO Statement 1: 1 rows, # ms'])
      expectVariables(variables, {
        ro_ok: true,
        ro_row_count: READ_ONLY_ROWS.length,
        ro_rows: table(
          [
            { name: 'id', type: 'integer' },
            { name: 'name', type: 'string' },
          ],
          READ_ONLY_ROWS,
        ),
        ro_ins_ok: false,
        ro_ins_reason: 'DatabaseError',
        ro_ins_error: READ_ONLY_ERROR,
        ro_back_ok: true,
        ro_back_rows: count(READ_ONLY_ROWS.length),
      })
      expect(await listTestDataPaths(page.request, testId), 'Test Data holds the database alone').toEqual([
        READ_ONLY_FILE,
      ])
      const stored = await readTestDataBytes(page.request, testId, READ_ONLY_FILE)
      expect(stored.equals(database), 'the stored database is byte for byte the uploaded one').toBe(true)
    })

    await test.step('the last block ran and the run passed', () => {
      expectConsoleLine(entries, 'INFO', BOOKEND)
    })
  })

  test('a Test Data name that is not there is Unreachable, named as typed, and creates nothing', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const token = newToken()
    const fixture = loadFixture(MISSING_FIXTURE_FILE, token)
    const idOf = (name: string): string => blockOf(fixture, name).id
    const recordedFile = `testdata://sqlite-missing-${token}.db`
    const failFile = `testdata://sqlite-missing-fail-${token}.db`
    expectFixtureFiles(fixture, { [BLOCK.missingRecorded]: recordedFile, [BLOCK.missingFail]: failFile }, '')
    expectRecorded(fixture, [BLOCK.missingRecorded])
    expect(settingOf(fixture, BLOCK.missingFail, 'on_error'), 'the second block fails the run').toBe('fail')
    const recordedError = cannotOpenTyped(recordedFile)
    const failError = cannotOpenTyped(failFile)
    const database = readOnlyDatabase()

    const testId = await importWithDatabase(page, fixture, database)

    // At DEBUG the console shows every line of the run, the Inputs and Outputs echoes included.
    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    const { verdict } = await finishRunAnyVerdict(page, status, RUN_HALTED, 60_000)
    const { variables, entries } = await readRun(page)
    const shown = entries.filter((entry) => entry.level !== 'DEBUG')

    await test.step('Record and continue: Reason Unreachable, the File as typed, the empty outputs (SQL-5)', async () => {
      expectVariables(variables, {
        td_ok: false,
        td_reason: 'Unreachable',
        td_error: recordedError,
        td_row_count: 0,
        td_rows_changed: 0,
        td_rows: table([], []),
      })
      expectSqlLines(shown, BLOCK.missingRecorded, [`WARN Run SQL failed (Unreachable): ${recordedError}`])
      await expectNodeStatus(page, idOf(BLOCK.missingRecorded), 'warning')
    })

    await test.step('the block after the recorded failure runs', async () => {
      expectSourcedLine(shown, 'INFO', blockSource('Log', BLOCK.afterRecorded), RECORDED_DONE)
      await expectNodeStatus(page, idOf(BLOCK.afterRecorded), 'success')
    })

    await test.step('Fail the block: the engine names the block and the run fails there (SQL-5)', async () => {
      expectSourcedLine(shown, 'ERROR', ENGINE_SOURCE, `Block '${BLOCK.missingFail}' failed: ${failError}`)
      expectSqlLines(shown, BLOCK.missingFail, [])
      await expectNodeStatus(page, idOf(BLOCK.missingFail), 'failed')
      expect(verdict, `the run fails at the block.\n${formatEntries(shown)}`).toBe('failed')
      expect(
        entries.filter((entry) => entry.message.includes(NEVER_RUNS)),
        'the block after the failed one writes nothing',
      ).toEqual([])
      await expect(
        page.locator(`[data-testid="workflow-node-${idOf(BLOCK.afterFail)}"]`),
        'the block after the failed one did not run',
      ).not.toHaveAttribute('data-execution-status', 'success')
    })

    await test.step('neither block connects, and no line or output shows a server path', () => {
      for (const [block, file] of [
        [BLOCK.missingRecorded, recordedFile],
        [BLOCK.missingFail, failFile],
      ]) {
        const echoed = entries.filter(
          (entry) =>
            entry.level === 'DEBUG' &&
            entry.source === blockSource('SQL', block) &&
            entry.message.startsWith('Inputs: ') &&
            entry.message.includes(`"file":${JSON.stringify(file)}`),
        )
        expect(echoed, `the DEBUG lines of "${block}" are read.\n${formatEntries(entries)}`).toHaveLength(1)
      }
      // The WAVE host keeps Test Data in a folder named testdata, so "/testdata/" is a server path.
      const pathForm = new RegExp(`/testdata/|(?<!testdata://)sqlite-missing-(?:fail-)?${token}`)
      for (const text of [...entries.map((entry) => entry.message), JSON.stringify(variables)]) {
        expect(text, 'no Connected line').not.toMatch(/^Connected to /)
        expect(text, 'no Searched paths text').not.toContain('Searched paths')
        expect(text, 'the file is named only as typed').not.toMatch(pathForm)
      }
    })

    await test.step('no file appears in Test Data', async () => {
      expect(await listTestDataPaths(page.request, testId), 'Test Data holds the uploaded database alone').toEqual([
        READ_ONLY_FILE,
      ])
    })
  })
})
