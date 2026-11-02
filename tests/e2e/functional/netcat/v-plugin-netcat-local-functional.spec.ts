/**
 * V-PLUGIN-NETCAT-LOCAL-FUNCTIONAL: Netcat on the WAVE server against the real echo, sink and sshd
 * Wireframe: N/A
 * Design Decisions: NETCAT-2, NETCAT-3, NETCAT-4, NETCAT-5, NETCAT-6, NETCAT-7, NETCAT-8, NETCAT-10,
 *   NETCAT-11, NETCAT-13, NETCAT-15, NETCAT-16, NETCAT-17, NETCAT-19
 * REQ: REQ-3.3.4.3, REQ-3.4.1.9
 *
 * One workflow chains every local permutation. Blocks aimed at `netcat-echo` or `sshd` carry the
 * 127.0.0.1 sentinel the import rewrites to the SSH gateway; blocks aimed at the closed port carry
 * `localhost`, the dialing side's own loopback, which the import never rewrites.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests, the payload file uploads into the test's own Test
 *    Data, and the test validates with zero errors.
 * 2. TCP Check on the echo port: Success true, one Results row (port, tcp, open, empty reason,
 *    whole-number time_ms), and the lines `Checking {host} port {port} over TCP` and
 *    `Port {port}/tcp open`.
 * 3. TCP Check on the closed port at `localhost` under Record and continue: Success false, Reason
 *    Closed, Results reason `Connection refused`, Error
 *    `Port {port} on localhost is closed: Connection refused`, the WARN line
 *    `Netcat failed (Closed): {message}`, and Results still filled with the closed row.
 * 4. A Range written as the closed port, then the echo port: One succeeds passes; All succeed
 *    records NotAllSucceeded with `1 of 2 ports on {host} did not succeed: {port} {state}`; both
 *    Results hold two rows in the written order, not ascending, with the echo port open. The
 *    closed port's state is never pinned, because it is dialed through the gateway.
 * 5. UDP Check: the echo answers the X probe (open); the silent sink is `open or filtered` with
 *    `No reply within {n} seconds`, counts as a pass and leaves Error and Reason empty; the closed
 *    port at `localhost` is `closed` with `Connection refused` and recorded.
 * 6. Talk Text with CRLF line endings: 20 bytes out and 20 back, the reply is exactly
 *    `alpha\r\nbeta\r\ngamma\r\n`, a downstream Assert block passes on it, Results carries the
 *    reply column, and the reply ends only after Timeout seconds of silence. Every Timeout floor
 *    allows the server event loop's 1 ms timer granularity.
 * 7. Talk File from Test Data with Close after sending: the reply equals the uploaded file byte for
 *    byte and ends when the echo closes its side, before Timeout.
 * 8. Talk Nothing to sshd: the reply starts `SSH-2.0-` and `Sent 0 bytes` is logged.
 * 9. Talk Text over UDP: one datagram out, the echoed datagram is the Reply and the reply cell, and
 *    the reply ends only after Timeout seconds of silence.
 * 10. Max reply size 5: Reply and the reply cell keep the first 5 bytes, the reply ends before
 *     Timeout, `Sent {n} bytes, received 5 bytes` and the WARN line
 *     `Reply from port {port} stopped at 5 bytes` are written, and the block passes.
 * 11. A Range Talk keeps the reply in its Results reply column and writes the Range start line and
 *     summary.
 * 12. A Range whose only port is refused, One succeeds, under Record and continue: Reason
 *     NoneSucceeded, Error `No port on localhost succeeded (1 checked)`, Results holds the row.
 * 13. Talk File naming a Test Data file that does not exist, under Record and continue: Reason
 *     StartFailed, Error `Payload file not found: {path as written}`, Results and Reply empty, and
 *     no port result line.
 * 14. Fail the block inside a Try/Catch: the block paints failed, the ERROR line and the caught error
 *     carry the exact message, no Record WARN line is written, and the catch path logs it.
 * 15. Every bound value reaches a downstream Log, no Netcat line carries payload or reply bytes,
 *     the recorded blocks paint the warning state, and the run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  NETCAT_CLOSED_PORT,
  NETCAT_ECHO_HOST,
  NETCAT_TCP_ECHO_PORT,
  NETCAT_UDP_ECHO_PORT,
  NETCAT_UDP_SILENT_PORT,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_TARGET_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { uploadTestData } from '../../helpers/testdata'
import { blockSource, consoleEntriesFromCopy, sourcePlugin } from '../shell-blocks/shell-helpers'

// --- fixture shape -------------------------------------------------------
interface FixtureNode {
  id: string
  data: {
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

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }
type ResultRow = Record<string, unknown>

const FIXTURE_FILE = 'fixture.json'
const PAYLOAD_FILE = 'netcat-payload.txt'
const MISSING_PAYLOAD = 'testdata://netcat-no-such-payload.txt'
const BOOKEND = 'netcat-local-done'
/** The dialing side's own loopback, which the import rewrite never touches. */
const OWN_LOOPBACK = 'localhost'
/** The operating system's text for a refused port on the dialing side's own loopback (NETCAT-17). */
const REFUSED = 'Connection refused'
const CRLF_TEXT = 'alpha\nbeta\ngamma\n'
const CRLF_ON_THE_WIRE = 'alpha\r\nbeta\r\ngamma\r\n'
const SSH_BANNER_PREFIX = 'SSH-2.0-'
const REPLY_CAP = 5
/** The server's event loop keeps time in whole milliseconds, so a Timeout can end up to 1 ms early. */
const TIMER_GRANULARITY_MS = 1

