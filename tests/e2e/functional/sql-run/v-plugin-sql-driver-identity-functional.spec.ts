/**
 * V-PLUGIN-SQL-DRIVER-IDENTITY-FUNCTIONAL: what the SQL block's drivers take from the block alone
 * Wireframe: N/A
 * Design Decisions: SQL-5, SQL-8
 * REQ: REQ-3.4.1.19, REQ-3.4.1.6
 *
 * One workflow, run through the Workbench on the real databases, reads the program name back on
 * PostgreSQL, MariaDB, SQL Server and Oracle, connects to Oracle through three spellings of a full
 * dsn, and then sends every Oracle Driver option WAVE refuses before it connects, each under Record
 * and continue so the run goes on; the alias refusal runs once more under Fail the block inside a
 * Try / Catch. Nothing is written to a database. A second Test proves the Oracle session time zone
 * on a backend this spec starts in another time zone, run through the API because only a spawned
 * backend can leave UTC. The fixtures store no password: the spec fills it from config at load.
 *
 * Pass Criteria:
 * 1. Both fixtures import through POST /tests with no repairs and validate with zero errors; every
 *    SQL block dials the stack with the stack's login, and no program-name block carries a Driver
 *    option.
 * 2. Program name: `SELECT current_setting('application_name')` on PostgreSQL, the `program_name`
 *    connection attribute on MariaDB, `SELECT APP_NAME()` on SQL Server and
 *    `SELECT SYS_CONTEXT('USERENV', 'CLIENT_PROGRAM_NAME') FROM dual` on Oracle each return one row
 *    holding `WAVE`.
 * 3. A full Oracle dsn connects: `{host}:{port}/FREEPDB1` beside a Port row nothing listens
 *    on, the same target as a `(DESCRIPTION=...)` connect descriptor, and the first form with two
 *    spaces on each side. Each block passes with one row and logs
 *    `Connected to Oracle {version} at {dsn}`, the dsn without the spaces the block received.
 * 4. `dsn` = `FREEPDB1` under Record and continue gives Success false, Reason Validation and
 *    Error `Oracle Driver option dsn 'FREEPDB1' is a TNS alias, which WAVE does not look up: use
 *    Host, Port and Service name, or paste the full connect descriptor`; the Record WARN line is
 *    the block's only line and the block ends amber. Under Fail the block the block fails with
 *    `Block '{Name}' failed: {that message}` and the Try / Catch catches the same message.
 * 5. A `config-file://` dsn is refused as a configuration provider, Reason Validation.
 * 6. An `ldap://` dsn and an `LDAPS://` dsn are refused as a directory address, Reason
 *    Validation.
 * 7. A `{host}:{port}` dsn with no service name gets the alias message with the dsn trimmed,
 *    Reason Validation, and nothing is dialed although a listener is there.
 * 8. TLS on beside a dsn that is not all TLS is refused, Reason Validation: a connect
 *    descriptor (one TCP address, and one TCPS address beside one TCP address) with
 *    `use PROTOCOL=TCPS in it`, a `{host}:{port}/FREEPDB1` dsn with `start it with tcps://`.
 * 9. TLS off beside a `tcps://` dsn, and beside a connect descriptor with one TCPS address
 *    among two, is refused with `uses TLS but TLS is off`, Reason Validation.
 * 10. A `protocol` option that disagrees with the TLS row is refused, Reason Validation:
 *     ` TCP ` under TLS on reads `protocol 'TCP' does not use TLS but TLS is on: remove it, or turn
 *     TLS off`; `tcps` under TLS off reads `protocol 'tcps' uses TLS but TLS is off`.
 * 11. No refused block writes a Connected line; every block ends in its state; no console line
 *     carries the password, DEBUG included; the run passes.
 * 12. Time zone: on a backend started with `TZ=Asia/Tokyo`, whose own `date +%z` reads `+0900`, a
 *     tracked run of `SELECT SESSIONTIMEZONE, DBTIMEZONE FROM dual` passes; `SESSIONTIMEZONE` equals
 *     `DBTIMEZONE` and is not `+09:00`.
 * 13. The help page of the SQL block (the Details dialog) reads the Oracle time zone line
 *     and the Remote Execution line word for word, and the Driver options line up to its second
 *     sentence.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  MARIADB_PORT,
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
  sessionTable,
  sessionValue,
  type SessionVariables,
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
import { removeSpawnedBackends, spawnBackend } from '../../helpers/spawn-backend'
import { withStackPassword } from '../../helpers/sql-stack'
import { openConfig } from '../canvas-lanes/lanes-helpers'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

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

const FIXTURE_FILE = 'fixture-driver-identity.json'
const TIME_ZONE_FIXTURE_FILE = 'fixture-driver-identity-timezone.json'
const BOOKEND = 'sqlid-driver-identity-done'
const PROGRAM_NAME = 'WAVE'
const STATEMENT_ONE_ROW = /^INFO Statement 1: 1 rows, \d+ ms$/

/** The zone the spawned backend runs in, with its offset as `date +%z` and as Oracle write it. */
const HOST_ZONE = 'Asia/Tokyo'
const HOST_ZONE_OFFSET = '+0900'
const HOST_ZONE_AS_ORACLE = '+09:00'
const ZONES_LINE = /^sqlid-tz host=(\S+) session=(\S+) db=(\S+)$/
const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])

