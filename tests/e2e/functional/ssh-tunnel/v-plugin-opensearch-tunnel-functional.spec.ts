/**
 * V-PLUGIN-OPENSEARCH-TUNNEL-FUNCTIONAL: the OpenSearch block through SSH tunnels
 * Wireframe: N/A
 * Design Decisions: OS-14, OS-11, OS-10
 * REQ: REQ-5.1.2, REQ-3.4.1.15, REQ-5.1.5
 *
 * One SSH session to `sshd` opens two tunnels: one to the cluster by its compose name
 * (`opensearch:9200`) and one by its container name (`wave-e2e-opensearch:9200`), a name the
 * cluster certificate does not list. Every Search reads the run's own F-LOGS index, fixed
 * window, DQL `log.level: "ERROR"`, Basic with the WAVE Test CA and Verify Server Certificate on;
 * its Cluster URL is an expression on the tunnel's Local Port. The password and CA are filled at
 * load, never stored in the fixture.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. The session opens with the secret-variable password and both tunnels bind distinct
 *    auto-assigned Local Ports.
 * 3. TUNNEL: Cluster URL `'https://localhost:' + str(port)` reaches the cluster through the
 *    tunnel: Total 6, the six ERROR documents newest first in Results, one INFO summary line.
 * 4. LOOPBACK: the same through `'https://127.0.0.1:' + str(port)`: Total 6.
 * 5. FAR-NAME: through the tunnel to `wave-e2e-opensearch`, Record and continue: Reason
 *    Unreachable, the error names the dialed address and fails the certificate check for
 *    `wave-e2e-opensearch` (the certificate lists localhost, so the name checked is the far
 *    host); one WARN line, no search sent, the block ends amber.
 * 6. Each case writes its `os-tunnel-...` Log line; the session close lists the one session, the
 *    run passes and reaches its bookend.
 * 7. The run log, DEBUG included, holds neither the password nor the Basic credential.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  OPENSEARCH_CONTAINER,
  OPENSEARCH_INTERNAL_PORT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_SERVICE,
  OPENSEARCH_USER,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  FIXED_FROM_ISO,
  FIXED_TO_ISO,
  MAP_LOGS,
  openSearchIndexName,
  seedOpenSearch,
} from '../../helpers/opensearch-stack'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: {
    label: string
    elementType: string
    description: string
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

const FIXTURE_FILE = 'fixture-opensearch.json'
const BOOKEND = 'os-tunnel-done'
const VERIFY_FAILED = 'CERTIFICATE_VERIFY_FAILED'
const MASK = '********'
const SSH_OPEN = 'Open the SSH session behind both tunnels (secret password)'

interface TunnelCase {
  /** The Search block's Description, which finds it in the fixture. */
  block: string
  /** The block's Name, as its console Source carries it (EXEC-25). */
  name: string
  /** The prefix of the case's variables in the fixture. */
  key: string
  /** The Local Port variable its Cluster URL reads. */
  lport: string
  /** The Cluster URL expression the fixture must hold. */
  url: string
  record: boolean
}

const TUNNELS = [
  { block: 'Forward a local port to OpenSearch by its compose name', host: OPENSEARCH_SERVICE, lport: 'lport_os' },
  {
    block: 'Forward a local port to OpenSearch by its container name, which its certificate does not list',
    host: OPENSEARCH_CONTAINER,
    lport: 'lport_far',
  },
] as const

const TUNNEL: TunnelCase = {
  block: 'Through the tunnel at localhost',
  name: 'Through the tunnel at localhost',
  key: 'tun',
  lport: 'lport_os',
  url: "'https://localhost:' + str(lport_os)",
  record: false,
}
const LOOPBACK: TunnelCase = {
  block: 'Through the tunnel at 127.0.0.1',
  name: 'Through the tunnel at 127.0.0.1',
  key: 'loop',
  lport: 'lport_os',
  url: "'https://127.0.0.1:' + str(lport_os)",
  record: false,
}
const FAR_NAME: TunnelCase = {
  block: 'Far name the certificate does not list',
  name: 'Far name not in the certificate',
  key: 'far',
  lport: 'lport_far',
  url: "'https://localhost:' + str(lport_far)",
  record: true,
}
const CASES = [TUNNEL, LOOPBACK, FAR_NAME]

/** The six ERROR documents of F-LOGS, newest first, as the Results cells hold them. */
const ERROR_ROWS = F_LOGS.filter((doc) => (doc.log as { level: string }).level === 'ERROR')
  .map((doc) => [doc['@timestamp'], 'ERROR', doc.message] as unknown[])
  .sort((a, b) => String(b[0]).localeCompare(String(a[0])))

const createdTests: string[] = []
let token = ''

