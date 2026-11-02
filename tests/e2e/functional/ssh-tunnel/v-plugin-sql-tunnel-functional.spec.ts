/**
 * V-PLUGIN-SQL-TUNNEL-FUNCTIONAL: the SQL block through SSH tunnels
 * Wireframe: N/A
 * Design Decisions: SQL-2, SQL-3, SQL-5, SQL-8, SQL-15
 * REQ: REQ-3.4.1.6, REQ-5.1.4, REQ-3.4.1.3
 *
 * Pass Criteria:
 * 1. The fixture imports and validates with zero errors; the run passes and every Block
 *    succeeds except the two Record and continue SQL Blocks behind a far name the database
 *    certificate does not list, which end amber.
 * 2. The SSH session opens with the secret-variable password, and six tunnels to the
 *    databases' compose names bind distinct auto-assigned Local Ports.
 * 3. PostgreSQL through its tunnel, Host localhost on the Local Port, TLS on with Verify
 *    Server Certificate on: "Connected to PostgreSQL {version} at localhost:{p}"; the server
 *    sees the SSH host's own address as the client, TLS is in use, the `:tag` value is bound,
 *    and the script's two inserted rows make Rows changed 2.
 * 4. The rows written through the tunnel are in the far database: a later block on the direct
 *    leg reads both back in order and drops the run's table.
 * 5. SQL Server through its tunnel, TLS on with verification on: connected at localhost:{p},
 *    database wave, the SSH host as the client, encrypt_option TRUE.
 * 6. MariaDB through its tunnel, TLS on with verification on: connected at localhost:{p},
 *    database wave, the SSH host as the client, a TLS version reported by the server.
 * 7. Oracle through its tunnel over plain TCP: connected at localhost:{p}, service freepdb1,
 *    the SSH host as the client.
 * 8. A Host of 127.0.0.1 on the same PostgreSQL Local Port goes through the tunnel too (SQL-15
 *    names both loopback forms; the Host is an expression so the import rewrite leaves it):
 *    connected at 127.0.0.1:{p} with TLS verified, the SSH host as the client.
 * 9. Through a tunnel to PostgreSQL's container name - absent from the certificate, which does
 *    list localhost - the block fails Unreachable and the TLS check names that far host, so the
 *    name checked is the far host and not the host WAVE dials; one WARN line
 *    "Run SQL failed (Unreachable): ..." and Success false.
 * 10. The same far-name check refuses SQL Server's certificate: reason Unreachable, a
 *     certificate verify failure, one WARN line.
 * 11. The session close lists the one session, the run ends on the bookend, and the database
 *     password never reaches the console.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { escapeRegExp, getLogEntries } from '../../helpers/log-reader'
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
  BACKEND_URL,
  CA_CERT_PEM,
  MARIADB_INTERNAL_PORT,
  MARIADB_SERVICE,
  MSSQL_CONTAINER,
  MSSQL_INTERNAL_PORT,
  MSSQL_SERVICE,
  ORACLE_INTERNAL_PORT,
  ORACLE_SERVICE,
  ORACLE_SERVICE_NAME,
  POSTGRES_CONTAINER,
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
import { newToken, withToken } from '../shell-blocks/shell-helpers'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    elementType: string
    expressionFields: string[]
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, { value: unknown; type: string; scope: string; secret?: boolean }>
  [key: string]: unknown
}


// --- fixture node ids ----------------------------------------------------
const NODE = {
  sshOpen: 'd2be4c78-d2f3-4f27-a57a-d750dcada2f1',
  sshAddrs: 'fbb4eaae-02a0-4e02-b418-ba2a0212fb04',
  tunPg: '42132eac-c198-4f2b-8e4f-e060fcffcc94',
  tunMs: '3cf13d99-fdc1-4c81-904f-aa0c17d76f0a',
  tunMy: '265d6029-cb9a-431b-9fd6-c0bc67c048fd',
  tunOra: '20acbfc5-9668-486d-a47d-a0ffda6419cc',
  tunPgx: '3fdc44ea-0ff0-4686-9db6-dc2416378937',
  tunMsx: '00a124eb-a94b-40d9-968f-79dad20e9295',
  logTunnels: 'b3224a40-8719-454a-af1d-27f1d3673fe6',
  sqlPg: '3c80aa17-72ca-440d-85b8-1d51ddcabc1d',
  logPg: 'e5b52b01-2731-4ff5-bf54-3be2fe48f8b7',
  sqlBack: '17a3a4fe-c2c3-420d-80c7-87be2a886c1a',
  logBack: '53bcdb1b-0708-47ac-8446-2fc384f63682',
  sqlMs: '5185a45a-a358-4a57-b168-cc96c13497b7',
  logMs: '7b1edf28-1903-4354-95a3-9fe72ada126b',
  sqlMy: 'f2daf5d9-f943-4e57-b220-8063ff29579b',
  logMy: 'c914f194-38cc-40b3-87e6-8f52d4612b4a',
  sqlOra: 'f8f307a0-f6b0-45dc-993c-3802cfcbc56f',
  logOra: '9ae55950-712b-462e-b83d-72eed5c727fa',
  sqlPgIp: '7c1e4a52-3b9d-4f0e-a6c8-2d5f9e1b7a40',
  logPgIp: 'b5d0c3e8-91a4-4c27-8f6e-0e3a7d2c4b19',
  sqlPgx: 'f6f7f029-de36-41c7-869c-504c4177797a',
  sqlMsx: '29de709b-0d5d-4ab1-b80b-21cbd7e3a672',
  logMismatch: '77d03b95-6013-4cd4-933f-6f37ce9541b9',
  sshClose: '7f2e996c-fab8-4b2d-95ae-8e613b0ae7a7',
  logDone: 'a38d568e-af29-44cf-8015-ed73e3e348f4',
} as const

/** The Record and continue SQL Blocks: each records its refused far name and ends amber. */
const RECORDING_IDS: readonly string[] = [NODE.sqlPgx, NODE.sqlMsx]

