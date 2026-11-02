/**
 * V-PLUGIN-NETCAT-REMOTE-FUNCTIONAL: Netcat inside a Remote Execution body
 * Wireframe: N/A
 * Design Decisions: NETCAT-1, NETCAT-3, NETCAT-5, NETCAT-6, NETCAT-7, NETCAT-8, NETCAT-10,
 *   NETCAT-13, NETCAT-15, NETCAT-16, NETCAT-17
 * REQ: REQ-3.3.4.3, REQ-3.4.1.9
 *
 * One run against the real `sshd` host of the E2E stack. `fixture.json` opens an SSH session,
 * writes a payload file on the remote host, then runs six Netcat blocks inside a Remote
 * Execution body against `netcat-target`, a service only the remote host can reach:
 *   TCP Check 9470, Talk Text 9470, Talk File `testdata://payload.txt` 9470,
 *   Talk File from a plain path on the remote host 9470, UDP Check 9471 (echo),
 *   UDP Check 9472 (silent sink).
 * The `then` branch removes the remote file, dials the same Host from WAVE under Record and
 * continue, and logs every bound output.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with the SSH host rewritten for the mode, the
 *    payload lands in the test's Test Data, and POST /tests/{id}/validate reports zero errors.
 * 2. Every Netcat block inside the body carries one R badge; nothing outside the body carries
 *    a locus badge, the WAVE-side Netcat block included.
 * 3. The run passes; every block ends successful except the WAVE-side Netcat block, which
 *    records its failure and is painted amber.
 * 4. TCP Check of 9470 on the remote host: Success true, one Results row `9470 tcp open` with
 *    an empty reason and an integer time_ms, and the lines
 *    `Checking netcat-target port 9470 over TCP` and `Port 9470/tcp open`.
 * 5. Talk Text: the echo comes back in Reply and in the Results reply column, the traffic line
 *    counts the Text's bytes both ways, and with Close after sending off the reply ends only
 *    after Timeout seconds of silence.
 * 6. Talk File with a `testdata://` payload: the file is read on WAVE and shipped; Reply and the
 *    reply column equal the file exactly, and with Close after sending on the reply ends when
 *    the server closes, before Timeout.
 * 7. Talk File with a plain path: the file the SSH session wrote on the remote host comes back,
 *    so a plain path is read where the block runs.
 * 8. UDP Check of 9471: the `X` probe is echoed, so the port is `open`.
 * 9. UDP Check of the silent sink 9472: `open or filtered` with `No reply within 2 seconds`,
 *    and Success true.
 * 10. The same Host from WAVE fails with `Could not resolve host: netcat-target`, reason
 *     Unresolved and empty Results, so the body's answers came from the remote host.
 * 11. Every bound output reaches a Log block after the body, and the remote file is gone.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { uploadTestData } from '../../helpers/testdata'
import { validateTest } from '../../helpers/fn-seed'
import { getLogRows, type LogRow } from '../../helpers/log-reader'
import { expectNodeStatus, expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import {
  BACKEND_URL,
  NETCAT_TARGET_SERVICE,
  NETCAT_TCP_ECHO_PORT,
  NETCAT_UDP_ECHO_PORT,
  NETCAT_UDP_SILENT_PORT,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
    elementType: string
    config: { values: Record<string, unknown>; outputBindings: Record<string, string> }
  }
}

interface Fixture {
  name: string
  workflow: { nodes: FixtureNode[]; edges: Array<Record<string, unknown>> }
  variables: Record<string, { value: unknown; type: string; scope: string }>
  [key: string]: unknown
}

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')) as Fixture
}

function nodeOf(fixture: Fixture, id: string): FixtureNode {
  const found = fixture.workflow.nodes.find((entry) => entry.id === id)
  expect(found, `the fixture must declare a node "${id}"`).toBeTruthy()
  return found as FixtureNode
}

function valuesOf(fixture: Fixture, id: string): Record<string, unknown> {
  return nodeOf(fixture, id).data.config.values
}

// --- fixture node ids ----------------------------------------------------
const NODE = {
  sshOpen: '511cfe14-6015-468b-9452-d21b60d93ce2',
  seedRemote: '3489d4c5-fe89-4ca2-b13b-5c9a7d083f84',
  container: '8eaa5b2d-8f0b-4047-a578-e813938201b1',
  checkTcp: 'a95519fa-b8b9-4b7e-bfbc-b3c1b3bf95d3',
  talkText: 'aabb60be-c3ed-43fd-948a-5ed271fe1aa5',
  talkTestData: '6e997316-2f8c-44b8-a903-f5c3e17c8beb',
  talkPlain: 'ed365494-a92a-44d3-9609-3a5a6164e23c',
  checkUdp: '0bb8c7e7-4e77-47bb-ba0d-d5654eb5e6a1',
  checkUdpSilent: '9e9ceb60-5546-428f-98c5-4a572d139083',
  sshCleanup: '47d9b421-91b2-4f8c-8f53-27cb97d020c2',
  waveSide: '6b42bd62-8c78-4acc-b4e2-05509ba5b06b',
  logTcp: '39fb89f4-fa07-4917-9271-9d99accf5484',
  logText: 'd859bdd5-78dd-4261-9643-94a010fab60b',
  logTestData: 'db0daf58-103a-46f3-9646-bbf96c7a115a',
  logPlain: '3dcc9a8d-620f-4342-9f61-a93dcea011cd',
  logUdp: '8f7efcec-622a-4849-bb68-3c9c1f77e51a',
  logSilent: 'b0ff1fd6-7396-4a7f-ba08-d533c7be1e44',
  logWave: '22afbac9-2c8a-41a2-b03a-ac65e660d724',
  logDone: '57a2996c-d136-4b9a-bce7-5ad29e956414',
} as const

/** The Netcat blocks inside the container body - remotable, so every one is R. */
const BODY_IDS = [
  NODE.checkTcp,
  NODE.talkText,
  NODE.talkTestData,
  NODE.talkPlain,
  NODE.checkUdp,
  NODE.checkUdpSilent,
] as const