const ECHO_TCP = Number(NETCAT_TCP_ECHO_PORT)
const ECHO_UDP = Number(NETCAT_UDP_ECHO_PORT)
const SILENT_UDP = Number(NETCAT_UDP_SILENT_PORT)
const CLOSED = Number(NETCAT_CLOSED_PORT)
const SSHD = Number(SSH_MAIN_PORT)

const CLOSED_MESSAGE = `Port ${CLOSED} on ${OWN_LOOPBACK} is closed: ${REFUSED}`

/** Fixture blocks, by the text each one carries as its Description and as its Name (EXEC-25, EXEC-26). */
const BLOCK = {
  tcpOpen: 'TCP check open',
  tcpClosed: 'TCP check closed recorded',
  rangeOne: 'Range one succeeds',
  rangeAll: 'Range all succeed recorded',
  udpEcho: 'UDP check echo',
  udpSilent: 'UDP check silent recorded',
  udpClosed: 'UDP check closed recorded',
  talkCrlf: 'Talk text CRLF',
  crlfAssert: 'CRLF reply exact',
  talkFile: 'Talk file',
  talkBanner: 'Talk banner',
  udpTalk: 'UDP talk echo',
  talkCapped: 'Talk capped reply',
  rangeTalk: 'Range talk',
  rangeNone: 'Range none succeed recorded',
  fileMissing: 'Talk file missing recorded',
  failCheck: 'TCP check closed fail',
} as const

const LOG_BLOCKS = [
  'TCP open proof',
  'TCP closed proof',
  'Range proof',
  'UDP proof',
  'Talk proof',
  'Talk extras proof',
  'Failure extras proof',
  'Fail caught',
  'Done',
] as const

const PASSING_BLOCKS = [
  BLOCK.tcpOpen,
  BLOCK.rangeOne,
  BLOCK.udpEcho,
  BLOCK.udpSilent,
  BLOCK.talkCrlf,
  BLOCK.crlfAssert,
  BLOCK.talkFile,
  BLOCK.talkBanner,
  BLOCK.udpTalk,
  BLOCK.talkCapped,
  BLOCK.rangeTalk,
  ...LOG_BLOCKS,
]
const RECORDED_BLOCKS = [
  BLOCK.tcpClosed,
  BLOCK.rangeAll,
  BLOCK.udpClosed,
  BLOCK.rangeNone,
  BLOCK.fileMissing,
]

const CHECK_COLUMNS = [
  { name: 'port', type: 'integer' },
  { name: 'protocol', type: 'string' },
  { name: 'state', type: 'string' },
  { name: 'reason', type: 'string' },
  { name: 'time_ms', type: 'integer' },
]
const TALK_COLUMNS = [...CHECK_COLUMNS, { name: 'reply', type: 'string' }]

const STATE_ORDER = ['open', 'closed', 'timed out', 'open or filtered']

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

function timeoutOf(fixture: Fixture, description: string): number {
  const timeout = valuesOf(fixture, description).timeout
  expect(Number.isInteger(timeout), `"${description}" sets a whole-second Timeout`).toBe(true)
  return timeout as number
}

function textOf(fixture: Fixture, description: string): string {
  const text = valuesOf(fixture, description).text
  expect(typeof text === 'string' && text !== '', `"${description}" sends a non-empty Text`).toBe(
    true,
  )
  return text as string
}