// --- the exact refusals (REQ-3.4.1.19) -------------------------------------
const USE_INSTEAD = 'use Host, Port and Service name, or paste the full connect descriptor'

const aliasMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' is a TNS alias, which WAVE does not look up: ${USE_INSTEAD}`
const providerMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' names a configuration provider, which WAVE does not use: ${USE_INSTEAD}`
const directoryMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' is a directory address, which WAVE does not look up: ${USE_INSTEAD}`
const plainDescriptorMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' does not use TLS but TLS is on: use PROTOCOL=TCPS in it, or turn TLS off`
const plainAddressMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' does not use TLS but TLS is on: start it with tcps://, or turn TLS off`
const tlsDsnMessage = (value: string): string =>
  `Oracle Driver option dsn '${value}' uses TLS but TLS is off: turn TLS on, so the block's certificate rows apply`
const plainProtocolMessage = (value: string): string =>
  `Oracle Driver option protocol '${value}' does not use TLS but TLS is on: remove it, or turn TLS off`
const tlsProtocolMessage = (value: string): string =>
  `Oracle Driver option protocol '${value}' uses TLS but TLS is off: turn TLS on, so the block's certificate rows apply`

// --- the blocks ------------------------------------------------------------
/** Every address form the fixture's Oracle blocks carry, for one Oracle host. */
function oracleAddresses(host: string) {
  const hostPort = `${host}:${ORACLE_PORT}`
  const easy = `${hostPort}/${ORACLE_SERVICE_NAME}`
  const address = (protocol: string): string =>
    `(ADDRESS=(PROTOCOL=${protocol})(HOST=${host})(PORT=${ORACLE_PORT}))`
  const service = `(CONNECT_DATA=(SERVICE_NAME=${ORACLE_SERVICE_NAME}))`
  return {
    hostPort,
    easy,
    descriptor: `(DESCRIPTION=${address('TCP')}${service})`,
    mixed: `(DESCRIPTION=(ADDRESS_LIST=${address('TCPS')}${address('TCP')})${service})`,
    tcps: `tcps://${easy}`,
  }
}

type Addresses = ReturnType<typeof oracleAddresses>

interface OptionBlock {
  /** The block's Name. */
  name: string
  /** The prefix of the variables its outputs are bound to. */
  key: string
  option: 'dsn' | 'protocol'
  /** The option as the block carries it, the spaces around it included. */
  typed: (addresses: Addresses) => string
}

interface Refusal extends OptionBlock {
  /** The block's TLS row; undefined leaves the row at its default, off. */
  tls?: boolean
  message: (value: string) => string
}

