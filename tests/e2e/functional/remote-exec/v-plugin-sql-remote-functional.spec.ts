/**
 * V-PLUGIN-SQL-REMOTE-FUNCTIONAL: the SQL block inside a Remote Execution body
 * Wireframe: N/A
 * Design Decisions: SQL-2, SQL-3, SQL-8, SQL-9, SQL-15, EXEC-25
 * REQ: REQ-3.4.1.6, REQ-5.1.4
 *
 * Pass Criteria:
 * 1. The fixture imports and validates with zero errors; the run passes, every Block succeeds,
 *    and every Block inside the body carries the R locus badge.
 * 2. The remote host has none of the database drivers installed, the SQLite build included, and
 *    its own Python carries another SQLite version than WAVE's.
 * 3. SQLite on the WAVE host: "Connected to SQLite {version} at {file}" names this run's artifact
 *    file, `sqlite_version()` is that version, and the bound `:tag` is back in Rows.
 * 4. A SQL block saved with no Database type, on the PostgreSQL rows on WAVE: "Connected to
 *    PostgreSQL {version} at {host}:{port}" on the direct leg.
 * 5. PostgreSQL by its compose name on the remote host: "Connected to PostgreSQL {version} at
 *    postgres:5432"; the server sees the remote host as the client; the `:tag` value is bound;
 *    Rows holds the two rows written, Row count 2, Rows changed 2.
 * 6. MariaDB by its compose name: connected at mariadb:3306, database wave, the remote host as
 *    the client.
 * 7. The block with no Database type inside the body: connected to PostgreSQL at postgres:5432,
 *    the remote host as the client.
 * 8. SQL Server with TLS off inside the body, ahead of every Oracle and TLS block: connected at
 *    mssql:1433, encrypt_option FALSE, the remote host as the client.
 * 9. After those four blocks the worker's scratch dir holds no wheel: their drivers travel as
 *    source.
 * 10. SQLite inside the body: "Connected to SQLite {version} at {file}" names this run's file on
 *     the remote host with the same version as on WAVE, and `sqlite_version()` is that version.
 *     Right after it the scratch dir holds the SQLite build (apsw) alone, built for the remote
 *     host's own Python, CPU and glibc.
 * 11. Oracle by its compose name: connected at oracle:1521, service freepdb1, the remote host as
 *     the client, the bound `:tag` back in Rows.
 * 12. SQL Server by its compose name over TLS with Verify Server Certificate on: connected at
 *     mssql:1433, encrypt_option TRUE, the remote host as the client.
 * 13. After Oracle and SQL Server the same scratch dir holds the carried wheel set (apsw, cffi,
 *     cryptography, oracledb, pyopenssl, typing_extensions), and Oracle's build tags match the
 *     remote host's own Python, CPU and glibc as read over SSH.
 * 14. The outputs come back to WAVE: a Log on WAVE reads Row count, Rows changed and cells of all
 *     four Rows tables, and a SQL Block on WAVE reads the two rows written on the remote host
 *     back over the direct leg, then drops the table.
 * 15. After the run the worker's scratch dir is no longer on the remote host and no build is left
 *     where it stood; the SQLite file the body wrote is on the remote host until the run removes
 *     its folder.
 * 16. The session close lists the one session, the run ends on the bookend, and the database
 *     password never reaches the console.
 *
 * An Execution Host outside the carried Python / CPU / libc set, or one that cannot load the
 * bundled SQLite, has no E2E case: the stack holds no such host, and the backend unit tests
 * prove the Unsupported messages.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getTest } from '../../helpers/element-types'
import { escapeRegExp, getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
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
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  MARIADB_INTERNAL_PORT,
  MARIADB_SERVICE,
  MSSQL_INTERNAL_PORT,
  MSSQL_SERVICE,
  ORACLE_INTERNAL_PORT,
  ORACLE_SERVICE,
  ORACLE_SERVICE_NAME,
  POSTGRES_INTERNAL_PORT,
  POSTGRES_PORT,
  POSTGRES_SERVICE,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
} from '../../helpers/config'
import { withStackPassword } from '../../helpers/sql-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    expressionFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface FixtureEdge {
  source: string
  target: string
  sourceHandle?: string
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: FixtureEdge[] }
  variables: Record<string, { value: unknown; type: string; scope: string; secret?: boolean }>
  [key: string]: unknown
}


// --- fixture node ids ----------------------------------------------------
const NODE = {
  sshOpen: 'e546d9d3-6471-4c41-bc17-b98c74379368',
  sshHost: 'cbb18e19-1e55-4734-8894-390ea0065ad9',
  sshAddrs: '2dd2f35d-fee6-491a-8f4b-c6df17db1f15',
  sshPlatform: '7df242f4-60ea-4c31-a00c-3be67bde5701',
  sshDrivers: '3c059177-e822-4fb9-8d3a-87823407069b',
  logHost: '3ab2ea97-5db0-44b0-8e0b-abf95b67560d',
  sshOwnSqlite: '67838162-38e8-4d7e-926f-f15746048d69',
  sshLiteDir: '2d5d4450-da07-476e-90b2-545f84153914',
  sqlLiteWave: 'cf7d3ca8-bb17-44f9-a02f-4d8bbeb9d2cd',
  sqlPlainWave: 'bf2e95b8-4f90-4898-b932-c7b9f1e4620f',
  container: '841008d7-4b7c-43f1-92cf-5e329f704fbf',
  sqlPg: '6a0a7492-5df9-4ff2-aeaf-c18d40f87765',
  sqlMy: 'ae76d8ab-6feb-4ed2-a554-60a1498f98fd',
  sqlPlainRemote: '2562c1c3-d938-4acc-8a63-dbd5898a97d3',
  sqlMsPlain: 'c475abcb-afa0-4d96-aa96-27f7dbadf051',
  pyProbeA: '34093a51-f828-4b63-9dff-e103475ae404',
  sqlLiteRemote: 'bca844c6-e174-4d9a-8639-b2551316c697',
  pyProbeLite: '85377022-edb0-4806-b1e6-beb8dcc2d50b',
  sqlOra: '702c7e97-e26c-496a-8740-87414b005935',
  sqlMs: '14944a7f-69f4-4e67-8287-6819a67f878d',
  pyProbeB: 'e68517df-1622-440a-a01f-ef06d6e56446',
  logRemote: 'df1aef41-d11b-4447-8a57-7153365f6da6',
  sqlBack: '9d991b75-de33-47ba-8fb6-9c303d4bd440',
  logBack: '97cc9c8e-a8b7-4391-840f-a598a14279e9',
  sshWorkerGone: '8f269305-cd08-4a21-8cdc-ef59f3ed4d03',
  sshBuildsLeft: 'a008458b-749d-4920-b28c-a62f83c9eb07',
  sshLiteFolder: '8304d574-c0b7-4707-9036-6d9695a5b04d',
  sshClose: 'e7a117f5-7f99-4fe4-9d9d-7dd3f5b45388',
  logDone: '3ff73472-9d4d-4b74-acb0-30d6395b5fc4',
} as const

/** The body in run order: the blocks that carry nothing run ahead of every block that does. */
const BODY_IDS = [
  NODE.sqlPg,
  NODE.sqlMy,
  NODE.sqlPlainRemote,
  NODE.sqlMsPlain,
  NODE.pyProbeA,
  NODE.sqlLiteRemote,
  NODE.pyProbeLite,
  NODE.sqlOra,
  NODE.sqlMs,
  NODE.pyProbeB,
] as const

