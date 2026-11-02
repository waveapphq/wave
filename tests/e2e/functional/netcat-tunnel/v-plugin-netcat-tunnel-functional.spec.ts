/**
 * V-PLUGIN-NETCAT-TUNNEL-FUNCTIONAL: Netcat through SSH tunnels
 * Wireframe: N/A
 * Design Decisions: NETCAT-2, NETCAT-3, NETCAT-5, NETCAT-7, NETCAT-8, NETCAT-9, NETCAT-15, NETCAT-16, NETCAT-17, NETCAT-18
 * REQ: REQ-3.3.4.3, REQ-3.4.1.9
 *
 * Pass Criteria:
 * 1. The fixture imports and validates with zero errors; the run passes, every Block
 *    succeeds except the four Record and continue Netcat Blocks, which end amber.
 * 2. The SSH session opens with the secret-variable password, and two tunnels to the
 *    internal-only netcat-target bind distinct auto-assigned Local Ports that reach the
 *    Netcat Port expressions downstream.
 * 3. A TCP Check of localhost on the echo tunnel's Local Port tests the far port: Success
 *    true, one Results row (port, tcp, open, empty reason, integer time_ms, no reply column),
 *    and the INFO line "SSH tunnel detected on local port {p}: testing netcat-target:9470 from
 *    {ssh_host}" between the start line and "Port {p}/tcp open".
 * 4. Talk Text through the same tunnel: Reply and the Results reply cell equal the Text
 *    exactly, "Sent {n} bytes, received {n} bytes" follows the tunnel line, and with Close
 *    after sending the reply ends when the far echo closes, inside Timeout.
 * 5. A TCP Check through the tunnel to far port 9479: state closed with the SSH server's own
 *    refusal text "Connection refused" as the reason; under Record and continue Success false,
 *    Reason Closed, Error "Port {p} on localhost is closed: Connection refused", one WARN line
 *    "Netcat failed (Closed): ...", and Results still holds the measured row.
 * 6. A UDP Check of a tunnel's Local Port fails after its start line with "SSH tunnel
 *    detected on local port {p}: SSH tunnels carry TCP only, so UDP cannot go through one",
 *    Reason Tunnel, Results empty and no port result line.
 * 7. A UDP Range written as a plain port, then the higher tunnel Local Port, then the lower one
 *    names the higher one, the first tunnel port in written order and not in ascending order,
 *    leaves Results empty and writes no Range summary.
 * 8. Once the echo tunnel is closed, a Check of its old Local Port is not routed through SSH:
 *    no third tunnel line, state closed with the operating system's reason "Connection refused",
 *    Reason Closed.
 * 9. Both tunnel closes return true, the session close lists the one session, and the run
 *    ends on the bookend line.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  BACKEND_URL,
  NETCAT_CLOSED_PORT,
  NETCAT_TARGET_SERVICE,
  NETCAT_TCP_ECHO_PORT,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
} from '../../helpers/config'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    elementType: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface FixtureVariable {
  value: unknown
  type: string
  scope: string
  secret?: boolean
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, FixtureVariable>
  [key: string]: unknown
}

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

// --- fixture node ids ----------------------------------------------------
const NODE = {
  sshOpen: 'b7e909bb-0ca2-4549-8bc4-3ff5d6f995e7',
  logSession: '0934eb5f-5240-4bd8-8e87-2f1ee46ade71',
  tunnelEcho: 'b8591b7b-41a8-43e4-97bf-6b7f501f487c',
  tunnelFar: '57b723de-d35c-43a1-b5bb-de50dc0ac1c5',
  logTunnels: 'c1056d2a-e859-4ed8-8fda-db5ecdf15fc2',
  checkOpen: '9cfd4790-a34d-458b-82e6-0fe690c42094',
  logCheckOpen: '0c6eb842-079e-4e87-aabb-7bc626f9c37c',
  talk: '115ebdd4-6f92-4f86-b55b-e5d8c3f8bc69',
  logTalk: '16788c61-f3dc-4f48-99a5-ebd6fe92b7a1',
  checkFar: 'dcb9862d-e3f9-476a-a0fc-87072e642ae5',
  logCheckFar: '35495dcb-747a-4e1a-af64-a7cde77f51ed',
  udp: 'f54cec19-b8aa-44b7-9e86-f4cf798a7620',
  logUdp: 'a66f0adb-cb3c-42ae-b463-8fef43bf5eb6',
  udpRange: '742e5cd0-4632-4013-98e1-cc2fd38e796c',
  logUdpRange: '7e7e4653-6a80-4f11-8080-9abee6acef65',
  closeEcho: 'b547c369-233e-41d9-880f-f0e61214c195',
  checkGone: '1c2d9b3f-89a6-4471-9b68-74c227352bb7',
  logGone: '69b3ac9f-a882-4485-a091-813193de59a1',
  closeFar: '1f670c8d-3f49-484b-8886-362fe1135d64',
  closeSession: '7612487e-2d9e-48e2-9518-d6d64074892e',
  logDone: 'adfe282e-2091-40ee-9a8b-b1c8a7700799',
} as const

/** The Record and continue Netcat Blocks: each records its failure and ends amber. */
const RECORDING_IDS: readonly string[] = [NODE.checkFar, NODE.udp, NODE.udpRange, NODE.checkGone]