/** Everything outside the body, the WAVE-side Netcat block included: no locus badge. */
const OUTSIDE_IDS = [
  NODE.sshOpen,
  NODE.seedRemote,
  NODE.container,
  NODE.sshCleanup,
  NODE.waveSide,
  NODE.logTcp,
  NODE.logText,
  NODE.logTestData,
  NODE.logPlain,
  NODE.logUdp,
  NODE.logSilent,
  NODE.logWave,
  NODE.logDone,
] as const

const SUCCESS_IDS = [...BODY_IDS, ...OUTSIDE_IDS.filter((id) => id !== NODE.waveSide)]

const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
const NETCAT_SOURCE = 'Netcat'
const BOOKEND = 'netcat-remote-done'
const PAYLOAD_NAME = 'payload.txt'

const CHECK_COLUMNS = [
  { name: 'port', type: 'integer' },
  { name: 'protocol', type: 'string' },
  { name: 'state', type: 'string' },
  { name: 'reason', type: 'string' },
  { name: 'time_ms', type: 'integer' },
]
const TALK_COLUMNS = [...CHECK_COLUMNS, { name: 'reply', type: 'string' }]

const TCP_ECHO = Number(NETCAT_TCP_ECHO_PORT)
const UDP_ECHO = Number(NETCAT_UDP_ECHO_PORT)
const UDP_SILENT = Number(NETCAT_UDP_SILENT_PORT)