const PROGRAM_BLOCKS = [
  { name: 'PG program name', rows: 'pg_rows', type: 'postgresql', product: 'PostgreSQL', port: POSTGRES_PORT },
  { name: 'MariaDB program name', rows: 'my_rows', type: 'mysql', product: 'MySQL', port: MARIADB_PORT },
  { name: 'SQL Server program name', rows: 'ms_rows', type: 'mssql', product: 'SQL Server', port: MSSQL_PORT },
  { name: 'Oracle program name', rows: 'ora_rows', type: 'oracle', product: 'Oracle', port: ORACLE_PORT },
] as const

const DSN_BLOCKS: readonly OptionBlock[] = [
  { name: 'Oracle dsn easy connect', key: 'ez', option: 'dsn', typed: (a) => a.easy },
  { name: 'Oracle dsn descriptor', key: 'ds', option: 'dsn', typed: (a) => a.descriptor },
  { name: 'Oracle dsn with spaces', key: 'sp', option: 'dsn', typed: (a) => `  ${a.easy}  ` },
]

const ALIAS: Refusal = {
  name: 'Oracle alias',
  key: 'alias',
  option: 'dsn',
  typed: () => ORACLE_SERVICE_NAME,
  message: aliasMessage,
}

const REFUSALS: readonly Refusal[] = [
  ALIAS,
  {
    name: 'Oracle config provider',
    key: 'cfg',
    option: 'dsn',
    typed: () => 'config-file:///srv/ora/app.json',
    message: providerMessage,
  },
  {
    name: 'Oracle directory ldap',
    key: 'ldap',
    option: 'dsn',
    typed: () => 'ldap://ldap.example.com/cn=orcl,cn=OracleContext',
    message: directoryMessage,
  },
  {
    name: 'Oracle directory LDAPS',
    key: 'ldaps',
    option: 'dsn',
    typed: () => 'LDAPS://ldap.example.com/cn=orcl,cn=OracleContext',
    message: directoryMessage,
  },
  {
    name: 'Oracle host and port only',
    key: 'hp',
    option: 'dsn',
    typed: (a) => `  ${a.hostPort}  `,
    message: aliasMessage,
  },
  {
    name: 'TLS on plain descriptor',
    key: 'tls_desc',
    option: 'dsn',
    typed: (a) => a.descriptor,
    tls: true,
    message: plainDescriptorMessage,
  },
  {
    name: 'TLS on mixed descriptor',
    key: 'tls_mixed',
    option: 'dsn',
    typed: (a) => a.mixed,
    tls: true,
    message: plainDescriptorMessage,
  },
  {
    name: 'TLS on plain easy connect',
    key: 'tls_easy',
    option: 'dsn',
    typed: (a) => a.easy,
    tls: true,
    message: plainAddressMessage,
  },
  {
    name: 'TLS off tcps address',
    key: 'plain_tcps',
    option: 'dsn',
    typed: (a) => a.tcps,
    tls: false,
    message: tlsDsnMessage,
  },
  {
    name: 'TLS off mixed descriptor',
    key: 'plain_mixed',
    option: 'dsn',
    typed: (a) => a.mixed,
    tls: false,
    message: tlsDsnMessage,
  },
  {
    name: 'TLS on protocol tcp',
    key: 'proto_tcp',
    option: 'protocol',
    typed: () => ' TCP ',
    tls: true,
    message: plainProtocolMessage,
  },
  {
    name: 'TLS off protocol tcps',
    key: 'proto_tcps',
    option: 'protocol',
    typed: () => 'tcps',
    tls: false,
    message: tlsProtocolMessage,
  },
]

const ALIAS_FAIL: OptionBlock = {
  name: 'Oracle alias fail',
  key: 'fail',
  option: 'dsn',
  typed: () => ORACLE_SERVICE_NAME,
}
const ALIAS_CATCH = 'Alias under Fail the block'
const TIME_ZONE_BLOCK = 'Oracle time zones'

const OPTION_BLOCKS: readonly OptionBlock[] = [...DSN_BLOCKS, ...REFUSALS, ALIAS_FAIL]

const createdTests: string[] = []

// The SQL help page, as the Details dialog of a SQL block shows it.
const HELP_TIME_ZONE =
  "An Oracle session uses the database's own time zone (DBTIMEZONE), not the time zone of the WAVE host or of a remote host"