/** The SQL blocks with a Name of their own; every other SQL block keeps the type's (EXEC-25). */
const SQL_NAME = {
  liteWave: 'SQLite on WAVE',
  plainWave: 'No Database type on WAVE',
  plainRemote: 'No Database type remote',
  msPlain: 'SQL Server TLS off',
  liteRemote: 'SQLite remote',
} as const

const BOOKEND = 'sql-remote-e2e-done'
const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
const WORKER_DIR = /^\/tmp\/wave-worker-[A-Za-z0-9_]+$/
const SQLITE_CONNECTED = /^Connected to SQLite (\d+\.\d+\.\d+) at (\/.+)$/

/** The packages SQLite, Oracle and SQL Server TLS travel as, one wheel each (SQL-15). */
const CARRIED_PACKAGES = ['apsw', 'cffi', 'cryptography', 'oracledb', 'pyopenssl', 'typing_extensions']

/** Each network SQL Block in the body: its node, the database it dials by compose name, and its row. */
const REMOTE_SQL = [
  { id: NODE.sqlPg, host: POSTGRES_SERVICE, port: POSTGRES_INTERNAL_PORT, database: SQL_STACK_DATABASE, tls: false },
  { id: NODE.sqlMy, host: MARIADB_SERVICE, port: MARIADB_INTERNAL_PORT, database: SQL_STACK_DATABASE, tls: false },
  { id: NODE.sqlPlainRemote, host: POSTGRES_SERVICE, port: POSTGRES_INTERNAL_PORT, database: SQL_STACK_DATABASE, tls: false },
  { id: NODE.sqlMsPlain, host: MSSQL_SERVICE, port: MSSQL_INTERNAL_PORT, database: SQL_STACK_DATABASE, tls: false },
  { id: NODE.sqlOra, host: ORACLE_SERVICE, port: ORACLE_INTERNAL_PORT, database: ORACLE_SERVICE_NAME, tls: false },
  { id: NODE.sqlMs, host: MSSQL_SERVICE, port: MSSQL_INTERNAL_PORT, database: SQL_STACK_DATABASE, tls: true },
] as const