/** The SSH block must carry the harness constants, not a copy that drifted. */
function expectStackSshTarget(fixture: Fixture): void {
  const values = valuesOf(fixture, NODE.sshOpen)
  expect(values.host, 'the fixture carries the host-mode sentinel the import helper rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(values.port), 'the fixture targets the stack sshd port').toBe(SSH_MAIN_PORT)
  expect(values.username, 'the fixture uses the stack SSH user').toBe(SSH_STACK_USER)
  expect(values.password, 'the fixture uses the stack SSH password').toBe(SSH_STACK_PASSWORD)
}

/** Every Netcat block dials the internal-only service on the port its leg is about. */
function expectNetcatTargets(fixture: Fixture): void {
  const ports: Array<[string, string]> = [
    [NODE.checkTcp, NETCAT_TCP_ECHO_PORT],
    [NODE.talkText, NETCAT_TCP_ECHO_PORT],
    [NODE.talkTestData, NETCAT_TCP_ECHO_PORT],
    [NODE.talkPlain, NETCAT_TCP_ECHO_PORT],
    [NODE.checkUdp, NETCAT_UDP_ECHO_PORT],
    [NODE.checkUdpSilent, NETCAT_UDP_SILENT_PORT],
    [NODE.waveSide, NETCAT_TCP_ECHO_PORT],
  ]
  for (const [id, port] of ports) {
    const values = valuesOf(fixture, id)
    expect(nodeOf(fixture, id).data.elementType, `${id} is a Netcat block`).toBe('netcat')
    expect(values.host, `${id} dials the service only the remote host can reach`).toBe(
      NETCAT_TARGET_SERVICE,
    )
    expect(String(values.port), `${id} dials its leg's listener`).toBe(port)
  }
  expect(
    valuesOf(fixture, NODE.talkTestData).file,
    'the WAVE-read leg only means anything with a testdata:// payload',
  ).toBe(`testdata://${PAYLOAD_NAME}`)
  expect(valuesOf(fixture, NODE.waveSide).on_error, 'the WAVE-side leg records its failure').toBe(
    'record',
  )
}

// --- console and variable helpers ----------------------------------------
function dump(rows: readonly LogRow[]): string {
  return rows.map((row) => `[${row.level}] ${row.source}: ${row.message}`).join('\n')
}

function rowWith(rows: readonly LogRow[], message: string): LogRow {
  const hit = rows.find((row) => row.message === message)
  expect(hit, `the console must carry the line "${message}".\n${dump(rows)}`).toBeTruthy()
  return hit as LogRow
}

/** A Netcat line, written exactly `count` times at `level`. */
function expectNetcatLine(
  rows: readonly LogRow[],
  message: string,
  count: number,
  level = 'INFO',
): void {
  const hits = rows.filter((row) => row.message === message)
  expect(hits, `the console must carry "${message}" ${count} time(s).\n${dump(rows)}`).toHaveLength(
    count,
  )
  for (const hit of hits) {
    expect(hit.level, `"${message}" is a ${level} line`).toBe(level)
    expect(hit.source, `"${message}" is the Netcat block's own line`).toBe(NETCAT_SOURCE)
  }
}

function cell(variables: SessionVariables, name: string): { value: unknown; type: string } {
  expect(variables[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return variables[name]
}

/** The one Results row of a Single block, checked for its columns and an integer time_ms. */
function singleRow(
  variables: SessionVariables,
  name: string,
  columns: typeof CHECK_COLUMNS,
): { row: unknown[]; timeMs: number } {
  const bound = cell(variables, name)
  expect(bound.type, `${name} binds a table`).toBe('table')
  const table = bound.value as WaveTable
  expect(table.columns, `${name} carries the Results columns of its mode`).toEqual(columns)
  expect(table.rows, `${name} holds one row for its one port`).toHaveLength(1)
  const row = table.rows[0]
  const timeMs = row[4] as number
  expect(Number.isInteger(timeMs), `${name} time_ms is an integer, got ${String(row[4])}`).toBe(true)
  expect(timeMs, `${name} time_ms is never negative`).toBeGreaterThanOrEqual(0)
  return { row, timeMs }
}

/** Every body member shows one R badge; nothing outside the body shows one. */
async function expectRemoteLocusBadges(page: Page): Promise<void> {
  for (const id of BODY_IDS) {
    const badge = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    await expect(badge, `${id} is a remotable block inside the body`).toHaveCount(1)
    await expect(badge, `${id} runs on the remote host`).toHaveAttribute('data-locus', 'R')
    await expect(badge).toHaveText('R')
  }
  for (const id of OUTSIDE_IDS) {
    await expect(
      page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`),
      `${id} sits outside the body, so it carries no locus badge`,
    ).toHaveCount(0)
  }
  await expect(
    page.locator(`${LOCUS_BADGE}[data-locus="L"]`),
    'every body member is remotable, so nothing is marked as running on WAVE',
  ).toHaveCount(0)
  await expect(page.locator(LOCUS_BADGE), 'one badge per body member').toHaveCount(BODY_IDS.length)
}

let createdTestId: string | null = null

test.describe('V-PLUGIN-NETCAT-REMOTE-FUNCTIONAL: Netcat inside a Remote Execution body', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    if (!createdTestId) return
    const resp = await request.delete(`${BACKEND_URL}/tests/${createdTestId}`)
    expect([204, 404], `teardown must remove the imported Test, got ${resp.status()}`).toContain(
      resp.status(),
    )
    createdTestId = null
  })

  test('checks and talks to a service only the remote host can reach, and the answers come back to the run', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const fixture = loadFixture()
    expectStackSshTarget(fixture)
    expectNetcatTargets(fixture)

    // The sshd host is shared by every shard, so this run writes under its own folder.
    const runDir = `/tmp/wave-e2e-ncrem-${randomUUID().slice(0, 8)}`
    fixture.variables.run_dir.value = runDir
    const plainText = String(fixture.variables.plain_text.value)

    const talkText = String(valuesOf(fixture, NODE.talkText).text)
    const textTimeout = Number(valuesOf(fixture, NODE.talkText).timeout)
    const fileTimeout = Number(valuesOf(fixture, NODE.talkTestData).timeout)
    const plainTimeout = Number(valuesOf(fixture, NODE.talkPlain).timeout)
    const silentTimeout = Number(valuesOf(fixture, NODE.checkUdpSilent).timeout)
    const checkTimeout = Number(valuesOf(fixture, NODE.checkTcp).timeout)
    const udpTimeout = Number(valuesOf(fixture, NODE.checkUdp).timeout)
    expect(valuesOf(fixture, NODE.talkText).close_after_send, 'the Text leg waits out the silence').toBe(
      false,
    )
    expect(
      valuesOf(fixture, NODE.talkTestData).close_after_send,
      'the File leg half-closes so the echo closes its side',
    ).toBe(true)

    const payload = fs.readFileSync(path.resolve(__dirname, PAYLOAD_NAME))
    const payloadText = payload.toString('utf-8')

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, fixture, { injectSsh: true })
    createdTestId = testId
    await uploadTestData(page.request, testId, '', PAYLOAD_NAME, payload, {
      mimeType: 'text/plain',
    })

    await test.step('the imported workflow validates with zero errors', async () => {
      const result = await validateTest(page.request, testId, 'run')
      expect(result.status, `validate answered ${result.status}`).toBe(200)
      expect(
        result.errors,
        `the remote fixture must validate clean. Got: ${JSON.stringify(result.errors)}`,
      ).toHaveLength(0)
    })

    await test.step('the canvas marks every Netcat block in the body as running on the remote host', async () => {
      await expectRemoteLocusBadges(page)
    })

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 240_000)
    const rows = await getLogRows(page)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('every block succeeded except the WAVE-side one, which recorded its failure', async () => {
      await expectNodesSuccess(page, SUCCESS_IDS)
      await expectNodeStatus(page, NODE.waveSide, 'warning')
    })

    await test.step('the session and the container ran on the stack host', () => {
      expect(
        String(cell(variables, 'ssh_host').value).trim(),
        'the SSH session runs on the stack sshd container',
      ).toBe('wave-e2e-host')
      expect(String(cell(variables, 'rsid').value), 'the container binds a worker handle').toMatch(
        /^[0-9a-f]{32}$/,
      )
    })

    await test.step('every block wrote its start line', () => {
      const host = NETCAT_TARGET_SERVICE
      // One from the body, one from the WAVE-side block.
      expectNetcatLine(rows, `Checking ${host} port ${TCP_ECHO} over TCP`, 2)
      expectNetcatLine(rows, `Talking to ${host} port ${TCP_ECHO} over TCP`, 3)
      expectNetcatLine(rows, `Checking ${host} port ${UDP_ECHO} over UDP`, 1)
      expectNetcatLine(rows, `Checking ${host} port ${UDP_SILENT} over UDP`, 1)
    })

    await test.step('TCP Check on the remote host finds the echo open', () => {
      expect(cell(variables, 'tcp_ok').value, 'an open port passes').toBe(true)
      const { row, timeMs } = singleRow(variables, 'tcp_results', CHECK_COLUMNS)
      expect(row.slice(0, 4), 'port, protocol, state, and an empty reason for open').toEqual([
        TCP_ECHO,
        'tcp',
        'open',
        '',
      ])
      expect(timeMs, 'the connection was made well within Timeout').toBeLessThan(checkTimeout * 1000)
      // Check, Talk Text, Talk File from Test Data and Talk File from a plain path.
      expectNetcatLine(rows, `Port ${TCP_ECHO}/tcp open`, 4)
      rowWith(rows, `nc-remote tcp-check success=True port=${TCP_ECHO} state=open rows=1`)
    })

    await test.step('Talk Text gets its echo back in Reply and in the Results reply column', () => {
      const bytes = Buffer.byteLength(talkText, 'utf8')
      expect(cell(variables, 'text_ok').value, 'the port answered').toBe(true)
      expect(cell(variables, 'text_reply').value, 'Reply is the echoed Text').toBe(talkText)
      const { row, timeMs } = singleRow(variables, 'text_results', TALK_COLUMNS)
      expect(row.slice(0, 4)).toEqual([TCP_ECHO, 'tcp', 'open', ''])
      expect(row[5], 'the reply column holds the same echo').toBe(talkText)
      // Per NETCAT-6 and NETCAT-16: with Close after sending off, only silence ends the reply.
      expect(
        timeMs,
        `the reply ends after ${textTimeout} s of silence, so time_ms spans the whole wait`,
      ).toBeGreaterThanOrEqual(textTimeout * 1000)
      expectNetcatLine(rows, `Sent ${bytes} bytes, received ${bytes} bytes`, 1)
      rowWith(rows, `nc-remote talk-text success=True reply=${talkText} column=${talkText}`)
    })

    await test.step('Talk File sends the testdata:// file read on WAVE and gets it back whole', () => {
      expect(cell(variables, 'tdata_ok').value, 'the port answered').toBe(true)
      expect(
        cell(variables, 'tdata_reply').value,
        'the remote host has no Test Data, so only the shipped bytes can come back',
      ).toBe(payloadText)
      const { row, timeMs } = singleRow(variables, 'tdata_results', TALK_COLUMNS)
      expect(row.slice(0, 4)).toEqual([TCP_ECHO, 'tcp', 'open', ''])
      expect(row[5], 'the reply column holds the whole file').toBe(payloadText)
      expect(
        timeMs,
        'Close after sending makes the echo close its side, so the reply ends before Timeout',
      ).toBeLessThan(fileTimeout * 1000)
      expectNetcatLine(rows, `Sent ${payload.length} bytes, received ${payload.length} bytes`, 1)
      rowWith(
        rows,
        `nc-remote talk-testdata success=True chars=${payloadText.length} matches-column=True`,
      )
    })

    await test.step('Talk File reads a plain path on the remote host', () => {
      const bytes = Buffer.byteLength(plainText, 'utf8')
      expect(cell(variables, 'plain_ok').value, 'the port answered').toBe(true)
      // Only the remote host holds this file; WAVE has no such path.
      expect(cell(variables, 'plain_reply').value, `${runDir}/remote-payload.txt came back`).toBe(
        plainText,
      )
      const { row, timeMs } = singleRow(variables, 'plain_results', TALK_COLUMNS)
      expect(row.slice(0, 4)).toEqual([TCP_ECHO, 'tcp', 'open', ''])
      expect(row[5], 'the reply column holds the remote file').toBe(plainText)
      expect(timeMs, 'the echo closed its side before Timeout').toBeLessThan(plainTimeout * 1000)
      expectNetcatLine(rows, `Sent ${bytes} bytes, received ${bytes} bytes`, 1)
      rowWith(rows, `nc-remote talk-plain success=True reply=${plainText} column=${plainText}`)
    })

    await test.step('UDP Check of the echo is open: the X probe came back', () => {
      expect(cell(variables, 'udp_ok').value, 'an open port passes').toBe(true)
      const { row, timeMs } = singleRow(variables, 'udp_results', CHECK_COLUMNS)
      expect(row.slice(0, 4)).toEqual([UDP_ECHO, 'udp', 'open', ''])
      expect(timeMs, 'the reply arrived well within Timeout').toBeLessThan(udpTimeout * 1000)
      expectNetcatLine(rows, `Port ${UDP_ECHO}/udp open`, 1)
      rowWith(rows, `nc-remote udp-check success=True port=${UDP_ECHO} protocol=udp state=open`)
    })

    await test.step('UDP Check of the silent sink is open or filtered, and still passes', () => {
      const reason = `No reply within ${silentTimeout} seconds`
      expect(cell(variables, 'silent_ok').value, 'open or filtered counts as a pass').toBe(true)
      const { row, timeMs } = singleRow(variables, 'silent_results', CHECK_COLUMNS)
      expect(row.slice(0, 4)).toEqual([UDP_SILENT, 'udp', 'open or filtered', reason])
      expect(timeMs, 'the verdict waited out the whole Timeout').toBeGreaterThanOrEqual(
        silentTimeout * 1000,
      )
      expectNetcatLine(rows, `Port ${UDP_SILENT}/udp open or filtered: ${reason}`, 1)
      rowWith(
        rows,
        `nc-remote udp-silent success=True state=open or filtered reason=${reason}`,
      )
    })

    await test.step('the same Host from WAVE does not resolve, so the answers came from the remote host', () => {
      const message = `Could not resolve host: ${NETCAT_TARGET_SERVICE}`
      expect(cell(variables, 'wave_ok').value, 'the WAVE-side block did not pass').toBe(false)
      expect(cell(variables, 'wave_error').value, 'Error carries the failure').toBe(message)
      expect(cell(variables, 'wave_reason').value, 'Reason names the failure').toBe('Unresolved')
      const results = cell(variables, 'wave_results')
      expect(results.type, 'Results still binds a table').toBe('table')
      expect((results.value as WaveTable).columns, 'the Check columns').toEqual(CHECK_COLUMNS)
      expect((results.value as WaveTable).rows, 'no port was dialed').toEqual([])
      expectNetcatLine(rows, `Netcat failed (Unresolved): ${message}`, 1, 'WARN')
      rowWith(rows, 'nc-remote wave-side success=False reason=Unresolved rows=0')
    })

    await test.step('the remote file is gone and the run reached its bookend', () => {
      expect(
        String(cell(variables, 'gone_probe').value).trim(),
        `the then branch must leave the host without ${runDir}`,
      ).toBe('gone')
      rowWith(rows, `nc-remote cleanup=gone rsid-len=32 ${BOOKEND}`)
    })
  })
})