const HELP_REMOTE_HOST =
  "Inside a Remote Execution body the block runs on the remote host, which needs nothing installed. The drivers travel with the run; Oracle's driver, WAVE's own SQLite and the TLS layer SQL Server needs travel as prebuilt builds for Python 3.10 to 3.14 on x86_64 or aarch64 with glibc 2.17 or newer, or musl 1.2 or newer. A host with a newer Python, another processor or another C library, or one too old to load a build, fails the block with reason Unsupported. SQLite also needs glibc 2.28 or newer on the remote host; an older one fails the block the same way"
const HELP_DRIVER_OPTIONS =
  "Driver options: Extra connection options handed to the driver under the driver's own names, except on SQLite: its two names are WAVE's own. See Databases for them and for the common ones."

// --- the fixtures ----------------------------------------------------------
function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Fixture
}

function blockOf(fixture: Fixture, name: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.label === name)
  expect(found, `the fixture must declare one block named "${name}"`).toHaveLength(1)
  return found[0]
}

function valuesOf(fixture: Fixture, name: string): Record<string, unknown> {
  return blockOf(fixture, name).data.config.values
}

/** The block dials the stack's database as the stack's user and stores no password. */
function expectStackRows(
  fixture: Fixture,
  name: string,
  databaseType: string,
  port: string,
  database: string,
): void {
  const values = valuesOf(fixture, name)
  expect(values.database_type, `"${name}" picks the database type`).toBe(databaseType)
  expect(values.host, `"${name}" carries the host the import expects`).toBe(SSH_FIXTURE_HOST_SENTINEL)
  expect(String(values.port), `"${name}" carries its Port row`).toBe(port)
  expect(values.database, `"${name}" names the stack's database`).toBe(database)
  expect(values.username, `"${name}" logs in as the stack's user`).toBe(SQL_STACK_USER)
  expect(values.password, `"${name}" stores no password`).toBe('')
}

/** The fixture is the Test the pass criteria describe, written for the host-mode address. */
function expectFixtureBlocks(fixture: Fixture): void {
  const sentinel = oracleAddresses(SSH_FIXTURE_HOST_SENTINEL)
  for (const block of PROGRAM_BLOCKS) {
    const database = block.type === 'oracle' ? ORACLE_SERVICE_NAME : SQL_STACK_DATABASE
    expectStackRows(fixture, block.name, block.type, block.port, database)
    const values = valuesOf(fixture, block.name)
    expect(values, `"${block.name}" carries no Driver option of its own`).not.toHaveProperty('driver_options')
    expect(values.on_error, `"${block.name}" fails the block on error`).toBe('fail')
  }
  for (const block of OPTION_BLOCKS) {
    const listens = DSN_BLOCKS.includes(block) ? NETCAT_CLOSED_PORT : ORACLE_PORT
    expectStackRows(fixture, block.name, 'oracle', listens, ORACLE_SERVICE_NAME)
    expect(valuesOf(fixture, block.name).driver_options, `the Driver options of "${block.name}"`).toEqual({
      [block.option]: block.typed(sentinel),
    })
  }
  for (const block of REFUSALS) {
    const values = valuesOf(fixture, block.name)
    expect(values.on_error, `"${block.name}" records and continues`).toBe('record')
    expect(values.tls, `the TLS row of "${block.name}"`).toBe(block.tls)
  }
  for (const block of [...DSN_BLOCKS, ALIAS_FAIL]) {
    expect(valuesOf(fixture, block.name).on_error, `"${block.name}" fails the block on error`).toBe('fail')
  }
}

/** A copy whose Oracle Driver options name the Oracle host of this mode. */
function withOracleAddresses(fixture: Fixture, host: string): Fixture {
  const copy = JSON.parse(JSON.stringify(fixture)) as Fixture
  const addresses = oracleAddresses(host)
  for (const block of OPTION_BLOCKS) {
    valuesOf(copy, block.name).driver_options = { [block.option]: block.typed(addresses) }
  }
  return copy
}

