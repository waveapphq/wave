/**
 * V-PLUGIN-SQL-RUN-FUNCTIONAL (errors): Run SQL failure paths against the real databases
 * Wireframe: N/A
 * Design Decisions: SQL-2, SQL-3, SQL-4, SQL-5
 * REQ: REQ-3.4.1.6
 *
 * One workflow chains every failure path on the real PostgreSQL, with Oracle and SQL Server where
 * the path is their own, inside a Try/Catch whose Finally drops the one table the run creates. The
 * table and the missing tables the failing statements name carry a per-run token. The fixture stores
 * no real password: the spec fills the harness password from config at load.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero errors, even
 *    though two blocks name a `:name` with no Parameters entry: that check runs at run time.
 * 2. Stop on error off, two of five statements failing: every statement runs, each failure is a
 *    WARN line naming the statement by number and first line with PostgreSQL's own code and text,
 *    Rows holds the last statement that returned rows, Rows changed is the sum, and the block
 *    passes.
 * 3. Stop on error off, every statement failing: one WARN line per statement, Success true, empty
 *    Rows, Row count and Rows changed 0, and the block ends amber.
 * 4. Stop on error on under Fail the block: the ERROR line names statement 2 by its first line, the
 *    block fails with `42P01: relation "..." does not exist` unchanged, statement 3 is never sent,
 *    and the Try/Catch catches that exact message.
 * 5. Stop on error on, Oracle, Record and continue: Reason DatabaseError with Oracle's ORA-00942
 *    text unchanged, statement 3 never runs, and the block ends amber.
 * 6. An undefined `:name` under Record and continue: Reason Validation and Error
 *    `Parameter 'unknown_note' is used in the SQL but not defined`, the block never connects, it
 *    ends amber and the next block runs.
 * 7. An undefined `:name` under Fail the block: the block fails with that message before it
 *    connects, and the Try/Catch catches it.
 * 8. Max rows reached: the WARN line `Stopped after 4 rows (Max rows)`, Row count 4, the first four
 *    rows kept, and the block passes.
 * 9. A closed port records Reason Unreachable with `Could not connect to PostgreSQL at {host}:{port}:
 *    {driver's own text}`; a wrong password records Reason AuthFailed with
 *    `Authentication failed for {user} at {host}: {database's own text}`.
 * 10. Timeout 3 against `pg_sleep(60)`: Reason Timeout, `Statement timed out after 3 seconds`, the
 *     failure lands about 3 seconds after the block starts, and a later block finds no active query
 *     carrying the sleep's tag on the database.
 * 11. A script that ends on a session-state statement logs `Statement {n} ({keyword}) ends the
 *     script; its effect ends with the block`: SET on PostgreSQL, ALTER SESSION on Oracle, and a
 *     SQL Server batch whose last statement is SET; a script where SET comes first logs none.
 * 12. BEGIN and COMMIT belong to the script: its own BEGIN ... ROLLBACK undoes its insert, its
 *     BEGIN ... COMMIT keeps one, Rows changed counts both inserts, and a script ending on COMMIT
 *     gets no session-state warning.
 * 13. Nothing reached the database from the stopped statement, the Validation blocks or the
 *     rolled-back insert: the table holds ids 1, 3, 4 and 9 only. The Finally then drops it, a
 *     check finds it gone, and the outer Try/Catch caught nothing.
 * 14. Every bound value reaches a downstream Log, every block ends in its state, and the run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  MSSQL_PORT,
  NETCAT_CLOSED_PORT,
  ORACLE_PORT,
  ORACLE_SERVICE_NAME,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  injectServiceHost,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  elapsedMs,
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  getLogRows,
  type LogEntry,
  type LogRow,
} from '../../helpers/log-reader'
import { withStackPassword } from '../../helpers/sql-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  [key: string]: unknown
}

type Column = { name: string; type: string }

const FIXTURE_FILE = 'fixture-errors.json'
const BOOKEND = 'sqlerr-run-errors-done'
/** The dialing side's own loopback, which the import rewrite never touches. */
const OWN_LOOPBACK = 'localhost'
const WRONG_PASSWORD = 'not-the-password'
/** The server's clock keeps whole milliseconds, so a deadline can read 1 ms early. */
const TIMER_GRANULARITY_MS = 1
/** How late the Timeout failure may land; far below the 60 s sleep it cuts short. */
const TIMEOUT_SLACK_MS = 5_000
const SESSION_STATE_TAIL = 'ends the script; its effect ends with the block'
/** Oracle's own text ends on the error's help page. */
const ORACLE_HELP = 'Help: https://docs.oracle.com/error-help/db/'