/** Load the fixture with the run's own table and tag, the stack's password and its CA as the trust anchor. */
function loadFixture(token: string): Fixture {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-sql.json'), 'utf-8')
  expect(raw.includes('__TOKEN__'), 'the fixture names its table with the run placeholder').toBe(true)
  expect(raw.includes(SQL_STACK_PASSWORD), 'the fixture stores no database password').toBe(false)
  const fixture = withToken(JSON.parse(raw) as Fixture, token)
  fixture.variables.ca_pem.value = CA_CERT_PEM
  return withStackPassword(fixture)
}

function nodeOf(fixture: Fixture, id: string): FixtureNode {
  const found = fixture.workflow.nodes.find((entry) => entry.id === id)
  expect(found, `the fixture must declare a node "${id}"`).toBeTruthy()
  return found as FixtureNode
}

function valuesOf(fixture: Fixture, id: string): Record<string, unknown> {
  return nodeOf(fixture, id).data.config.values
}

/** The body's blocks in run order, followed along the fixture's connections. */
function bodyOrder(fixture: Fixture): string[] {
  const edges = fixture.workflow.edges
  const order: string[] = []
  let next = edges.find((edge) => edge.source === NODE.container && edge.sourceHandle === 'body')
  while (next && order.length < fixture.workflow.nodes.length) {
    const reached = next.target
    order.push(reached)
    next = edges.find((edge) => edge.source === reached)
  }
  return order
}