const SUCCEEDING_IDS: readonly string[] = Object.values(NODE).filter(
  (id) => !RECORDING_IDS.includes(id),
)

const BOOKEND = 'sql-tunnel-e2e-done'
const LOOPBACK_HOST = 'localhost'
const LOOPBACK_IP = '127.0.0.1'
const TAG_VALUE = 'through-the-tunnel'

/** Every tunnel: its node, the far host and port it forwards to, and its Local Port variable. */
const TUNNELS = [
  { id: NODE.tunPg, host: POSTGRES_SERVICE, port: POSTGRES_INTERNAL_PORT, lport: 'lport_pg' },
  { id: NODE.tunMs, host: MSSQL_SERVICE, port: MSSQL_INTERNAL_PORT, lport: 'lport_ms' },
  { id: NODE.tunMy, host: MARIADB_SERVICE, port: MARIADB_INTERNAL_PORT, lport: 'lport_my' },
  { id: NODE.tunOra, host: ORACLE_SERVICE, port: ORACLE_INTERNAL_PORT, lport: 'lport_ora' },
  { id: NODE.tunPgx, host: POSTGRES_CONTAINER, port: POSTGRES_INTERNAL_PORT, lport: 'lport_pgx' },
  { id: NODE.tunMsx, host: MSSQL_CONTAINER, port: MSSQL_INTERNAL_PORT, lport: 'lport_msx' },
] as const

/** The SQL Blocks that dial a tunnel's Local Port: node, Local Port variable, TLS, Database row. */
const TUNNELED_SQL = [
  { id: NODE.sqlPg, lport: 'lport_pg', tls: true, database: SQL_STACK_DATABASE },
  { id: NODE.sqlMs, lport: 'lport_ms', tls: true, database: SQL_STACK_DATABASE },
  { id: NODE.sqlMy, lport: 'lport_my', tls: true, database: SQL_STACK_DATABASE },
  { id: NODE.sqlOra, lport: 'lport_ora', tls: false, database: ORACLE_SERVICE_NAME },
  { id: NODE.sqlPgx, lport: 'lport_pgx', tls: true, database: SQL_STACK_DATABASE },
  { id: NODE.sqlMsx, lport: 'lport_msx', tls: true, database: SQL_STACK_DATABASE },
] as const

/** Load the fixture with the run's own table name, the stack's password and its CA as the trust anchor. */
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