const SUCCEEDING_IDS: readonly string[] = Object.values(NODE).filter(
  (id) => !RECORDING_IDS.includes(id),
)

const BOOKEND = 'netcat-tunnel-e2e-done'
const LOOPBACK_HOST = 'localhost'
const CHECK_COLUMNS = ['port', 'protocol', 'state', 'reason', 'time_ms']
const TALK_COLUMNS = [...CHECK_COLUMNS, 'reply']

/** The refusal text of both the SSH server and the local operating system for a port nobody listens on. */
const REFUSED = 'Connection refused'

function loadFixture(): Fixture {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Fixture
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
  expect(ssh.host, 'the SSH block carries the sentinel the import helper rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(ssh.port), 'the SSH block targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(ssh.username, 'the SSH block uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(ssh.password, 'the password comes from the secret test variable').toBe('ssh_pwd')
  expect(fixture.variables.ssh_pwd.secret, 'the password variable is secret').toBe(true)
  expect(fixture.variables.ssh_pwd.value, 'the secret holds the stack SSH password').toBe(
    SSH_STACK_PASSWORD,
  )

  const echo = valuesOf(fixture, NODE.tunnelEcho)
  const far = valuesOf(fixture, NODE.tunnelFar)
  for (const tunnel of [echo, far]) {
    expect(tunnel.remote_host, 'every tunnel reaches the internal-only target').toBe(
      NETCAT_TARGET_SERVICE,
    )
    expect(tunnel.local_port, 'every tunnel takes an auto-assigned Local Port').toBe(0)
  }
  expect(String(echo.remote_port), 'the echo tunnel ends at the TCP echo').toBe(NETCAT_TCP_ECHO_PORT)
  expect(String(far.remote_port), 'the far tunnel ends where nothing listens').toBe(
    NETCAT_CLOSED_PORT,
  )

  for (const id of [NODE.checkOpen, NODE.talk, NODE.checkFar, NODE.udp, NODE.udpRange, NODE.checkGone]) {
    expect(
      valuesOf(fixture, id).host,
      'a tunnel Local Port is dialed as localhost, which the import rewrite never touches',
    ).toBe(LOOPBACK_HOST)
  }
  expect(
    String(valuesOf(fixture, NODE.udpRange).port_range),
    'the UDP Range leads with a plain port, then writes the tunnel Local Ports high before low',
  ).toBe(`f'${NETCAT_CLOSED_PORT}, {max(lport_far, lport_echo)}, {min(lport_far, lport_echo)}'`)
}

// --- session variables ---------------------------------------------------
function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  expect(vars[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return vars[name]
}

function tableOf(vars: SessionVariables, name: string): WaveTable {
  const entry = cell(vars, name)
  expect(entry.type, `"${name}" binds a Results table`).toBe('table')
  return entry.value as WaveTable
}

function columnsOf(table: WaveTable): string[] {
  return table.columns.map((column) => column.name)
}

/** The one Results row of a Single Block, with its time_ms checked as an integer. */
function onlyRow(table: WaveTable, name: string): unknown[] {
  expect(table.rows, `"${name}" holds one row for its one port`).toHaveLength(1)
  const row = table.rows[0]
  expect(Number.isInteger(row[4]), `"${name}" time_ms is an integer`).toBe(true)
  expect(row[4] as number, `"${name}" time_ms is not negative`).toBeGreaterThanOrEqual(0)
  return row
}

// --- console -------------------------------------------------------------
const tunnelLine = (localPort: number, farPort: string): string =>
  `SSH tunnel detected on local port ${localPort}: testing ${NETCAT_TARGET_SERVICE}:${farPort} from ${SSH_TARGET_HOST}`

const udpRefusal = (localPort: number): string =>
  `SSH tunnel detected on local port ${localPort}: SSH tunnels carry TCP only, so UDP cannot go through one`

/** Each line appears, in this order, at or after `from`; returns the position after the last. */
function expectInOrder(logs: string[], lines: string[], from: number, all: string): number {
  let at = from
  for (const line of lines) {
    const found = logs.indexOf(line, at)
    expect(found, `expected "${line}" after console line ${at}.\n${all}`).toBeGreaterThanOrEqual(at)
    at = found + 1
  }
  return at
}

let createdTestId: string | null = null

test.describe('Netcat through SSH tunnels', () => {
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

  test('checks and talks to a far port through a tunnel, reports a refused far port and refuses UDP', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const fixture = loadFixture()
    expectStackTargets(fixture)
    const talkValues = valuesOf(fixture, NODE.talk)
    const talkText = String(talkValues.text)
    const talkBytes = Buffer.byteLength(talkText, 'utf8')
    const talkTimeoutMs = Number(talkValues.timeout) * 1000

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true })
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
    const logs = await finishRun(page, status, BOOKEND, 120_000)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)
    const vars = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables

    const countOf = (line: string): number => logs.filter((text) => text === line).length
    const expectLevel = (line: string, level: string, times = 1): void => {
      expect(
        entries.filter((entry) => entry.message === line).map((entry) => entry.level),
        `expected "${line}" ${times} time(s) at ${level}.\n${all}`,
      ).toEqual(Array<string>(times).fill(level))
    }

    const pEcho = cell(vars, 'lport_echo').value as number
    const pFar = cell(vars, 'lport_far').value as number
    const rangeNamed = Math.max(pFar, pEcho)
    // Both UDP refusals read the same when the echo tunnel holds the higher Local Port.
    const udpRefusalCount = (port: number): number =>
      (port === pEcho ? 1 : 0) + (port === rangeNamed ? 1 : 0)

    await test.step('every Block ends as expected and the run passed', async () => {
      for (const id of SUCCEEDING_IDS) await expectNodeStatus(page, id, 'success')
      for (const id of RECORDING_IDS) await expectNodeStatus(page, id, 'warning')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    let at = 0

    await test.step('the session opens and both tunnels bind distinct Local Ports', () => {
      expect(all.includes('Permission denied'), `the secret password must authenticate.\n${all}`).toBe(
        false,
      )
      expect(Number.isInteger(pEcho) && pEcho > 0, `echo tunnel Local Port: ${pEcho}`).toBe(true)
      expect(Number.isInteger(pFar) && pFar > 0, `far tunnel Local Port: ${pFar}`).toBe(true)
      expect(pEcho, 'the two tunnels listen on different Local Ports').not.toBe(pFar)
      expect(cell(vars, 'tid_echo').value, 'the two tunnels are separate handles').not.toBe(
        cell(vars, 'tid_far').value,
      )
      at = expectInOrder(
        logs,
        ['nct-session connected=True', `nct-tunnels echo=${pEcho} far=${pFar}`],
        at,
        all,
      )
    })

    await test.step('a TCP Check of the tunnel Local Port reports the far echo open (NETCAT-9)', () => {
      expect(cell(vars, 'open_ok').value, 'the far echo accepts the channel').toBe(true)
      const results = tableOf(vars, 'open_res')
      expect(columnsOf(results), 'Check Results carry no reply column').toEqual(CHECK_COLUMNS)
      expect(onlyRow(results, 'open_res').slice(0, 4)).toEqual([pEcho, 'tcp', 'open', ''])

      const detected = tunnelLine(pEcho, NETCAT_TCP_ECHO_PORT)
      expectLevel(detected, 'INFO', 2)
      at = expectInOrder(
        logs,
        [
          `Checking ${LOOPBACK_HOST} port ${pEcho} over TCP`,
          detected,
          `Port ${pEcho}/tcp open`,
          `nct-open success=True rows=1 port=${pEcho} protocol=tcp state=open reason=[]`,
        ],
        at,
        all,
      )
    })

    await test.step('Talk Text through the tunnel gets the exact echo back (NETCAT-16)', () => {
      expect(cell(vars, 'talk_ok').value, 'the Talk passed').toBe(true)
      expect(cell(vars, 'talk_reply').value, 'Reply is the echoed Text, byte for byte').toBe(talkText)
      const results = tableOf(vars, 'talk_res')
      expect(columnsOf(results), 'Talk Results add the reply column').toEqual(TALK_COLUMNS)
      const row = onlyRow(results, 'talk_res')
      expect(row, 'the Results row carries the same reply').toEqual([
        pEcho,
        'tcp',
        'open',
        '',
        row[4],
        talkText,
      ])
      expect(
        row[4] as number,
        'Close after sending ends the reply at the far close, not after Timeout of silence',
      ).toBeLessThan(talkTimeoutMs)

      at = expectInOrder(
        logs,
        [
          `Talking to ${LOOPBACK_HOST} port ${pEcho} over TCP`,
          tunnelLine(pEcho, NETCAT_TCP_ECHO_PORT),
          `Port ${pEcho}/tcp open`,
          `Sent ${talkBytes} bytes, received ${talkBytes} bytes`,
          `nct-talk success=True state=open reply=[${talkText}] row-reply=[${talkText}]`,
        ],
        at,
        all,
      )
    })

    await test.step('a far port with no listener is closed with the SSH server reason (NETCAT-8)', () => {
      expect(cell(vars, 'far_ok').value, 'Record and continue: Success is false').toBe(false)
      expect(cell(vars, 'far_reason').value, 'a closed Single port fails as Closed').toBe('Closed')
      const results = tableOf(vars, 'far_res')
      expect(columnsOf(results)).toEqual(CHECK_COLUMNS)
      const row = onlyRow(results, 'far_res')
      expect(row.slice(0, 3), 'Results keep the measured far state').toEqual([pFar, 'tcp', 'closed'])
      const reason = String(row[3])
      expect(reason, 'the reason is the SSH server refusal text').toBe(REFUSED)

      const message = `Port ${pFar} on ${LOOPBACK_HOST} is closed: ${reason}`
      expect(cell(vars, 'far_err').value, 'Error carries the failure message').toBe(message)
      expectLevel(`Netcat failed (Closed): ${message}`, 'WARN')
      expectLevel(tunnelLine(pFar, NETCAT_CLOSED_PORT), 'INFO')

      at = expectInOrder(
        logs,
        [
          `Checking ${LOOPBACK_HOST} port ${pFar} over TCP`,
          tunnelLine(pFar, NETCAT_CLOSED_PORT),
          `Port ${pFar}/tcp closed: ${reason}`,
          `Netcat failed (Closed): ${message}`,
          `nct-far success=False reason=Closed rows=1 state=closed row-reason=[${reason}] error=[${message}]`,
        ],
        at,
        all,
      )
    })

    await test.step('UDP to a tunnel Local Port is refused before any dial (NETCAT-18)', () => {
      const message = udpRefusal(pEcho)
      expect(cell(vars, 'udp_ok').value).toBe(false)
      expect(cell(vars, 'udp_reason').value, 'the refusal carries reason Tunnel').toBe('Tunnel')
      expect(cell(vars, 'udp_err').value).toBe(message)
      const results = tableOf(vars, 'udp_res')
      expect(columnsOf(results)).toEqual(CHECK_COLUMNS)
      expect(results.rows, 'no port was measured').toEqual([])
      expectLevel(`Netcat failed (Tunnel): ${message}`, 'WARN', udpRefusalCount(pEcho))
      expect(
        logs.some((text) => text.startsWith(`Port ${pEcho}/udp`)),
        `no UDP port result line may appear.\n${all}`,
      ).toBe(false)

      at = expectInOrder(
        logs,
        [
          `Checking ${LOOPBACK_HOST} port ${pEcho} over UDP`,
          `Netcat failed (Tunnel): ${message}`,
          `nct-udp success=False reason=Tunnel rows=0 error=[${message}]`,
        ],
        at,
        all,
      )
    })

    await test.step('a UDP Range names its first tunnel port in written order (NETCAT-2, NETCAT-18)', () => {
      const message = udpRefusal(rangeNamed)
      expect(cell(vars, 'udpr_ok').value).toBe(false)
      expect(cell(vars, 'udpr_reason').value).toBe('Tunnel')
      expect(cell(vars, 'udpr_err').value, 'the plain port before it is skipped, not named').toBe(
        message,
      )
      const results = tableOf(vars, 'udpr_res')
      expect(columnsOf(results)).toEqual(CHECK_COLUMNS)
      expect(results.rows, 'no port of the Range was measured').toEqual([])
      expectLevel(`Netcat failed (Tunnel): ${message}`, 'WARN', udpRefusalCount(rangeNamed))
      expect(
        logs.some((text) => / of 3$/.test(text)),
        `a refused Range writes no summary line.\n${all}`,
      ).toBe(false)

      at = expectInOrder(
        logs,
        [
          `Checking 3 ports on ${LOOPBACK_HOST} over UDP`,
          `Netcat failed (Tunnel): ${message}`,
          `nct-udp-range success=False reason=Tunnel rows=0 error=[${message}]`,
        ],
        at,
        all,
      )
    })

    await test.step('after the tunnel closes its old Local Port is dialed locally (NETCAT-9)', () => {
      expect(cell(vars, 'closed_echo').value, 'the echo tunnel closed').toBe(true)
      expect(cell(vars, 'gone_ok').value).toBe(false)
      expect(cell(vars, 'gone_reason').value).toBe('Closed')
      const results = tableOf(vars, 'gone_res')
      expect(columnsOf(results)).toEqual(CHECK_COLUMNS)
      const row = onlyRow(results, 'gone_res')
      expect(row.slice(0, 3), 'nothing listens on the old Local Port').toEqual([pEcho, 'tcp', 'closed'])
      const reason = String(row[3])
      expect(reason, "the reason is the operating system's text").toBe(REFUSED)

      const message = `Port ${pEcho} on ${LOOPBACK_HOST} is closed: ${reason}`
      expect(cell(vars, 'gone_err').value).toBe(message)
      expectLevel(`Netcat failed (Closed): ${message}`, 'WARN')
      expect(
        countOf(tunnelLine(pEcho, NETCAT_TCP_ECHO_PORT)),
        'only the two Blocks run while the tunnel was open detect it',
      ).toBe(2)

      at = expectInOrder(
        logs,
        [
          `Checking ${LOOPBACK_HOST} port ${pEcho} over TCP`,
          `Port ${pEcho}/tcp closed: ${reason}`,
          `Netcat failed (Closed): ${message}`,
          `nct-gone closed-tunnel=True success=False reason=Closed state=closed error=[${message}]`,
        ],
        at,
        all,
      )
    })

    await test.step('the workflow closes the far tunnel and the session', () => {
      expect(cell(vars, 'closed_far').value, 'the far tunnel closed').toBe(true)
      expect(cell(vars, 'closed_ids').value, 'the session close lists the one session').toEqual([
        cell(vars, 'sid').value,
      ])
      expectInOrder(logs, [`nct-closes far=True sessions=1 ${BOOKEND}`], at, all)
    })
  })
})