/** The fixture must carry the harness endpoints and the Netcat host scheme, not copies that drifted. */
function expectFixtureEndpoints(fixture: Fixture): void {
  const dials = (description: string, host: string, port: string): void => {
    const values = valuesOf(fixture, description)
    expect(values.host, `"${description}" carries the host the import expects`).toBe(host)
    expect(String(values.port), `"${description}" dials the harness port`).toBe(port)
  }
  const ranges = (description: string, host: string, portRange: string, why: string): void => {
    const values = valuesOf(fixture, description)
    expect(values.host, `"${description}" carries the host the import expects`).toBe(host)
    expect(values.port_range, `"${description}" ${why}`).toBe(portRange)
  }
  dials(BLOCK.tcpOpen, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT)
  dials(BLOCK.tcpClosed, OWN_LOOPBACK, NETCAT_CLOSED_PORT)
  dials(BLOCK.udpEcho, SSH_FIXTURE_HOST_SENTINEL, NETCAT_UDP_ECHO_PORT)
  dials(BLOCK.udpSilent, SSH_FIXTURE_HOST_SENTINEL, NETCAT_UDP_SILENT_PORT)
  dials(BLOCK.udpClosed, OWN_LOOPBACK, NETCAT_CLOSED_PORT)
  dials(BLOCK.talkCrlf, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT)
  dials(BLOCK.talkFile, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT)
  dials(BLOCK.talkBanner, SSH_FIXTURE_HOST_SENTINEL, SSH_MAIN_PORT)
  dials(BLOCK.udpTalk, SSH_FIXTURE_HOST_SENTINEL, NETCAT_UDP_ECHO_PORT)
  dials(BLOCK.talkCapped, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT)
  dials(BLOCK.fileMissing, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT)
  dials(BLOCK.failCheck, OWN_LOOPBACK, NETCAT_CLOSED_PORT)
  for (const description of [BLOCK.rangeOne, BLOCK.rangeAll]) {
    ranges(
      description,
      SSH_FIXTURE_HOST_SENTINEL,
      `${NETCAT_CLOSED_PORT}, ${NETCAT_TCP_ECHO_PORT}`,
      'writes the closed port first, so the written order is not ascending',
    )
  }
  ranges(BLOCK.rangeTalk, SSH_FIXTURE_HOST_SENTINEL, NETCAT_TCP_ECHO_PORT, 'talks to the echo')
  ranges(BLOCK.rangeNone, OWN_LOOPBACK, NETCAT_CLOSED_PORT, 'holds only the refused port')
  expect(valuesOf(fixture, BLOCK.talkCrlf).text, 'the CRLF payload is written with bare LF').toBe(
    CRLF_TEXT,
  )
  expect(valuesOf(fixture, BLOCK.talkFile).file, 'the File names the uploaded payload').toBe(
    `testdata://${PAYLOAD_FILE}`,
  )
  expect(valuesOf(fixture, BLOCK.fileMissing).file, 'the File names no uploaded file').toBe(
    MISSING_PAYLOAD,
  )
  const capped = valuesOf(fixture, BLOCK.talkCapped)
  expect(capped.max_reply_bytes, 'the capped Talk sets Max reply size').toBe(REPLY_CAP)
  expect(capped.close_after_send, 'only the cap can end the capped reply before Timeout').toBe(false)
  expect(
    textOf(fixture, BLOCK.talkCapped).length,
    'the capped Text is longer than the cap',
  ).toBeGreaterThan(REPLY_CAP)
  expect(valuesOf(fixture, BLOCK.rangeTalk).close_after_send, 'the echo closes its side').toBe(true)
}

// --- reading the run back ------------------------------------------------
function bound(variables: SessionVariables, name: string): unknown {
  expect(variables[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return variables[name].value
}

function boundText(variables: SessionVariables, name: string): string {
  const value = bound(variables, name)
  expect(typeof value, `"${name}" holds text`).toBe('string')
  return value as string
}

function boundRows(
  variables: SessionVariables,
  name: string,
  columns: ReadonlyArray<{ name: string; type: string }>,
): ResultRow[] {
  expect(variables[name]?.type, `"${name}" holds a table`).toBe('table')
  const table = variables[name].value as WaveTable
  expect(table.columns, `"${name}" carries the Results columns`).toEqual(columns)
  return table.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column.name, row[index]])),
  )
}