const BLOCK = {
  create: 'Create the table',
  stopOff: 'Stop off some fail',
  allFailed: 'Stop off all fail',
  stopOn: 'Stop on error fail',
  stopCaught: 'Stop caught',
  oracleStop: 'Oracle stop on error recorded',
  undefinedRecorded: 'Undefined name recorded',
  undefinedFail: 'Undefined name fail',
  undefinedCaught: 'Undefined caught',
  maxRows: 'Max rows reached',
  unreachable: 'Unreachable recorded',
  authFailed: 'AuthFailed recorded',
  connectProof: 'Proof connection failures',
  timeout: 'Timeout recorded',
  sleepGone: 'Sleep gone from the database',
  stateLast: 'Session state last',
  stateFirst: 'Session state first',
  oracleState: 'Oracle session state last',
  mssqlBatchSet: 'SQL Server batch ends on SET',
  mssqlSetFirst: 'SQL Server SET before GO',
  scriptTx: 'Script transaction',
  readBack: 'Read back the ids',
  drop: 'Drop the table',
  gone: 'Table is gone',
} as const

const PASSING_BLOCKS = [
  BLOCK.create,
  BLOCK.stopOff,
  BLOCK.stopCaught,
  BLOCK.undefinedCaught,
  BLOCK.maxRows,
  BLOCK.connectProof,
  BLOCK.sleepGone,
  BLOCK.stateLast,
  BLOCK.stateFirst,
  BLOCK.oracleState,
  BLOCK.mssqlBatchSet,
  BLOCK.mssqlSetFirst,
  BLOCK.scriptTx,
  BLOCK.readBack,
  BLOCK.drop,
  BLOCK.gone,
  'Proof stop off',
  'Proof all failed',
  'Proof oracle',
  'Proof undefined recorded',
  'Proof max rows',
  'Proof timeout',
  'Proof session state',
  'Proof script transaction',
  'Proof read back',
  'Done',
]
const AMBER_BLOCKS = [
  BLOCK.allFailed,
  BLOCK.oracleStop,
  BLOCK.undefinedRecorded,
  BLOCK.unreachable,
  BLOCK.authFailed,
  BLOCK.timeout,
]
const FAILED_BLOCKS = [BLOCK.stopOn, BLOCK.undefinedFail]

const POSTGRES_BLOCKS = [
  BLOCK.create,
  BLOCK.stopOff,
  BLOCK.allFailed,
  BLOCK.stopOn,
  BLOCK.undefinedRecorded,
  BLOCK.undefinedFail,
  BLOCK.maxRows,
  BLOCK.timeout,
  BLOCK.sleepGone,
  BLOCK.stateLast,
  BLOCK.stateFirst,
  BLOCK.scriptTx,
  BLOCK.readBack,
  BLOCK.drop,
  BLOCK.gone,
]

const createdTests: string[] = []

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

function settingOf(fixture: Fixture, description: string, name: string): unknown {
  return blockOf(fixture, description).data.config.values[name]
}