function loadFixture(): Fixture {
  const raw = fs.readFileSync(path.resolve(__dirname, FIXTURE_FILE), 'utf-8')
  expect(raw.includes('__TOKEN__'), 'the fixture names its index with the run placeholder').toBe(true)
  expect(raw.includes(OPENSEARCH_PASSWORD), 'the fixture stores no cluster password').toBe(false)
  return JSON.parse(raw) as Fixture
}

function blockOf(fixture: Fixture, description: string): FixtureNode {
  const found = fixture.workflow.nodes.filter((node) => node.data.description === description)
  expect(found, `the fixture must declare one block described "${description}"`).toHaveLength(1)
  return found[0]
}

/** The fixture must carry the harness constants; each Search gets the password and CA from config. */
function prepareFixture(fixture: Fixture): Fixture {
  const ssh = blockOf(fixture, SSH_OPEN).data.config.values
  expect(ssh.host, 'the SSH block carries the sentinel the import rewrites').toBe(SSH_FIXTURE_HOST_SENTINEL)
  expect(String(ssh.port), 'the SSH block targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(ssh.username).toBe(SSH_STACK_USER)
  expect(ssh.password, 'the password comes from the secret test variable').toBe('ssh_pwd')
  expect(fixture.variables.ssh_pwd.secret, 'the password variable is secret').toBe(true)
  expect(fixture.variables.ssh_pwd.value).toBe(SSH_STACK_PASSWORD)

  for (const tunnel of TUNNELS) {
    const values = blockOf(fixture, tunnel.block).data.config.values
    expect(values.remote_host, 'each tunnel names its far host').toBe(tunnel.host)
    expect(String(values.remote_port), 'each tunnel ends on the cluster port').toBe(OPENSEARCH_INTERNAL_PORT)
    expect(values.local_port, 'each tunnel takes an auto-assigned Local Port').toBe(0)
  }

  const searches = fixture.workflow.nodes.filter((node) => node.data.elementType === 'opensearch')
  expect(searches.map((node) => node.data.description), 'one Search per case, in case order').toEqual(
    CASES.map((c) => c.block),
  )
  for (const c of CASES) {
    const node = blockOf(fixture, c.block)
    const values = node.data.config.values
    const what = `"${c.block}"`
    expect(node.data.label, `${what} carries its Name`).toBe(c.name)
    expect(values.url, `${what} dials the tunnel's Local Port`).toBe(c.url)
    expect(node.data.expressionFields, `${what} keeps its Cluster URL an expression`).toEqual(['url'])
    expect(values.index, `${what} reads the run's own index`).toBe(openSearchIndexName(token, 'app-logs'))
    expect(values.username, `${what} logs in with Basic`).toBe(OPENSEARCH_USER)
    expect(values.verify_ssl, `${what} verifies the server certificate`).toBe(true)
    expect(values.on_error, `${what} fails or records`).toBe(c.record ? 'record' : 'fail')
    expect(values.password, `${what} stores no password`).toBe('')
    expect(values.ca_cert, `${what} stores no CA`).toBe('')
    values.password = OPENSEARCH_PASSWORD
    values.ca_cert = CA_CERT_PEM
  }
  return fixture
}

function blockEntries(entries: readonly LogEntry[], c: TunnelCase): LogEntry[] {
  const source = blockSource('OpenSearch', c.name)
  return entries.filter((entry) => entry.source === source)
}

/** The block's INFO and WARN lines as "LEVEL message", the elapsed seconds blanked. */
function summaryLines(entries: readonly LogEntry[], c: TunnelCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level !== 'DEBUG')
    .map((entry) => `${entry.level} ${entry.message.replace(/, \d+\.\d{2} s$/, ', # s')}`)
}

/** The DEBUG request lines the block wrote, each cut to its method and path, sorted: the harvest does not keep their order. */
function requestLines(entries: readonly LogEntry[], c: TunnelCase): string[] {
  return blockEntries(entries, c)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => entry.message.split(' ').slice(0, 2).join(' '))
    .sort()
}