/** Assert a Results row apart from time_ms, check time_ms is a whole number, and return it. */
function expectRow(row: ResultRow, expected: ResultRow, what: string): number {
  const { time_ms: elapsed, ...rest } = row
  expect(rest, `${what}: the Results row`).toEqual(expected)
  expect(
    Number.isInteger(elapsed),
    `${what}: time_ms is a whole number of milliseconds, got ${JSON.stringify(elapsed)}`,
  ).toBe(true)
  expect(elapsed as number, `${what}: time_ms is never negative`).toBeGreaterThanOrEqual(0)
  return elapsed as number
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The Range summary line for the measured states, every zero count left out. */
function rangeSummary(states: string[]): string {
  const parts = STATE_ORDER.map((state) => ({
    state,
    count: states.filter((measured) => measured === state).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ state, count }) => `${count} ${state}`)
  return `${parts.join(', ')} of ${states.length}`
}

function dump(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`).join('\n')
}

/** Every line one Netcat block wrote at the console's level, as "LEVEL message", sorted. */
function netcatLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('Netcat', name)
  return entries
    .filter((entry) => entry.source === source)
    .map((entry) => `${entry.level} ${entry.message}`)
    .sort()
}

function expectNetcatLines(
  entries: readonly LogEntry[],
  name: string,
  expected: string[],
): void {
  expect(
    netcatLines(entries, name),
    `the console lines of "${name}".\n${dump(entries)}`,
  ).toEqual([...expected].sort())
}

function expectLine(entries: readonly LogEntry[], level: string, message: string): void {
  expect(
    entries.some((entry) => entry.level === level && entry.message === message),
    `the console must carry [${level}] "${message}".\n${dump(entries)}`,
  ).toBe(true)
}

// --- suite ---------------------------------------------------------------
test.describe('V-PLUGIN-NETCAT-LOCAL-FUNCTIONAL: Netcat on the WAVE server', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('Check, Range, UDP and Talk against the real services, recorded and failed', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const fixture = loadFixture()
    expectFixtureEndpoints(fixture)
    const payload = fs.readFileSync(path.resolve(__dirname, PAYLOAD_FILE))
    const payloadText = payload.toString('utf-8')
    const idOf = (description: string): string => nodeOf(fixture, description).id
    const udpTalkText = textOf(fixture, BLOCK.udpTalk)
    const cappedText = textOf(fixture, BLOCK.talkCapped)
    const cappedReply = cappedText.slice(0, REPLY_CAP)
    const rangeTalkText = textOf(fixture, BLOCK.rangeTalk)

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, fixture, {
      injectSsh: true,
      rejectRepairs: true,
    })
    createdTests.push(testId)

    expect(
      await uploadTestData(page.request, testId, '', PAYLOAD_FILE, payload),
      "the payload lands at the root of the test's own Test Data",
    ).toEqual({ path: PAYLOAD_FILE, size_bytes: payload.length, replaced: false })

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
      for (const description of RECORDED_BLOCKS) {
        await expectNodeStatus(page, idOf(description), 'warning')
      }
      await expectNodeStatus(page, idOf(BLOCK.failCheck), 'failed')
    })

    await test.step('TCP Check on the echo port reports open (NETCAT-8, NETCAT-15)', () => {
      expect(bound(variables, 'nc_tcp_open_ok'), 'an open port passes').toBe(true)
      const rows = boundRows(variables, 'nc_tcp_open_results', CHECK_COLUMNS)
      expect(rows, 'Single gives one Results row').toHaveLength(1)
      expectRow(rows[0], { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '' }, BLOCK.tcpOpen)
      expectNetcatLines(entries, BLOCK.tcpOpen, [
        `INFO Checking ${NETCAT_ECHO_HOST} port ${ECHO_TCP} over TCP`,
        `INFO Port ${ECHO_TCP}/tcp open`,
      ])
    })

    const tcpClosedError = boundText(variables, 'nc_tcp_closed_error')

    await test.step('TCP Check on the closed port records Closed and goes on (NETCAT-7, NETCAT-17)', () => {
      const rows = boundRows(variables, 'nc_tcp_closed_results', CHECK_COLUMNS)
      expect(rows, 'Record still fills Results with the measured port').toHaveLength(1)
      expectRow(
        rows[0],
        { port: CLOSED, protocol: 'tcp', state: 'closed', reason: REFUSED },
        BLOCK.tcpClosed,
      )
      expect(tcpClosedError, "the Closed message carries the operating system's text").toBe(
        CLOSED_MESSAGE,
      )
      expect(bound(variables, 'nc_tcp_closed_ok'), 'a closed port fails the pass rule').toBe(false)
      expect(boundText(variables, 'nc_tcp_closed_reason')).toBe('Closed')
      expectNetcatLines(entries, BLOCK.tcpClosed, [
        `INFO Checking ${OWN_LOOPBACK} port ${CLOSED} over TCP`,
        `INFO Port ${CLOSED}/tcp closed: ${REFUSED}`,
        `WARN Netcat failed (Closed): ${CLOSED_MESSAGE}`,
      ])
    })

    const rangeAllError = boundText(variables, 'nc_range_all_error')

    await test.step('A Range passes on One succeeds and records NotAllSucceeded on All succeed (NETCAT-2, NETCAT-3)', () => {
      const oneRows = boundRows(variables, 'nc_range_one_results', CHECK_COLUMNS)
      const allRows = boundRows(variables, 'nc_range_all_results', CHECK_COLUMNS)
      for (const [description, rows] of [
        [BLOCK.rangeOne, oneRows],
        [BLOCK.rangeAll, allRows],
      ] as const) {
        expect(
          rows.map((row) => row.port),
          `${description}: one row per port, in the order written`,
        ).toEqual([CLOSED, ECHO_TCP])
        expect(rows[0].protocol, `${description}: the first row is TCP too`).toBe('tcp')
        expect(
          Number.isInteger(rows[0].time_ms),
          `${description}: the first row measures a whole-number time_ms`,
        ).toBe(true)
        expectRow(rows[1], { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '' }, description)
        expectNetcatLines(entries, description, [
          `INFO Checking 2 ports on ${NETCAT_ECHO_HOST} over TCP`,
          `INFO ${rangeSummary(rows.map((row) => String(row.state)))}`,
          ...(description === BLOCK.rangeAll
            ? [`WARN Netcat failed (NotAllSucceeded): ${rangeAllError}`]
            : []),
        ])
      }

      expect(
        bound(variables, 'nc_range_one_ok'),
        'One succeeds passes on the open echo port written second',
      ).toBe(true)
      expect(bound(variables, 'nc_range_all_ok'), 'All succeed fails on the other port').toBe(false)
      expect(boundText(variables, 'nc_range_all_reason')).toBe('NotAllSucceeded')
      const notAll = new RegExp(
        `^1 of 2 ports on ${escapeRegExp(NETCAT_ECHO_HOST)} did not succeed: ${CLOSED} (.+)$`,
      )
      expect(rangeAllError, 'the message lists the one port that did not succeed').toMatch(notAll)
      expect(
        notAll.exec(rangeAllError)?.[1],
        'the message names the state Results measured for that port',
      ).toBe(allRows[0].state)
    })

    await test.step('UDP Check: echo open, silent sink open or filtered, closed port refused (NETCAT-8, NETCAT-13)', () => {
      expect(bound(variables, 'nc_udp_echo_ok'), 'the echo answers the X probe').toBe(true)
      const echo = boundRows(variables, 'nc_udp_echo_results', CHECK_COLUMNS)
      expect(echo).toHaveLength(1)
      expectRow(echo[0], { port: ECHO_UDP, protocol: 'udp', state: 'open', reason: '' }, BLOCK.udpEcho)
      expectNetcatLines(entries, BLOCK.udpEcho, [
        `INFO Checking ${NETCAT_ECHO_HOST} port ${ECHO_UDP} over UDP`,
        `INFO Port ${ECHO_UDP}/udp open`,
      ])

      const silentTimeout = timeoutOf(fixture, BLOCK.udpSilent)
      const silence = `No reply within ${silentTimeout} seconds`
      const silent = boundRows(variables, 'nc_udp_silent_results', CHECK_COLUMNS)
      expect(silent).toHaveLength(1)
      const waited = expectRow(
        silent[0],
        { port: SILENT_UDP, protocol: 'udp', state: 'open or filtered', reason: silence },
        BLOCK.udpSilent,
      )
      expect(waited, 'silence is concluded only once Timeout has run out').toBeGreaterThanOrEqual(
        silentTimeout * 1000 - TIMER_GRANULARITY_MS,
      )
      expect(bound(variables, 'nc_udp_silent_ok'), 'open or filtered counts as a pass').toBe(true)
      expect(boundText(variables, 'nc_udp_silent_error'), 'a pass leaves Error empty').toBe('')
      expect(boundText(variables, 'nc_udp_silent_reason'), 'a pass leaves Reason empty').toBe('')
      expectNetcatLines(entries, BLOCK.udpSilent, [
        `INFO Checking ${NETCAT_ECHO_HOST} port ${SILENT_UDP} over UDP`,
        `INFO Port ${SILENT_UDP}/udp open or filtered: ${silence}`,
      ])

      const closed = boundRows(variables, 'nc_udp_closed_results', CHECK_COLUMNS)
      expect(closed, 'Record still fills Results with the measured port').toHaveLength(1)
      expectRow(
        closed[0],
        { port: CLOSED, protocol: 'udp', state: 'closed', reason: REFUSED },
        BLOCK.udpClosed,
      )
      expect(boundText(variables, 'nc_udp_closed_error')).toBe(CLOSED_MESSAGE)
      expect(bound(variables, 'nc_udp_closed_ok')).toBe(false)
      expect(boundText(variables, 'nc_udp_closed_reason')).toBe('Closed')
      expectNetcatLines(entries, BLOCK.udpClosed, [
        `INFO Checking ${OWN_LOOPBACK} port ${CLOSED} over UDP`,
        `INFO Port ${CLOSED}/udp closed: ${REFUSED}`,
        `WARN Netcat failed (Closed): ${CLOSED_MESSAGE}`,
      ])
    })

    await test.step('Talk Text with CRLF line endings sends and gets back CR LF at every line end (NETCAT-5, NETCAT-16)', () => {
      const reply = boundText(variables, 'nc_crlf_reply')
      expect(JSON.stringify(reply), 'the echo returns the payload exactly as it was sent').toBe(
        JSON.stringify(CRLF_ON_THE_WIRE),
      )
      expect(bound(variables, 'nc_crlf_ok')).toBe(true)
      const rows = boundRows(variables, 'nc_crlf_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      const timeout = timeoutOf(fixture, BLOCK.talkCrlf)
      const elapsed = expectRow(
        rows[0],
        { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '', reply: CRLF_ON_THE_WIRE },
        BLOCK.talkCrlf,
      )
      expect(
        elapsed,
        'with Close after sending off, the echo keeps the connection open, so the reply ends after Timeout of silence',
      ).toBeGreaterThanOrEqual(timeout * 1000 - TIMER_GRANULARITY_MS)
      const wireBytes = Buffer.byteLength(CRLF_ON_THE_WIRE, 'utf-8')
      expectNetcatLines(entries, BLOCK.talkCrlf, [
        `INFO Talking to ${NETCAT_ECHO_HOST} port ${ECHO_TCP} over TCP`,
        `INFO Port ${ECHO_TCP}/tcp open`,
        `INFO Sent ${wireBytes} bytes, received ${wireBytes} bytes`,
      ])
      expect(
        entries.some(
          (entry) =>
            entry.message === 'All assertions passed' && entry.source.endsWith(BLOCK.crlfAssert),
        ),
        `the downstream Assert passed on the CR LF reply.\n${dump(entries)}`,
      ).toBe(true)
    })

    await test.step('Talk File sends the Test Data file and, with Close after sending, ends at the echo close (NETCAT-10, NETCAT-16)', () => {
      const reply = boundText(variables, 'nc_file_reply')
      expect(reply, 'the reply equals the uploaded file byte for byte').toBe(payloadText)
      expect(bound(variables, 'nc_file_ok')).toBe(true)
      const rows = boundRows(variables, 'nc_file_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      const timeout = timeoutOf(fixture, BLOCK.talkFile)
      const elapsed = expectRow(
        rows[0],
        { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '', reply: payloadText },
        BLOCK.talkFile,
      )
      expect(elapsed, 'the echo closes once the sending side is shut, well before Timeout').toBeLessThan(
        timeout * 1000,
      )
      expectNetcatLines(entries, BLOCK.talkFile, [
        `INFO Talking to ${NETCAT_ECHO_HOST} port ${ECHO_TCP} over TCP`,
        `INFO Port ${ECHO_TCP}/tcp open`,
        `INFO Sent ${payload.length} bytes, received ${payload.length} bytes`,
      ])
    })

    await test.step('Talk Nothing reads the sshd banner (NETCAT-4)', () => {
      const reply = boundText(variables, 'nc_banner_reply')
      expect(
        reply.startsWith(SSH_BANNER_PREFIX),
        `the sshd speaks first. Got ${JSON.stringify(reply)}`,
      ).toBe(true)
      expect(bound(variables, 'nc_banner_ok')).toBe(true)
      const rows = boundRows(variables, 'nc_banner_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      expectRow(
        rows[0],
        { port: SSHD, protocol: 'tcp', state: 'open', reason: '', reply },
        BLOCK.talkBanner,
      )
      expectNetcatLines(entries, BLOCK.talkBanner, [
        `INFO Talking to ${SSH_TARGET_HOST} port ${SSHD} over TCP`,
        `INFO Port ${SSHD}/tcp open`,
        `INFO Sent 0 bytes, received ${Buffer.byteLength(reply, 'utf-8')} bytes`,
      ])
    })

    await test.step('Talk Text over UDP sends one datagram and ends the reply on silence (NETCAT-16)', () => {
      expect(boundText(variables, 'nc_udp_talk_reply'), 'the echoed datagram is the Reply').toBe(
        udpTalkText,
      )
      expect(bound(variables, 'nc_udp_talk_ok')).toBe(true)
      const rows = boundRows(variables, 'nc_udp_talk_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      const timeout = timeoutOf(fixture, BLOCK.udpTalk)
      const elapsed = expectRow(
        rows[0],
        { port: ECHO_UDP, protocol: 'udp', state: 'open', reason: '', reply: udpTalkText },
        BLOCK.udpTalk,
      )
      expect(elapsed, 'a UDP reply ends only after Timeout seconds of silence').toBeGreaterThanOrEqual(
        timeout * 1000 - TIMER_GRANULARITY_MS,
      )
      const bytes = Buffer.byteLength(udpTalkText, 'utf-8')
      expectNetcatLines(entries, BLOCK.udpTalk, [
        `INFO Talking to ${NETCAT_ECHO_HOST} port ${ECHO_UDP} over UDP`,
        `INFO Port ${ECHO_UDP}/udp open`,
        `INFO Sent ${bytes} bytes, received ${bytes} bytes`,
      ])
    })

    await test.step('Max reply size stops reading at the cap and warns (NETCAT-5)', () => {
      expect(boundText(variables, 'nc_cap_reply'), 'Reply keeps only the first bytes').toBe(
        cappedReply,
      )
      expect(bound(variables, 'nc_cap_ok'), 'a capped reply still passes').toBe(true)
      const rows = boundRows(variables, 'nc_cap_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      const timeout = timeoutOf(fixture, BLOCK.talkCapped)
      const elapsed = expectRow(
        rows[0],
        { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '', reply: cappedReply },
        BLOCK.talkCapped,
      )
      expect(elapsed, 'the cap ends the reply, well before Timeout of silence').toBeLessThan(
        timeout * 1000,
      )
      expectNetcatLines(entries, BLOCK.talkCapped, [
        `INFO Talking to ${NETCAT_ECHO_HOST} port ${ECHO_TCP} over TCP`,
        `INFO Port ${ECHO_TCP}/tcp open`,
        `INFO Sent ${Buffer.byteLength(cappedText, 'utf-8')} bytes, received ${REPLY_CAP} bytes`,
        `WARN Reply from port ${ECHO_TCP} stopped at ${REPLY_CAP} bytes`,
      ])
    })

    await test.step('A Range Talk keeps each reply in the Results reply column (NETCAT-4, NETCAT-7)', () => {
      expect(bound(variables, 'nc_rtalk_ok')).toBe(true)
      const rows = boundRows(variables, 'nc_rtalk_results', TALK_COLUMNS)
      expect(rows).toHaveLength(1)
      const timeout = timeoutOf(fixture, BLOCK.rangeTalk)
      const elapsed = expectRow(
        rows[0],
        { port: ECHO_TCP, protocol: 'tcp', state: 'open', reason: '', reply: rangeTalkText },
        BLOCK.rangeTalk,
      )
      expect(elapsed, 'the echo closes once the sending side is shut').toBeLessThan(timeout * 1000)
      expectNetcatLines(entries, BLOCK.rangeTalk, [
        `INFO Talking to 1 ports on ${NETCAT_ECHO_HOST} over TCP`,
        `INFO ${rangeSummary(['open'])}`,
      ])
    })

    const noneError = boundText(variables, 'nc_none_error')

    await test.step('One succeeds with no port succeeding records NoneSucceeded (NETCAT-3)', () => {
      const rows = boundRows(variables, 'nc_none_results', CHECK_COLUMNS)
      expect(rows, 'Record still fills Results with the measured port').toHaveLength(1)
      expectRow(
        rows[0],
        { port: CLOSED, protocol: 'tcp', state: 'closed', reason: REFUSED },
        BLOCK.rangeNone,
      )
      expect(noneError).toBe(`No port on ${OWN_LOOPBACK} succeeded (1 checked)`)
      expect(bound(variables, 'nc_none_ok')).toBe(false)
      expect(boundText(variables, 'nc_none_reason')).toBe('NoneSucceeded')
      expectNetcatLines(entries, BLOCK.rangeNone, [
        `INFO Checking 1 ports on ${OWN_LOOPBACK} over TCP`,
        `INFO ${rangeSummary(['closed'])}`,
        `WARN Netcat failed (NoneSucceeded): ${noneError}`,
      ])
    })

    const missingError = `Payload file not found: ${MISSING_PAYLOAD}`

    await test.step('A payload file that does not exist fails before any port is dialed (NETCAT-19)', () => {
      expect(boundText(variables, 'nc_missing_error'), 'the message names the value as written').toBe(
        missingError,
      )
      expect(boundText(variables, 'nc_missing_reason')).toBe('StartFailed')
      expect(bound(variables, 'nc_missing_ok')).toBe(false)
      expect(
        boundRows(variables, 'nc_missing_results', TALK_COLUMNS),
        'no port was measured',
      ).toEqual([])
      expect(boundText(variables, 'nc_missing_reply'), 'nothing was read').toBe('')
      expectNetcatLines(entries, BLOCK.fileMissing, [
        `INFO Talking to ${NETCAT_ECHO_HOST} port ${ECHO_TCP} over TCP`,
        `WARN Netcat failed (StartFailed): ${missingError}`,
      ])
    })

    const failError = bound(variables, 'nc_fail_error') as Record<string, unknown>
    const failMessage = String(failError?.message)

    await test.step('Fail the block inside a Try/Catch fails the block with the exact message (NETCAT-7)', () => {
      expect(bound(variables, 'nc_fail_caught'), 'the Try/Catch caught the failure').toBe(true)
      expect(failMessage, 'the block error is the Closed message').toBe(CLOSED_MESSAGE)
      expect(failError.node, 'the error names the Netcat block').toBe(BLOCK.failCheck)
      expect(failError.node_id, 'the error points at the Netcat block').toBe(idOf(BLOCK.failCheck))
      expectLine(entries, 'ERROR', `Block '${BLOCK.failCheck}' failed: ${failMessage}`)
      expectLine(entries, 'WARN', `Try-path error caught: ${failMessage}`)
      expectNetcatLines(entries, BLOCK.failCheck, [
        `INFO Checking ${OWN_LOOPBACK} port ${CLOSED} over TCP`,
        `INFO Port ${CLOSED}/tcp closed: ${REFUSED}`,
      ])
    })

    await test.step('every bound value reaches its downstream Log', () => {
      const expected = [
        `nc-tcp-open ok=True rows=1 port=${ECHO_TCP} state=open reason=[]`,
        `nc-tcp-closed ok=False reason=Closed state=closed error=${CLOSED_MESSAGE}`,
        `nc-range one-ok=True all-ok=False all-reason=NotAllSucceeded ports=${CLOSED},${ECHO_TCP} second=open`,
        'nc-udp echo=open silent=open or filtered silent-ok=True silent-reason=[] closed=closed closed-reason=Closed',
        `nc-talk crlf-pairs=3 crlf-ok=True file-chars=${payloadText.length} file-ok=True banner-ssh=True banner-ok=True`,
        `nc-talk-extras udp-reply=${udpTalkText} udp-ok=True cap-reply=${cappedReply} cap-ok=True range-rows=1 range-reply=${rangeTalkText} range-ok=True`,
        `nc-fail-extras none-ok=False none-reason=NoneSucceeded none-state=closed none-error=${noneError} missing-ok=False missing-reason=StartFailed missing-rows=0 missing-reply=[] missing-error=${missingError}`,
        `nc-fail-caught ${failMessage}`,
        BOOKEND,
      ]
      for (const line of expected) {
        expect(messages, `the console must carry "${line}".\n${dump(entries)}`).toContain(line)
      }
    })

    await test.step('no Netcat console line carries payload or reply bytes', () => {
      const netcatText = entries
        .filter((entry) => sourcePlugin(entry.source) === 'Netcat')
        .map((entry) => entry.message)
        .join('\n')
      expect(netcatText, 'the Netcat blocks did write to the console').not.toBe('')
      for (const fragment of [
        'alpha',
        'gamma',
        payloadText.split('\n')[0],
        SSH_BANNER_PREFIX,
        udpTalkText,
        rangeTalkText,
      ]) {
        expect(netcatText, `"${fragment}" must stay out of the Netcat lines`).not.toContain(fragment)
      }
    })
  })
})