/** Every SQL block must dial the harness database as the harness user, and store no real password. */
function expectFixtureTargets(fixture: Fixture): void {
  const dials = (
    description: string,
    databaseType: string,
    host: string,
    port: string,
    database: string,
    password = '',
  ): void => {
    const block = blockOf(fixture, description)
    expect(block.data.label, `"${description}" carries its Description as its Name`).toBe(description)
    const values = block.data.config.values
    expect(values.database_type, `"${description}" picks the database type`).toBe(databaseType)
    expect(values.host, `"${description}" carries the host the import expects`).toBe(host)
    expect(String(values.port), `"${description}" dials the harness port`).toBe(port)
    expect(values.database, `"${description}" names the harness database`).toBe(database)
    expect(values.username, `"${description}" logs in as the harness user`).toBe(SQL_STACK_USER)
    expect(values.password, `"${description}" carries the password it means to`).toBe(password)
  }
  for (const description of POSTGRES_BLOCKS) {
    dials(description, 'postgresql', SSH_FIXTURE_HOST_SENTINEL, POSTGRES_PORT, SQL_STACK_DATABASE)
  }
  dials(BLOCK.unreachable, 'postgresql', OWN_LOOPBACK, NETCAT_CLOSED_PORT, SQL_STACK_DATABASE)
  dials(
    BLOCK.authFailed,
    'postgresql',
    SSH_FIXTURE_HOST_SENTINEL,
    POSTGRES_PORT,
    SQL_STACK_DATABASE,
    WRONG_PASSWORD,
  )
  for (const description of [BLOCK.oracleStop, BLOCK.oracleState]) {
    dials(description, 'oracle', SSH_FIXTURE_HOST_SENTINEL, ORACLE_PORT, ORACLE_SERVICE_NAME)
  }
  for (const description of [BLOCK.mssqlBatchSet, BLOCK.mssqlSetFirst]) {
    dials(description, 'mssql', SSH_FIXTURE_HOST_SENTINEL, MSSQL_PORT, SQL_STACK_DATABASE)
    expect(settingOf(fixture, description, 'tls'), `"${description}" turns TLS off`).toBe(false)
  }
  for (const description of [BLOCK.stopOff, BLOCK.allFailed]) {
    expect(settingOf(fixture, description, 'stop_on_error'), `"${description}" runs on`).toBe(false)
  }
  for (const description of [BLOCK.stopOn, BLOCK.oracleStop]) {
    expect(settingOf(fixture, description, 'stop_on_error'), `"${description}" stops`).toBe(true)
  }
}

function wholeNumber(fixture: Fixture, description: string, name: string): number {
  const value = settingOf(fixture, description, name)
  expect(Number.isInteger(value), `"${description}" sets ${name} to a whole number`).toBe(true)
  return value as number
}

// --- reading the run back ------------------------------------------------
/** The varying parts of a SQL console line: the server version and the elapsed milliseconds. */
function normalize(message: string): string {
  return message
    .replace(/^Connected to (PostgreSQL|Oracle|SQL Server) .+ at (\S+)$/, 'Connected to $1 # at $2')
    .replace(/^(Statement \d+: \d+ rows(?: changed)?), \d+ ms$/, '$1, # ms')
}

/** The lines of the SQL block of that Name, as "LEVEL message", sorted: copy texts arrive out of order. */
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