/** The fixture must carry the harness constants, not copies that drifted. */
function expectStackTargets(fixture: Fixture): void {
  const ssh = valuesOf(fixture, NODE.sshOpen)
  expect(ssh.host, 'the SSH block carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(ssh.port), 'the SSH block targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(ssh.username, 'the SSH block uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(ssh.password, 'the password comes from the secret test variable').toBe('ssh_pwd')
  expect(fixture.variables.ssh_pwd.secret, 'the password variable is secret').toBe(true)
  expect(fixture.variables.ssh_pwd.value).toBe(SSH_STACK_PASSWORD)

  for (const tunnel of TUNNELS) {
    const values = valuesOf(fixture, tunnel.id)
    expect(values.remote_host, 'each tunnel names its far host').toBe(tunnel.host)
    expect(String(values.remote_port), 'each tunnel ends on the database port').toBe(tunnel.port)
    expect(values.local_port, 'each tunnel takes an auto-assigned Local Port').toBe(0)
  }

  for (const block of TUNNELED_SQL) {
    const values = valuesOf(fixture, block.id)
    expect(values.host, 'a tunnel Local Port is dialed as localhost, never rewritten').toBe(
      LOOPBACK_HOST,
    )
    expect(values.port, 'the Port row reads the tunnel Local Port').toBe(block.lport)
    expect(values.database).toBe(block.database)
    expect(values.username).toBe(SQL_STACK_USER)
    expect(values.password).toBe(SQL_STACK_PASSWORD)
    expect(values.tls, 'TLS as the leg needs it').toBe(block.tls)
    if (block.tls) {
      expect(values.verify_ssl, 'Verify Server Certificate is on').toBe(true)
      expect(values.ca_cert, 'the CA row reads the stack CA variable').toBe('ca_pem')
    }
  }

  const byIp = nodeOf(fixture, NODE.sqlPgIp)
  expect(byIp.data.config.values.host, 'the 127.0.0.1 leg writes its Host as an expression').toBe(
    `'${LOOPBACK_IP}'`,
  )
  expect(byIp.data.expressionFields).toContain('host')
  expect(byIp.data.config.values.port, 'the 127.0.0.1 leg reads the PostgreSQL Local Port').toBe('lport_pg')
  expect(byIp.data.config.values.tls).toBe(true)
  expect(byIp.data.config.values.verify_ssl).toBe(true)

  const back = valuesOf(fixture, NODE.sqlBack)
  expect(back.host, 'the read-back block carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(back.port), 'the read-back block takes the direct PostgreSQL port').toBe(
    POSTGRES_PORT,
  )
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
/** The one row of a table as a column-name map. */
function onlyRow(vars: SessionVariables, name: string): Record<string, unknown> {
  const table = sessionTable(vars, name)
  expect(table.rows, `"${name}" holds one row`).toHaveLength(1)
  return Object.fromEntries(table.columns.map((column, index) => [column.name, table.rows[0][index]]))
}

let createdTestId: string | null = null

test.describe('V-PLUGIN-SQL-TUNNEL-FUNCTIONAL: the SQL block through SSH tunnels', () => {
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

  test('reaches all four databases by their far names and checks TLS against the far host', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    // The databases are shared by every shard, so this run's table carries its own token.
    const token = newToken()
    const table = `sqltun_${token}`
    const fixture = loadFixture(token)
    expectStackTargets(fixture)

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, injectHosts(fixture))
    createdTestId = testId

    await test.step('the imported workflow validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `the tunnel fixture must validate clean. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND, 180_000)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)
    const vars = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables

    const port = (name: string): number => sessionValue(vars, name) as number
    const sshAddresses = String(sessionValue(vars, 'ssh_addrs')).trim().split(/\s+/)
    const connectedLine = (name: string, lport: string): RegExp =>
      new RegExp(`^Connected to ${escapeRegExp(name)} \\S+ at ${LOOPBACK_HOST}:${port(lport)}$`)
    const expectConnected = (name: string, lport: string): void => {
      const pattern = connectedLine(name, lport)
      expect(
        entries.filter((entry) => pattern.test(entry.message)).map((entry) => entry.level),
        `expected one INFO line matching ${pattern}.\n${all}`,
      ).toEqual(['INFO'])
    }
    const expectFromSshHost = (client: unknown, what: string): void => {
      expect(
        sshAddresses,
        `${what} must see the SSH host (${sshAddresses.join(' ')}) as its client`,
      ).toContain(String(client))
    }

    await test.step('every Block ends as expected and the run passed', async () => {
      for (const id of SUCCEEDING_IDS) await expectNodeStatus(page, id, 'success')
      for (const id of RECORDING_IDS) await expectNodeStatus(page, id, 'warning')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('the session opens and six tunnels bind distinct Local Ports', () => {
      expect(all.includes('Permission denied'), `the secret password must authenticate.\n${all}`).toBe(
        false,
      )
      expect(sshAddresses.length, 'the SSH host reports its own address').toBeGreaterThan(0)
      const ports = TUNNELS.map((tunnel) => port(tunnel.lport))
      for (const lport of ports) {
        expect(Number.isInteger(lport) && lport > 0, `a Local Port was assigned: ${lport}`).toBe(true)
      }
      expect(new Set(ports).size, 'every tunnel listens on its own Local Port').toBe(ports.length)
      expect(logs).toContain(
        `sqltun-tunnels pg=${ports[0]} ms=${ports[1]} my=${ports[2]} ora=${ports[3]} ` +
          `pgx=${ports[4]} msx=${ports[5]}`,
      )
    })

    await test.step('PostgreSQL through its tunnel, TLS verified against the far host', () => {
      expectConnected('PostgreSQL', 'lport_pg')
      expect(sessionValue(vars, 'pg_ok')).toBe(true)
      const row = onlyRow(vars, 'pg_rows')
      expectFromSshHost(row.client_addr, 'PostgreSQL')
      expect(row.db, 'the far database').toBe(SQL_STACK_DATABASE)
      expect(row.tls, 'the connection is encrypted').toBe(true)
      expect(row.stored, 'both inserted rows are in the table').toBe(2)
      expect(sessionValue(vars, 'pg_count'), 'Row count is the last SELECT').toBe(1)
      expect(sessionValue(vars, 'pg_changed'), 'Rows changed sums the INSERT').toBe(2)
      expect(logs).toContain(
        `sqltun-pg ok=True client=${String(row.client_addr)} db=${SQL_STACK_DATABASE} tls=True stored=2 changed=2`,
      )
    })

    await test.step('the rows written through the tunnel read back over the direct leg', () => {
      expect(sessionValue(vars, 'back_ok')).toBe(true)
      const back = sessionTable(vars, 'back_rows')
      expect(back.columns.map((column) => column.name)).toEqual(['id', 'label'])
      expect(back.rows, `${table} holds the tunnel's rows, the bound :tag first`).toEqual([
        [1, TAG_VALUE],
        [2, 'far-end'],
      ])
      expect(sessionValue(vars, 'back_count')).toBe(2)
      expect(logs).toContain(`sqltun-back rows=2 first=${TAG_VALUE} second=far-end`)
      const direct = new RegExp(
        `^Connected to PostgreSQL \\S+ at ${escapeRegExp(SQL_TARGET_HOST)}:${POSTGRES_PORT}$`,
      )
      expect(logs.some((line) => direct.test(line)), `the read-back dials the direct leg.\n${all}`).toBe(
        true,
      )
    })

    await test.step('SQL Server through its tunnel, TLS verified against the far host', () => {
      expectConnected('SQL Server', 'lport_ms')
      expect(sessionValue(vars, 'ms_ok')).toBe(true)
      const row = onlyRow(vars, 'ms_rows')
      expectFromSshHost(row.client_addr, 'SQL Server')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expect(row.tls, 'SQL Server reports the connection encrypted').toBe('TRUE')
      expect(logs).toContain(
        `sqltun-ms ok=True client=${String(row.client_addr)} db=${SQL_STACK_DATABASE} tls=TRUE`,
      )
    })

    await test.step('MariaDB through its tunnel, TLS verified against the far host', () => {
      expectConnected('MySQL', 'lport_my')
      expect(sessionValue(vars, 'my_ok')).toBe(true)
      const row = onlyRow(vars, 'my_rows')
      expectFromSshHost(row.client_addr, 'MariaDB')
      expect(row.db).toBe(SQL_STACK_DATABASE)
      expect(String(row.tls), 'MariaDB reports the TLS version in use').toMatch(/^TLSv1\.[23]$/)
    })

    await test.step('Oracle through its tunnel over plain TCP', () => {
      expectConnected('Oracle', 'lport_ora')
      expect(sessionValue(vars, 'ora_ok')).toBe(true)
      const row = onlyRow(vars, 'ora_rows')
      expectFromSshHost(row.client_addr, 'Oracle')
      expect(String(row.service).toUpperCase(), 'the far service name').toBe(ORACLE_SERVICE_NAME)
    })

    await test.step('a Host of 127.0.0.1 on the Local Port goes through the tunnel too (SQL-15)', () => {
      const byIp = new RegExp(
        `^Connected to PostgreSQL \\S+ at ${escapeRegExp(LOOPBACK_IP)}:${port('lport_pg')}$`,
      )
      expect(
        entries.filter((entry) => byIp.test(entry.message)).map((entry) => entry.level),
        `expected one INFO line matching ${byIp}.\n${all}`,
      ).toEqual(['INFO'])
      expect(sessionValue(vars, 'pgip_ok')).toBe(true)
      const row = onlyRow(vars, 'pgip_rows')
      expectFromSshHost(row.client_addr, 'PostgreSQL at 127.0.0.1')
      expect(row.tls, 'TLS verified through the tunnel').toBe(true)
      expect(logs).toContain(`sqltun-pgip ok=True client=${String(row.client_addr)} tls=True`)
    })

    await test.step('PostgreSQL behind a far name its certificate does not list is refused (SQL-15)', () => {
      const lport = port('lport_pgx')
      const message = String(sessionValue(vars, 'pgx_err'))
      expect(message, 'the TLS check names the far host, not localhost').toMatch(
        new RegExp(
          `^Could not connect to PostgreSQL at ${LOOPBACK_HOST}:${lport}: \\[SSL: CERTIFICATE_VERIFY_FAILED\\] ` +
            `certificate verify failed: Hostname mismatch, certificate is not valid for '${escapeRegExp(POSTGRES_CONTAINER)}'\\.`,
        ),
      )
      expect(sessionValue(vars, 'pgx_ok'), 'Record and continue: Success is false').toBe(false)
      expect(sessionValue(vars, 'pgx_reason'), 'a failed handshake is Unreachable').toBe('Unreachable')
      expect(
        entries.filter((entry) => entry.message === `Run SQL failed (Unreachable): ${message}`).map(
          (entry) => entry.level,
        ),
        `one WARN line for the refused far name.\n${all}`,
      ).toEqual(['WARN'])
      expect(connectedLine('PostgreSQL', 'lport_pgx').test(all), 'nothing connected').toBe(false)
    })

    await test.step('SQL Server behind a far name its certificate does not list is refused (SQL-15)', () => {
      const lport = port('lport_msx')
      const message = String(sessionValue(vars, 'msx_err'))
      expect(message).toMatch(
        new RegExp(`^Could not connect to SQL Server at ${LOOPBACK_HOST}:${lport}: .*certificate verify failed`),
      )
      expect(sessionValue(vars, 'msx_ok')).toBe(false)
      expect(sessionValue(vars, 'msx_reason')).toBe('Unreachable')
      expect(
        entries.filter((entry) => entry.message === `Run SQL failed (Unreachable): ${message}`).map(
          (entry) => entry.level,
        ),
        `one WARN line for the refused far name.\n${all}`,
      ).toEqual(['WARN'])
      expect(logs).toContain('sqltun-mismatch pg=False/Unreachable ms=False/Unreachable')
    })

    await test.step('the session closes, the run ends on its bookend, no password is shown', () => {
      expect(sessionValue(vars, 'closed_ids'), 'the session close lists the one session').toEqual([
        sessionValue(vars, 'sid'),
      ])
      expect(logs).toContain(`sqltun-closes sessions=1 ${BOOKEND}`)
      expect(all.includes(SQL_STACK_PASSWORD), 'the database password never reaches the console').toBe(
        false,
      )
    })
  })
})