/** The legs this spec adds: what each block is named, what it leaves out and where its file is. */
function expectAddedLegs(fixture: Fixture, token: string): void {
  expect(bodyOrder(fixture), 'the body runs its blocks in this order').toEqual([...BODY_IDS])

  const named: Array<[string, string]> = [
    [NODE.sqlLiteWave, SQL_NAME.liteWave],
    [NODE.sqlPlainWave, SQL_NAME.plainWave],
    [NODE.sqlPlainRemote, SQL_NAME.plainRemote],
    [NODE.sqlMsPlain, SQL_NAME.msPlain],
    [NODE.sqlLiteRemote, SQL_NAME.liteRemote],
  ]
  for (const [id, name] of named) {
    expect(nodeOf(fixture, id).data.label, `the block ${id} carries its own Name`).toBe(name)
  }

  for (const id of [NODE.sqlPlainWave, NODE.sqlPlainRemote]) {
    expect(Object.keys(valuesOf(fixture, id)), 'the block sets no Database type').not.toContain(
      'database_type',
    )
  }
  const plainWave = valuesOf(fixture, NODE.sqlPlainWave)
  expect(plainWave.host, 'the block on WAVE carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(plainWave.port)).toBe(POSTGRES_PORT)
  expect(plainWave.database).toBe(SQL_STACK_DATABASE)
  expect(plainWave.username).toBe(SQL_STACK_USER)

  const liteWave = valuesOf(fixture, NODE.sqlLiteWave)
  const liteRemote = valuesOf(fixture, NODE.sqlLiteRemote)
  expect(liteWave.database_type).toBe('sqlite')
  expect(liteRemote.database_type).toBe('sqlite')
  expect(liteWave.file, 'SQLite on WAVE opens an artifact file named for this run').toBe(
    `artifact://sqlrem-${token}.db`,
  )
  expect(
    nodeOf(fixture, NODE.sqlLiteRemote).data.expressionFields,
    'the remote File is an expression',
  ).toEqual(['file'])
  expect(liteRemote.file, 'SQLite on the remote host opens a file in the folder made over SSH').toBe(
    "lite_dir.strip() + '/remote.db'",
  )
  expect(liteRemote.sql, 'both SQLite blocks run the same script').toBe(liteWave.sql)
  expect(liteRemote.parameters, 'both SQLite blocks bind the same value').toEqual(liteWave.parameters)
  expect(String(liteWave.sql)).toContain('sqlite_version()')
}

/** The fixture must carry the harness constants, not copies that drifted. */
function expectStackTargets(fixture: Fixture): void {
  const ssh = valuesOf(fixture, NODE.sshOpen)
  expect(ssh.host, 'the SSH block carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(ssh.port), 'the SSH block targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(ssh.username).toBe(SSH_STACK_USER)
  expect(ssh.password, 'the password comes from the secret test variable').toBe('ssh_pwd')
  expect(fixture.variables.ssh_pwd.secret).toBe(true)
  expect(fixture.variables.ssh_pwd.value).toBe(SSH_STACK_PASSWORD)

  for (const block of REMOTE_SQL) {
    const values = valuesOf(fixture, block.id)
    expect(values.host, 'the body dials the compose name only the remote host resolves').toBe(
      block.host,
    )
    expect(String(values.port)).toBe(block.port)
    expect(values.database).toBe(block.database)
    expect(values.username).toBe(SQL_STACK_USER)
    expect(values.password).toBe(SQL_STACK_PASSWORD)
    expect(values.tls).toBe(block.tls)
    if (block.tls) {
      expect(values.verify_ssl, 'Verify Server Certificate is on').toBe(true)
      expect(values.ca_cert, 'the CA row reads the stack CA variable').toBe('ca_pem')
    }
  }

  const back = valuesOf(fixture, NODE.sqlBack)
  expect(back.host, 'the read-back on WAVE carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(back.port)).toBe(POSTGRES_PORT)
}

/** SSH blocks go to the SSH stack host, the direct SQL block to the database host. */
function injectHosts(fixture: Fixture): Fixture {
  for (const node of fixture.workflow.nodes) {
    const target = node.data.elementType === 'sql-client' ? SQL_TARGET_HOST : SSH_TARGET_HOST
    node.data.config.values = injectServiceHost(node.data.config.values, target)
  }
  return fixture
}

// --- session variables ---------------------------------------------------
function text(vars: SessionVariables, name: string): string {
  return String(sessionValue(vars, name)).trim()
}

/** Every row of a table as a column-name map. */
function records(vars: SessionVariables, name: string): Array<Record<string, unknown>> {
  const table = sessionTable(vars, name)
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column.name, row[index]])),
  )
}