// --- suite ---------------------------------------------------------------
test.describe('V-PLUGIN-SQL-RUN-FUNCTIONAL (errors): Run SQL failure paths', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('Stop on error, Validation, Max rows, the failure reasons and the session-state warning', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const template = loadFixture()
    expectFixtureTargets(template)
    const token = newToken()
    const fixture = withStackPassword(withToken(template, token))
    const idOf = (description: string): string => blockOf(fixture, description).id
    const maxRows = wholeNumber(fixture, BLOCK.maxRows, 'max_rows')
    const timeoutSeconds = wholeNumber(fixture, BLOCK.timeout, 'timeout')
    const connectTimeout = wholeNumber(fixture, BLOCK.unreachable, 'connect_timeout')
    const firstRows = Array.from({ length: maxRows }, (_unused, index) => index + 1)

    const tableName = `e2e_sqlerr_${token}`
    const missing = `${tableName}_missing`
    const relationMissing = `42P01: relation "${missing}" does not exist`
    const oracleError =
      `ORA-00942: table or view "${SQL_STACK_USER.toUpperCase()}"."${missing.toUpperCase()}" ` +
      `does not exist\n${ORACLE_HELP}ora-00942/`
    const postgresAt = `${SQL_TARGET_HOST}:${POSTGRES_PORT}`
    const oracleAt = `${SQL_TARGET_HOST}:${ORACLE_PORT}`
    const mssqlAt = `${SQL_TARGET_HOST}:${MSSQL_PORT}`
    const connectedPostgres = `INFO Connected to PostgreSQL # at ${postgresAt}`
    const connectedOracle = `INFO Connected to Oracle # at ${oracleAt}`
    const connectedMssql = `INFO Connected to SQL Server # at ${mssqlAt}`
    const undefinedNote = "Parameter 'unknown_note' is used in the SQL but not defined"
    const undefinedId = "Parameter 'unknown_id' is used in the SQL but not defined"
    const unreachableError =
      `Could not connect to PostgreSQL at ${OWN_LOOPBACK}:${NETCAT_CLOSED_PORT}: ` +
      `Can't create a connection to host ${OWN_LOOPBACK} and port ${NETCAT_CLOSED_PORT} ` +
      `(timeout is ${connectTimeout} and source_address is None).`
    const authError =
      `Authentication failed for ${SQL_STACK_USER} at ${SQL_TARGET_HOST}: ` +
      `password authentication failed for user "${SQL_STACK_USER}"`
    const timeoutError = `Statement timed out after ${timeoutSeconds} seconds`

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(
      page,
      injectServiceHost(fixture as unknown as Record<string, unknown>, SQL_TARGET_HOST),
      { rejectRepairs: true },
    )
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)

    await test.step('every block ends in the state its permutation calls for', async () => {
      for (const description of PASSING_BLOCKS) {
        await expectNodeStatus(page, idOf(description), 'success')
      }
      for (const description of AMBER_BLOCKS) {
        await expectNodeStatus(page, idOf(description), 'warning')
      }
      for (const description of FAILED_BLOCKS) {
        await expectNodeStatus(page, idOf(description), 'failed')
      }
    })

    await test.step('Stop on error off runs every statement and passes (SQL-3)', () => {
      expectSqlLines(entries, BLOCK.create, [connectedPostgres, 'INFO Statement 1: 0 rows changed, # ms'])
      expectSqlLines(entries, BLOCK.stopOff, [
        connectedPostgres,
        'INFO Statement 1: 1 rows changed, # ms',
        `WARN Statement 2 (INSERT INTO ${missing} (id) VALUES (2)) failed: ${relationMissing}`,
        'INFO Statement 3: 1 rows changed, # ms',
        'INFO Statement 4: 2 rows, # ms',
        `WARN Statement 5 (SELECT id FROM ${missing}) failed: ${relationMissing}`,
      ])
      expectVariables(variables, {
        so_ok: true,
        so_count: 2,
        so_changed: 2,
        so_rows: table(
          [
            { name: 'id', type: 'integer' },
            { name: 'note', type: 'string' },
          ],
          [
            [1, 'first'],
            [3, 'after the failure'],
          ],
        ),
      })
    })

    await test.step('Stop on error off with every statement failing ends amber (SQL-3)', () => {
      expectSqlLines(entries, BLOCK.allFailed, [
        connectedPostgres,
        `WARN Statement 1 (SELECT id FROM ${missing}) failed: ${relationMissing}`,
        `WARN Statement 2 (DELETE FROM ${missing}) failed: ${relationMissing}`,
      ])
      expectVariables(variables, {
        af_ok: true,
        af_count: 0,
        af_changed: 0,
        af_rows: table([], []),
      })
    })

    await test.step("Stop on error on fails with PostgreSQL's own text (SQL-3, SQL-5)", () => {
      expectSqlLines(entries, BLOCK.stopOn, [
        connectedPostgres,
        'INFO Statement 1: 1 rows changed, # ms',
        `ERROR Statement 2 (UPDATE ${missing} SET id = 0) failed: ${relationMissing}`,
      ])
      expectConsoleLine(entries, 'ERROR', `Block '${BLOCK.stopOn}' failed: ${relationMissing}`)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${relationMissing}`)
      const caught = variables.stop_error?.value as Record<string, unknown>
      expect(variables.stop_caught?.value, 'the Try/Catch caught the failure').toBe(true)
      expect(caught?.message, 'the block error is the database text, unchanged').toBe(relationMissing)
      expect(caught?.node, 'the error names the SQL block').toBe(BLOCK.stopOn)
      expect(caught?.node_id, 'the error points at the SQL block').toBe(idOf(BLOCK.stopOn))
    })

    await test.step("Stop on error on, Oracle, records ORA-00942 unchanged (SQL-5)", () => {
      expectSqlLines(entries, BLOCK.oracleStop, [
        connectedOracle,
        'INFO Statement 1: 1 rows, # ms',
        `ERROR Statement 2 (SELECT id FROM ${missing}) failed: ${oracleError}`,
        `WARN Run SQL failed (DatabaseError): ${oracleError}`,
      ])
      expectVariables(variables, {
        ora_ok: false,
        ora_reason: 'DatabaseError',
        ora_error: oracleError,
        ora_count: 0,
        ora_rows: table([], []),
      })
    })

    await test.step('an undefined :name is refused before anything is sent (SQL-2, SQL-5)', () => {
      expectSqlLines(entries, BLOCK.undefinedRecorded, [
        `WARN Run SQL failed (Validation): ${undefinedNote}`,
      ])
      expectVariables(variables, {
        vr_ok: false,
        vr_reason: 'Validation',
        vr_error: undefinedNote,
        vr_count: 0,
        vr_changed: 0,
      })
      expectSqlLines(entries, BLOCK.undefinedFail, [])
      expectConsoleLine(entries, 'ERROR', `Block '${BLOCK.undefinedFail}' failed: ${undefinedId}`)
      const caught = variables.undef_error?.value as Record<string, unknown>
      expect(variables.undef_caught?.value, 'the Try/Catch caught the failure').toBe(true)
      expect(caught?.message).toBe(undefinedId)
      expect(caught?.node_id).toBe(idOf(BLOCK.undefinedFail))
    })

    await test.step('Max rows reached keeps the rows so far and passes (SQL-4)', () => {
      expectSqlLines(entries, BLOCK.maxRows, [
        connectedPostgres,
        `INFO Statement 1: ${maxRows} rows, # ms`,
        `WARN Stopped after ${maxRows} rows (Max rows)`,
      ])
      expectVariables(variables, {
        mr_ok: true,
        mr_count: maxRows,
        mr_rows: table(
          [{ name: 'n', type: 'integer' }],
          firstRows.map((n) => [n]),
        ),
      })
    })

    await test.step('a closed port and a refused login carry their reasons (SQL-5)', () => {
      expectSqlLines(entries, BLOCK.unreachable, [
        `WARN Run SQL failed (Unreachable): ${unreachableError}`,
      ])
      expectSqlLines(entries, BLOCK.authFailed, [`WARN Run SQL failed (AuthFailed): ${authError}`])
      expectVariables(variables, {
        un_ok: false,
        un_reason: 'Unreachable',
        un_error: unreachableError,
        au_ok: false,
        au_reason: 'AuthFailed',
        au_error: authError,
      })
    })

    await test.step('Timeout cancels the statement on the database (SQL-5)', async () => {
      expectSqlLines(entries, BLOCK.timeout, [
        connectedPostgres,
        `WARN Run SQL failed (Timeout): ${timeoutError}`,
      ])
      expectSqlLines(entries, BLOCK.sleepGone, [connectedPostgres, 'INFO Statement 1: 1 rows, # ms'])
      expectVariables(variables, {
        to_ok: false,
        to_reason: 'Timeout',
        to_error: timeoutError,
        act_rows: table([{ name: 'running', type: 'integer' }], [[0]]),
      })
      const rows = await getLogRows(page)
      const before = rows.filter((row) => row.message.startsWith('sqlerr-connect '))
      expect(before, 'the Log just before the Timeout block wrote once').toHaveLength(1)
      const failed = rowWith(rows, `Run SQL failed (Timeout): ${timeoutError}`)
      const elapsed = elapsedMs(before[0], failed)
      expect(elapsed, 'the block ran its whole Timeout').toBeGreaterThanOrEqual(
        timeoutSeconds * 1000 - TIMER_GRANULARITY_MS,
      )
      expect(elapsed, 'the failure arrived at the Timeout, not at the end of the sleep').toBeLessThan(
        timeoutSeconds * 1000 + TIMEOUT_SLACK_MS,
      )
    })

    await test.step('a script ending on a session-state statement is flagged (SQL-3)', () => {
      expectSqlLines(entries, BLOCK.stateLast, [
        connectedPostgres,
        'INFO Statement 1: 1 rows, # ms',
        'INFO Statement 2: 0 rows changed, # ms',
        `WARN Statement 2 (SET) ${SESSION_STATE_TAIL}`,
      ])
      expectSqlLines(entries, BLOCK.stateFirst, [
        connectedPostgres,
        'INFO Statement 1: 0 rows changed, # ms',
        'INFO Statement 2: 1 rows, # ms',
      ])
      expectSqlLines(entries, BLOCK.oracleState, [
        connectedOracle,
        'INFO Statement 1: 1 rows, # ms',
        'INFO Statement 2: 0 rows changed, # ms',
        `WARN Statement 2 (ALTER SESSION) ${SESSION_STATE_TAIL}`,
      ])
      expectSqlLines(entries, BLOCK.mssqlBatchSet, [
        connectedMssql,
        'INFO Statement 1: 1 rows, # ms',
        `WARN Statement 1 (SET) ${SESSION_STATE_TAIL}`,
      ])
      expectSqlLines(entries, BLOCK.mssqlSetFirst, [
        connectedMssql,
        'INFO Statement 1: 0 rows changed, # ms',
        'INFO Statement 2: 1 rows, # ms',
      ])
      expectVariables(variables, {
        ss_rows: table([{ name: 'schema_name', type: 'string' }], [['public']]),
        ms_rows: table([{ name: 'one', type: 'integer' }], [[1]]),
      })
    })

    await test.step("BEGIN and COMMIT in the script are the script's own (SQL-3)", () => {
      expectSqlLines(entries, BLOCK.scriptTx, [
        connectedPostgres,
        'INFO Statement 1: 0 rows changed, # ms',
        'INFO Statement 2: 1 rows changed, # ms',
        'INFO Statement 3: 0 rows changed, # ms',
        'INFO Statement 4: 0 rows changed, # ms',
        'INFO Statement 5: 1 rows changed, # ms',
        'INFO Statement 6: 0 rows changed, # ms',
      ])
      expectVariables(variables, { tx_ok: true, tx_changed: 2 })
    })

    await test.step('only the statements that ran and committed reached the table; the Finally drops it', () => {
      expectSqlLines(entries, BLOCK.readBack, [connectedPostgres, 'INFO Statement 1: 4 rows, # ms'])
      expectSqlLines(entries, BLOCK.drop, [connectedPostgres, 'INFO Statement 1: 0 rows changed, # ms'])
      expectSqlLines(entries, BLOCK.gone, [connectedPostgres, 'INFO Statement 1: 1 rows, # ms'])
      expectVariables(variables, {
        ids_rows: table([{ name: 'id', type: 'integer' }], [[1], [3], [4], [9]]),
        left_rows: table([{ name: 'left_over', type: 'integer' }], [[0]]),
        drop_ok: true,
        run_caught: false,
      })
    })

    await test.step('every bound value reaches its downstream Log', () => {
      const expected = [
        'sqlerr-stop-off ok=True count=2 changed=2 ids=1,3 last-note=after the failure',
        'sqlerr-all-failed ok=True count=0 changed=0 rows=0',
        `sqlerr-stop-caught ${relationMissing}`,
        'sqlerr-oracle ok=False reason=DatabaseError count=0 rows=0 code=ORA-00942',
        `sqlerr-undefined-recorded ok=False reason=Validation count=0 changed=0 error=${undefinedNote}`,
        `sqlerr-undefined-caught ${undefinedId}`,
        `sqlerr-max-rows ok=True count=${maxRows} values=${firstRows.join(',')}`,
        'sqlerr-connect unreachable-ok=False unreachable-reason=Unreachable auth-ok=False auth-reason=AuthFailed',
        `sqlerr-timeout ok=False reason=Timeout error=${timeoutError} still-running=0`,
        'sqlerr-session-state schema=public mssql-one=1',
        'sqlerr-script-tx ok=True changed=2',
        'sqlerr-read-back ids=1,3,4,9 drop-ok=True left-over=0 caught=False',
        BOOKEND,
      ]
      for (const line of expected) {
        expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
      }
    })

    await test.step('the password never reaches the console', () => {
      const text = messages.join('\n')
      expect(text, 'the harness password stays out of the console').not.toContain(SQL_STACK_PASSWORD)
      expect(text, 'the wrong password stays out of the console').not.toContain(WRONG_PASSWORD)
    })
  })
})