// --- reading a run back ----------------------------------------------------
/** Every line one SQL block wrote above DEBUG, as "LEVEL message". */
function blockLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('SQL', name)
  return entries
    .filter((entry) => entry.source === source && entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message}`)
}

/** The block connected and read one row: its two lines, and the server version the first names. */
function expectConnected(
  entries: readonly LogEntry[],
  name: string,
  product: string,
  where: string,
): string {
  const lines = blockLines(entries, name)
  const context = `the console lines of "${name}".\n${formatEntries(entries)}`
  const connected = new RegExp(
    `^INFO Connected to ${escapeRegExp(product)} (\\S+) at ${escapeRegExp(where)}$`,
  )
  expect(lines, context).toHaveLength(2)
  const hits = lines.map((line) => connected.exec(line)).filter((hit) => hit !== null)
  expect(hits, `"${name}" logs "Connected to ${product} {version} at ${where}" once: ${context}`).toHaveLength(1)
  expect(
    lines.filter((line) => STATEMENT_ONE_ROW.test(line)),
    `"${name}" logs its one statement with one row: ${context}`,
  ).toHaveLength(1)
  return (hits[0] as RegExpExecArray)[1]
}

/** The block's DEBUG echo of what it received. */
function inputsLine(entries: readonly LogEntry[], name: string): string {
  const source = blockSource('SQL', name)
  const inputs = entries.filter(
    (entry) => entry.source === source && entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
  )
  expect(inputs, `DEBUG is on: "${name}" echoes its inputs once`).toHaveLength(1)
  return inputs[0].message
}

// --- the API of a spawned backend ------------------------------------------
type Json = Record<string, unknown>

/** The `data` member of an answer, with the whole answer beside it. */
interface Answer {
  body: Json
  data: Json
}

async function answerOf(
  verb: string,
  url: string,
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
): Promise<Answer> {
  const body = ((await response.json().catch(() => null)) ?? {}) as Json
  expect(response.ok(), `${verb} ${url} failed: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { body, data: (body.data ?? {}) as Json }
}

async function send(request: APIRequestContext, url: string, data?: Json): Promise<Answer> {
  return answerOf('POST', url, await request.post(url, data === undefined ? {} : { data }))
}

async function read(request: APIRequestContext, url: string): Promise<Answer> {
  return answerOf('GET', url, await request.get(url))
}

/** Start a tracked run of a saved Test on the backend at `baseUrl` and wait for its verdict. */
async function runTracked(
  request: APIRequestContext,
  baseUrl: string,
  testId: string,
  environmentId: string,
): Promise<{ executionId: string; verdict: string }> {
  const started = await send(request, `${baseUrl}/executions`, {
    type: 'test',
    id: testId,
    environment_id: environmentId,
  })
  const executionId = String(started.data.id)
  let verdict = ''
  await expect
    .poll(
      async () => {
        verdict = String((await read(request, `${baseUrl}/executions/${executionId}`)).data.status ?? '')
        return TERMINAL_STATUSES.has(verdict)
      },
      {
        timeout: 120_000,
        intervals: [200, 500, 1_000],
        message: `execution ${executionId} did not reach a terminal status`,
      },
    )
    .toBe(true)
  return { executionId, verdict }
}