function onlyRecord(vars: SessionVariables, name: string): Record<string, unknown> {
  const rows = records(vars, name)
  expect(rows, `"${name}" holds one row`).toHaveLength(1)
  return rows[0]
}

function listOf(vars: SessionVariables, name: string): string[] {
  const value = sessionValue(vars, name)
  expect(vars[name].type, `"${name}" binds an array`).toBe('array')
  return value as string[]
}

/** A dist-info directory name without its version: `cffi-2.0.0.dist-info` -> `cffi`. */
const packageOf = (distInfo: string): string => distInfo.replace(/-[^-]+\.dist-info$/, '')

/** Console entries with their full Source, read once the bookend line is among them. */
async function copiedEntries(page: Page): Promise<LogEntry[]> {
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
        return entries.some((entry) => entry.message.includes(BOOKEND))
      },
      { timeout: 30_000, message: `expected the console copy text to hold "${BOOKEND}"` },
    )
    .toBe(true)
  return entries
}

/** Every body member shows one R badge; nothing outside the body shows one. */
async function expectRemoteLocusBadges(page: Page): Promise<void> {
  for (const id of BODY_IDS) {
    const badge = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    await expect(badge, `${id} is a remotable block inside the body`).toHaveCount(1)
    await expect(badge, `${id} runs on the remote host`).toHaveAttribute('data-locus', 'R')
  }
  for (const id of Object.values(NODE).filter((entry) => !(BODY_IDS as readonly string[]).includes(entry))) {
    await expect(
      page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`),
      `${id} sits outside the body, so it carries no locus badge`,
    ).toHaveCount(0)
  }
}

let createdTestId: string | null = null

test.describe('V-PLUGIN-SQL-REMOTE-FUNCTIONAL: the SQL block inside a Remote Execution body', () => {
  test.beforeEach(() => {
    createdTestId = null
  })

  test.afterEach(async ({ request }) => {
    if (!createdTestId) return
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const resp = await request.delete(`${BACKEND_URL}/tests/${createdTestId}`)
    expect([204, 404], `teardown must remove the imported Test, got ${resp.status()}`).toContain(
      resp.status(),
    )
    createdTestId = null
  })

  test('runs on the remote host with carried drivers and leaves nothing behind', async ({ page }) => {
    test.setTimeout(300_000)

    // The databases and the sshd host are shared by every shard, so this run owns its names.
    const token = newToken()
    const tag = `sqlrem-${token}`
    const fixture = loadFixture(token)
    expectStackTargets(fixture)
    expectAddedLegs(fixture, token)

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, injectHosts(fixture))
    createdTestId = testId

    await test.step('the imported workflow validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `the remote fixture must validate clean. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    await test.step('the saved Test keeps two blocks without a Database type (SQL-8)', async () => {
      const saved = (await getTest(page.request, testId)) as { workflow: { nodes: FixtureNode[] } }
      for (const id of [NODE.sqlPlainWave, NODE.sqlPlainRemote]) {
        const node = saved.workflow.nodes.find((entry) => entry.id === id)
        expect(node, `the saved Test holds the block ${id}`).toBeTruthy()
        expect(
          Object.keys((node as FixtureNode).data.config.values),
          'the import filled in no Database type',
        ).not.toContain('database_type')
      }
    })

    await test.step('the canvas marks every body block as running on the remote host', async () => {
      await expectRemoteLocusBadges(page)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND, 240_000)
    const all = logs.join('\n')
    const entries = await copiedEntries(page)
    const vars = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables

    const sshAddresses = text(vars, 'ssh_addrs').split(/\s+/)
    const [pythonTag, machine, libc] = text(vars, 'ssh_platform').split(' ')
    const buildFits = new RegExp(`^${pythonTag}-${pythonTag}-manylinux\\w*_${machine}$`)
    const expectFromRemoteHost = (client: unknown, what: string): void => {
      expect(
        sshAddresses,
        `${what} must see the remote host (${sshAddresses.join(' ')}) as its client`,
      ).toContain(String(client))
    }
    const connectedLines = (block: string): LogEntry[] =>
      entries.filter(
        (entry) =>
          entry.source === blockSource('SQL', block) && entry.message.startsWith('Connected to '),
      )
    const expectConnected = (database: string, host: string, port: string, block = ''): void => {
      const pattern = new RegExp(`^Connected to ${database} \\S+ at ${escapeRegExp(host)}:${port}$`)
      expect(
        connectedLines(block)
          .filter((entry) => pattern.test(entry.message))
          .map((entry) => entry.level),
        `expected one INFO line matching ${pattern} from "${blockSource('SQL', block)}".\n${all}`,
      ).toEqual(['INFO'])
    }
    const sqliteConnected = (block: string): { version: string; file: string } => {
      const lines = connectedLines(block)
      expect(
        lines.map((entry) => entry.level),
        `expected one INFO Connected line from "${blockSource('SQL', block)}".\n${all}`,
      ).toEqual(['INFO'])
      const match = SQLITE_CONNECTED.exec(lines[0].message)
      expect(match, `"${lines[0].message}" names SQLite, its version and its file`).not.toBeNull()
      const [, version, file] = match as RegExpExecArray
      return { version, file }
    }
    let bundledVersion = ''

    await test.step('every block ended successful and the run passed', async () => {
      await expectNodesSuccess(page, Object.values(NODE))
      expect(String(sessionValue(vars, 'rsid')), 'the container binds a worker handle').toMatch(
        /^[0-9a-f]{32}$/,
      )
    })

    await test.step('the remote host has no database driver installed (SQL-15)', () => {
      expect(text(vars, 'ssh_drivers'), 'nothing is installed there for the block').toBe('none')
      expect(sshAddresses.length, 'the remote host reports its own address').toBeGreaterThan(0)
      expect(logs).toContain(
        `sqlrem-host host=${text(vars, 'ssh_host')} platform=${text(vars, 'ssh_platform')} drivers=none`,
      )
    })

    await test.step('SQLite runs on the WAVE host on the bundled build (SQL-15)', () => {
      const connected = sqliteConnected(SQL_NAME.liteWave)
      bundledVersion = connected.version
      expect(path.posix.basename(connected.file), 'the block opened the artifact file of this run').toBe(
        `sqlrem-${token}.db`,
      )
      expect(sessionValue(vars, 'lw_ok')).toBe(true)
      expect(
        onlyRecord(vars, 'lw_rows'),
        'sqlite_version() is the version the Connected line names, beside the bound :tag',
      ).toEqual({ lib: bundledVersion, label: tag })
      expect(sessionValue(vars, 'lw_changed'), 'Rows changed counts the INSERT').toBe(1)
    })

    await test.step('a block with no Database type is PostgreSQL on WAVE (SQL-8)', () => {
      expectConnected('PostgreSQL', SQL_TARGET_HOST, POSTGRES_PORT, SQL_NAME.plainWave)
      expect(sessionValue(vars, 'pw_ok')).toBe(true)
      expect(onlyRecord(vars, 'pw_rows')).toEqual({ db: SQL_STACK_DATABASE })
    })

    await test.step('PostgreSQL runs on the remote host with its driver carried as source', () => {
      expectConnected('PostgreSQL', POSTGRES_SERVICE, POSTGRES_INTERNAL_PORT)
      expect(sessionValue(vars, 'pg_ok')).toBe(true)
      const rows = records(vars, 'pg_rows')
      expect(rows.map((row) => row.label), 'the bound :tag, then the literal row').toEqual([
        tag,
        'written-on-the-remote-host',
      ])
      for (const row of rows) {
        expectFromRemoteHost(row.client_addr, 'PostgreSQL')
        expect(row.db).toBe(SQL_STACK_DATABASE)
      }
      expect(sessionValue(vars, 'pg_count')).toBe(2)
      expect(sessionValue(vars, 'pg_changed'), 'Rows changed sums the INSERT').toBe(2)
    })

    await test.step('MariaDB runs on the remote host with its driver carried as source', () => {
      expectConnected('MySQL', MARIADB_SERVICE, MARIADB_INTERNAL_PORT)
      expect(sessionValue(vars, 'my_ok')).toBe(true)
      const row = onlyRecord(vars, 'my_rows')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expectFromRemoteHost(row.client_addr, 'MariaDB')
    })

    await test.step('a block with no Database type is PostgreSQL on the remote host (SQL-8)', () => {
      expectConnected('PostgreSQL', POSTGRES_SERVICE, POSTGRES_INTERNAL_PORT, SQL_NAME.plainRemote)
      expect(sessionValue(vars, 'pd_ok')).toBe(true)
      const row = onlyRecord(vars, 'pd_rows')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expectFromRemoteHost(row.client_addr, 'PostgreSQL behind the block with no Database type')
    })

    await test.step('SQL Server with TLS off runs on the remote host (SQL-15)', () => {
      expectConnected('SQL Server', MSSQL_SERVICE, MSSQL_INTERNAL_PORT, SQL_NAME.msPlain)
      expect(sessionValue(vars, 'mp_ok')).toBe(true)
      const row = onlyRecord(vars, 'mp_rows')
      expectFromRemoteHost(row.client_addr, 'SQL Server with TLS off')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expect(row.tls, 'SQL Server reports the connection not encrypted').toBe('FALSE')
    })

    const workerDir = text(vars, 'probe_a_dir')

    await test.step('source-carried drivers unpack no wheel into the worker scratch dir', () => {
      expect(workerDir, 'the worker writes under its own scratch dir').toMatch(WORKER_DIR)
      expect(
        listOf(vars, 'probe_a_wheels'),
        'no wheel was pushed for PostgreSQL, MariaDB, the block with no Database type or SQL Server with TLS off',
      ).toEqual([])
    })

    await test.step('SQLite runs on the remote host on the build WAVE runs (SQL-15)', () => {
      const liteDir = text(vars, 'lite_dir')
      expect(liteDir, 'the run made its own folder under the home of the remote account').toMatch(
        new RegExp(`^/.+/sqlrem-${token}$`),
      )
      const connected = sqliteConnected(SQL_NAME.liteRemote)
      expect(connected.file, 'the block opened its file on the remote host').toBe(
        `${liteDir}/remote.db`,
      )
      expect(connected.version, 'the remote host runs the SQLite version WAVE runs').toBe(
        bundledVersion,
      )
      expect(sessionValue(vars, 'lr_ok')).toBe(true)
      expect(
        onlyRecord(vars, 'lr_rows'),
        'sqlite_version() is the version the Connected line names, beside the bound :tag',
      ).toEqual({ lib: bundledVersion, label: tag })
      expect(sessionValue(vars, 'lr_changed'), 'Rows changed counts the INSERT').toBe(1)
      const ownVersion = text(vars, 'ssh_own_sqlite')
      expect(ownVersion, 'the SQLite version of the remote Python').toMatch(/^\d+\.\d+\.\d+$/)
      expect(ownVersion, 'the block did not run on the SQLite the remote host has').not.toBe(
        bundledVersion,
      )
    })

    await test.step('the SQLite build that fits the remote host is the only wheel unpacked so far', () => {
      expect(text(vars, 'probe_l_dir'), 'one worker served the whole body').toBe(workerDir)
      expect(listOf(vars, 'probe_l_wheels').map(packageOf)).toEqual(['apsw'])
      const tags = listOf(vars, 'probe_l_tags')
      expect(tags.length, 'the SQLite wheel names its build tags').toBeGreaterThan(0)
      for (const buildTag of tags) {
        expect(buildTag, 'the SQLite build fits the remote Python, CPU and glibc').toMatch(buildFits)
      }
    })

    await test.step('Oracle runs on the remote host with its driver carried as wheels', () => {
      expectConnected('Oracle', ORACLE_SERVICE, ORACLE_INTERNAL_PORT)
      expect(sessionValue(vars, 'ora_ok')).toBe(true)
      const row = onlyRecord(vars, 'ora_rows')
      expectFromRemoteHost(row.client_addr, 'Oracle')
      expect(String(row.service).toUpperCase()).toBe(ORACLE_SERVICE_NAME)
      expect(row.tag, 'the :tag value was bound on the remote host').toBe(tag)
    })

    await test.step('SQL Server runs on the remote host over verified TLS', () => {
      expectConnected('SQL Server', MSSQL_SERVICE, MSSQL_INTERNAL_PORT)
      expect(sessionValue(vars, 'ms_ok')).toBe(true)
      const row = onlyRecord(vars, 'ms_rows')
      expectFromRemoteHost(row.client_addr, 'SQL Server')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expect(row.tls, 'SQL Server reports the connection encrypted').toBe('TRUE')
    })

    await test.step('the wheel set that fits the remote host unpacked into the same scratch dir', () => {
      expect(text(vars, 'probe_b_dir'), 'one worker served the whole body').toBe(workerDir)
      expect(listOf(vars, 'probe_b_wheels').map(packageOf)).toEqual(CARRIED_PACKAGES)
      expect(pythonTag, `the remote Python tag, got "${pythonTag}"`).toMatch(/^cp3\d+$/)
      expect(libc, 'the stack host runs glibc').toBe('glibc')
      const tags = listOf(vars, 'probe_b_tags')
      expect(tags.length, 'the oracledb wheel names its build tags').toBeGreaterThan(0)
      for (const buildTag of tags) {
        expect(buildTag, "Oracle's build fits the remote Python, CPU and glibc").toMatch(buildFits)
      }
    })

    await test.step('the outputs come back to WAVE and a block there reads them', () => {
      expect(logs).toContain(
        `sqlrem-outputs pg=2/2 pg-label=${tag} my=${SQL_STACK_DATABASE} ora=${tag} ms=TRUE`,
      )
      expect(sessionValue(vars, 'back_ok')).toBe(true)
      expect(records(vars, 'back_rows'), 'the rows written on the remote host are in the database').toEqual([
        { id: 1, label: tag },
        { id: 2, label: 'written-on-the-remote-host' },
      ])
      expect(logs).toContain(`sqlrem-back rows=2 first=${tag} second=written-on-the-remote-host`)
      const direct = new RegExp(
        `^Connected to PostgreSQL \\S+ at ${escapeRegExp(SQL_TARGET_HOST)}:${POSTGRES_PORT}$`,
      )
      expect(logs.some((line) => direct.test(line)), `the read-back runs on WAVE.\n${all}`).toBe(true)
      expectConnected('PostgreSQL', SQL_TARGET_HOST, POSTGRES_PORT)
    })

    await test.step('the worker scratch dir is gone from the remote host after the run', () => {
      expect(text(vars, 'worker_gone'), `${workerDir} must leave the host with the worker`).toBe(
        'gone',
      )
      expect(text(vars, 'builds_left'), `no carried build is left under ${workerDir}`).toBe('0')
    })

    await test.step('the SQLite file was on the remote host until the run removed its folder', () => {
      expect(text(vars, 'lite_folder'), 'the file the body wrote, then the folder').toBe(
        'present removed',
      )
    })

    await test.step('the session closes, the run ends on its bookend, no password is shown', () => {
      expect(sessionValue(vars, 'closed_ids')).toEqual([sessionValue(vars, 'sid')])
      expect(logs).toContain(`sqlrem-worker=gone sessions=1 ${BOOKEND}`)
      expect(all.includes(SQL_STACK_PASSWORD), 'the database password never reaches the console').toBe(
        false,
      )
    })
  })
})