test.describe('V-PLUGIN-OPENSEARCH-TUNNEL-FUNCTIONAL: the OpenSearch block through SSH tunnels', () => {
  test.beforeAll(async () => {
    token = newToken()
    const index = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(index, MAP_LOGS)
    await seedOpenSearch(index, F_LOGS)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('reaches the cluster through tunnels and checks its certificate against the far name', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const index = openSearchIndexName(token, 'app-logs')
    const fixture = prepareFixture(withToken(loadFixture(), token))
    const infoLine = `INFO Search ${index} from ${FIXED_FROM_ISO} to ${FIXED_TO_ISO}: 6 results, 6 kept, # s`
    const fieldCaps = `GET /${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`
    const search = `POST /${index}/_search`

    const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
      injectSsh: true,
      rejectRepairs: true,
    })
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
    expect(validation.warnings, `zero warnings. Got: ${JSON.stringify(validation.warnings)}`).toHaveLength(0)

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 180_000)

    const variables = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
    }
    const port = (name: string): number => sessionValue(variables, name) as number

    await test.step('every block ends in its state: the far-name Search amber, the rest green (OS-11)', async () => {
      for (const node of fixture.workflow.nodes) {
        const recorded = node.data.description === FAR_NAME.block
        await expectNodeStatus(page, node.id, recorded ? 'warning' : 'success')
      }
    })

    await test.step('the session opens and both tunnels bind distinct Local Ports', () => {
      expect(String(sessionValue(variables, 'sid')), 'the secret password opened a session').not.toBe('')
      const ports = TUNNELS.map((tunnel) => port(tunnel.lport))
      for (const lport of ports) {
        expect(Number.isInteger(lport) && lport > 0, `a Local Port was assigned: ${lport}`).toBe(true)
      }
      expect(new Set(ports).size, 'each tunnel listens on its own Local Port').toBe(ports.length)
      expectLog(`os-tunnel-ports near=${ports[0]} far=${ports[1]}`)
    })

    for (const c of [TUNNEL, LOOPBACK]) {
      const slug = c === TUNNEL ? 'localhost' : 'loopback'
      const title = c === TUNNEL ? 'TUNNEL: localhost' : 'LOOPBACK: 127.0.0.1'
      await test.step(`${title} on the Local Port goes through the tunnel: Total 6 (OS-14)`, () => {
        expect(summaryLines(entries, c), `the INFO / WARN lines of "${c.block}".\n${formatEntries(entries)}`).toEqual([
          infoLine,
        ])
        expect(requestLines(entries, c), `"${c.block}" reads the field list and searches`).toEqual([
          fieldCaps,
          search,
        ])
        expect(sessionValue(variables, `${c.key}_ok`), `${c.key}_ok`).toBe(true)
        expect(sessionValue(variables, `${c.key}_total`), `${c.key}_total`).toBe(6)
        const rows = sessionTable(variables, `${c.key}_rows`)
        expect(rows.columns.map((column) => column.name), `${c.key}_rows columns`).toEqual([
          '@timestamp',
          'log.level',
          'message',
        ])
        expect(rows.rows, `${c.key}_rows holds the ERROR documents newest first`).toEqual(ERROR_ROWS)
        expectLog(`os-tunnel-${slug} total=6 first=${String(ERROR_ROWS[0][2])}`)
      })
    }

    await test.step('FAR-NAME: the certificate is checked against the far host, so Unreachable (OS-14, OS-11)', () => {
      const lport = port(FAR_NAME.lport)
      const error = String(sessionValue(variables, 'far_error'))
      expect(error, 'the error names the dialed address and the refused far name').toMatch(
        new RegExp(
          `^Could not connect to OpenSearch at localhost:${lport}: \\[SSL: ${VERIFY_FAILED}\\] ` +
            `certificate verify failed: Hostname mismatch, certificate is not valid for '${escapeRegExp(OPENSEARCH_CONTAINER)}'\\.`,
        ),
      )
      expect(sessionValue(variables, 'far_ok'), 'Record and continue: Success is false').toBe(false)
      expect(sessionValue(variables, 'far_reason'), 'a failed handshake is Unreachable').toBe('Unreachable')
      expect(sessionValue(variables, 'far_total')).toBe(0)
      expect(sessionTable(variables, 'far_rows')).toEqual({ columns: [], rows: [] })
      expect(summaryLines(entries, FAR_NAME), `one WARN line.\n${formatEntries(entries)}`).toEqual([
        `WARN Search failed (Unreachable): ${error}`,
      ])
      expect(requestLines(entries, FAR_NAME), 'only the field-list request was attempted').toEqual([fieldCaps])
      expectLog('os-tunnel-far-name total=0 reason=Unreachable')
    })

    await test.step('the session closes, the run ends on its bookend, no secret reaches the run log (REQ-5.1.2)', () => {
      expect(sessionValue(variables, 'closed_ids'), 'the session close lists the one session').toEqual([
        sessionValue(variables, 'sid'),
      ])
      expectLog(`os-tunnel-closes sessions=1 ${BOOKEND}`)
      for (const c of CASES) {
        const inputs = blockEntries(entries, c).filter(
          (entry) => entry.level === 'DEBUG' && entry.message.startsWith('Inputs: '),
        )
        expect(inputs, `DEBUG was on: "${c.block}" echoed its inputs once`).toHaveLength(1)
        expect(inputs[0].message, `"${c.block}" echoes its password as the mask`).toContain(MASK)
      }
      const text = entries.map((entry) => `${entry.source} ${entry.message}`).join('\n')
      const needles: Record<string, string> = {
        password: OPENSEARCH_PASSWORD,
        'Basic credential': Buffer.from(`${OPENSEARCH_USER}:${OPENSEARCH_PASSWORD}`).toString('base64'),
      }
      for (const [what, needle] of Object.entries(needles)) {
        expect(text.includes(needle), `the run log leaked the ${what}`).toBe(false)
      }
    })
  })
})