// --- suite -----------------------------------------------------------------
test.describe('V-PLUGIN-SQL-DRIVER-IDENTITY-FUNCTIONAL: program name, Oracle dsn and time zone', () => {
  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('the program name, a full Oracle dsn, and every Oracle option refused before connecting', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const template = loadFixture(FIXTURE_FILE)
    expectFixtureBlocks(template)
    const addresses = oracleAddresses(SQL_TARGET_HOST)
    const fixture = withStackPassword(withOracleAddresses(template, SQL_TARGET_HOST))
    const idOf = (name: string): string => blockOf(fixture, name).id
    const expectedError = (block: Refusal): string => block.message(block.typed(addresses).trim())

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

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const aliasError = aliasMessage(ORACLE_SERVICE_NAME)
    let oracleVersion = ''

    await test.step('every block ends in the state its permutation calls for', async () => {
      const recorded = REFUSALS.map((block) => idOf(block.name))
      const failed = idOf(ALIAS_FAIL.name)
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

    await test.step('the program name reads WAVE on all four databases (REQ-3.4.1.19)', () => {
      for (const block of PROGRAM_BLOCKS) {
        const version = expectConnected(entries, block.name, block.product, `${SQL_TARGET_HOST}:${block.port}`)
        if (block.type === 'oracle') oracleVersion = version
        const rows = sessionTable(variables, block.rows)
        expect(rows.columns, `"${block.name}" returns one column`).toHaveLength(1)
        expect(rows.rows, `the program name ${block.product} holds for the session`).toEqual([[PROGRAM_NAME]])
      }
    })

    await test.step('a full dsn connects, whatever the Port row says', () => {
      for (const block of DSN_BLOCKS) {
        const typed = block.typed(addresses)
        const version = expectConnected(entries, block.name, 'Oracle', typed.trim())
        expect(version, `"${block.name}" reached the stack's Oracle`).toBe(oracleVersion)
        expect(sessionValue(variables, `${block.key}_ok`), `"${block.name}" succeeds`).toBe(true)
        expect(sessionValue(variables, `${block.key}_count`), `"${block.name}" reads its row`).toBe(1)
      }
    })

    await test.step('an option reaches the block as typed and is named without its spaces', () => {
      const spaced = OPTION_BLOCKS.filter((block) => block.typed(addresses) !== block.typed(addresses).trim())
      expect(
        spaced.map((block) => block.name),
        'the blocks whose option has spaces around it',
      ).toEqual(['Oracle dsn with spaces', 'Oracle host and port only', 'TLS on protocol tcp'])
      for (const block of spaced) {
        expect(inputsLine(entries, block.name), `"${block.name}" received the spaces`).toContain(
          `"driver_options":{${JSON.stringify(block.option)}:${JSON.stringify(block.typed(addresses))}}`,
        )
      }
    })

    for (const block of REFUSALS) {
      await test.step(`refused before connecting: ${block.name} (SQL-5)`, () => {
        const error = expectedError(block)
        expect(
          blockLines(entries, block.name),
          `the console lines of "${block.name}".\n${formatEntries(entries)}`,
        ).toEqual([`WARN Run SQL failed (Validation): ${error}`])
        expect(sessionValue(variables, `${block.key}_ok`), `Success of "${block.name}"`).toBe(false)
        expect(sessionValue(variables, `${block.key}_reason`), `Reason of "${block.name}"`).toBe('Validation')
        expect(sessionValue(variables, `${block.key}_error`), `Error of "${block.name}"`).toBe(error)
      })
    }

    await test.step('the alias refusal under Fail the block fails the block and is caught', () => {
      expect(inputsLine(entries, ALIAS_FAIL.name), `"${ALIAS_FAIL.name}" ran with its dsn`).toContain(
        `"driver_options":{"dsn":${JSON.stringify(ORACLE_SERVICE_NAME)}}`,
      )
      expect(
        blockLines(entries, ALIAS_FAIL.name),
        `"${ALIAS_FAIL.name}" writes no line above DEBUG.\n${formatEntries(entries)}`,
      ).toEqual([])
      expectConsoleLine(entries, 'ERROR', `Block '${ALIAS_FAIL.name}' failed: ${aliasError}`)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${aliasError}`)
      expectConsoleLine(entries, 'INFO', `sqlid-alias-caught ${aliasError}`)
      const caught = sessionValue(variables, 'fail_error') as Record<string, unknown>
      expect(sessionValue(variables, 'fail_caught'), `"${ALIAS_CATCH}" caught the failure`).toBe(true)
      expect(caught.message, 'the caught error is the refusal, unchanged').toBe(aliasError)
      expect(caught.node, 'the caught error names the SQL block').toBe(ALIAS_FAIL.name)
      expect(caught.node_id, 'the caught error points at the SQL block').toBe(idOf(ALIAS_FAIL.name))
    })

    await test.step('the password never reaches the console, DEBUG included', () => {
      const text = entries.map((entry) => entry.message).join('\n')
      expect(text, 'the stack password stays out of the console').not.toContain(SQL_STACK_PASSWORD)
    })
  })

  test('the SQL help page states the time zone, the remote host and the Driver options rules', async ({ page }) => {
    const fixture = withStackPassword(withOracleAddresses(loadFixture(FIXTURE_FILE), SQL_TARGET_HOST))
    const sqlBlock = fixture.workflow.nodes.find((node) => node.data.elementType === 'sql-client')
    expect(sqlBlock, 'the fixture holds a SQL block').toBeDefined()

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(
      page,
      injectServiceHost(fixture as unknown as Record<string, unknown>, SQL_TARGET_HOST),
      { rejectRepairs: true },
    )
    createdTests.push(testId)

    const sheet = await openConfig(page, sqlBlock!.id)
    await sheet.getByRole('button', { name: 'Details', exact: true }).click()
    const help = page.getByTestId('details-scroll')
    await expect(help, 'the help page of the SQL block is open').toBeVisible()

    await test.step('the three lines read word for word', async () => {
      await expect(help.getByRole('listitem').filter({ hasText: 'An Oracle session uses' })).toHaveText(HELP_TIME_ZONE)
      await expect(help.getByRole('listitem').filter({ hasText: 'Inside a Remote Execution body' })).toHaveText(
        HELP_REMOTE_HOST,
      )
      await expect(help.getByRole('listitem').filter({ hasText: 'Driver options: Extra connection options' })).toContainText(
        HELP_DRIVER_OPTIONS,
      )
    })
  })

  test('an Oracle session on a host outside UTC uses the time zone of the database', async ({ request }) => {
    test.setTimeout(240_000)

    const template = loadFixture(TIME_ZONE_FIXTURE_FILE)
    expectStackRows(template, TIME_ZONE_BLOCK, 'oracle', ORACLE_PORT, ORACLE_SERVICE_NAME)
    expect(
      valuesOf(template, TIME_ZONE_BLOCK),
      `"${TIME_ZONE_BLOCK}" carries no Driver option of its own`,
    ).not.toHaveProperty('driver_options')
    const fixture = injectServiceHost(
      withStackPassword(template) as unknown as Record<string, unknown>,
      SQL_TARGET_HOST,
    )

    const backend = await spawnBackend({ env: { TZ: HOST_ZONE } })
    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()
    const base = backend.baseUrl

    const environment = await send(request, `${base}/environments`, {
      name: E2E_ENV_NAME,
      description: 'Environment of the time zone run',
    })
    const saved = await send(request, `${base}/tests`, fixture)
    expect(
      saved.body.repairs ?? [],
      `POST /tests repaired the fixture: ${JSON.stringify(saved.body.repairs)}`,
    ).toEqual([])
    const testId = String(saved.data.id)
    const validation = await send(request, `${base}/tests/${testId}/validate?context=run`)
    expect(
      validation.data.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.data.errors)}`,
    ).toEqual([])

    const run = await runTracked(request, base, testId, String(environment.data.id))
    const logs = await read(request, `${base}/executions/${run.executionId}/logs?limit=1000`)
    const entries = (logs.data.entries as Array<Record<string, string>>).map((entry) => ({
      level: entry.level,
      source: entry.source,
      message: entry.message,
    }))
    expect(run.verdict, `the run on the spawned backend.\n${formatEntries(entries)}`).toBe('passed')

    expectConnected(entries, TIME_ZONE_BLOCK, 'Oracle', `${SQL_TARGET_HOST}:${ORACLE_PORT}`)
    const zones = entries.map((entry) => ZONES_LINE.exec(entry.message)).filter((hit) => hit !== null)
    expect(zones, `the run logs its zones once.\n${formatEntries(entries)}`).toHaveLength(1)
    const [, hostOffset, sessionZone, databaseZone] = zones[0] as RegExpExecArray

    expect(hostOffset, `the spawned backend runs in ${HOST_ZONE}`).toBe(HOST_ZONE_OFFSET)
    expect(sessionZone, 'SESSIONTIMEZONE is the database time zone').toBe(databaseZone)
    expect(sessionZone, 'SESSIONTIMEZONE is not the time zone of the WAVE host').not.toBe(HOST_ZONE_AS_ORACLE)
  })
})
