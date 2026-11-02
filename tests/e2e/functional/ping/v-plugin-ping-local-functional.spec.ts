/**
 * V-PLUGIN-PING-LOCAL-FUNCTIONAL: Ping on the WAVE server against real ICMP
 * Wireframe: N/A
 * Design Decisions: PING-1, PING-3, PING-4, PING-6, PING-7, PING-8, PING-9, PING-10, PING-12,
 *   PING-13, PING-15, PING-16
 * REQ: REQ-3.3.4.4, REQ-3.4.1.9
 *
 * One workflow chains every local permutation. The loopback and the gateway answer echo; the
 * TEST-NET-1 address answers nowhere, so it carries every no-reply case. The gateway block carries
 * the 127.0.0.1 sentinel and the spec rewrites it to PING_GATEWAY_HOST, which is the loopback in
 * host mode and the slirp host gateway inside a shard container.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests and validates with zero errors.
 * 2. Loopback: Success true, Summary sent 2 / received 2 / loss 0, two answered Replies rows with
 *    the source, byte count, TTL and a round-trip time, and ping's own console lines - the PING
 *    banner, one line per reply, the statistics header, the packets line and the rtt line.
 * 3. A non-loopback host answers the same way and its Replies row carries that host as the source.
 * 4. Advanced: IP version IPv4, TTL, Don't fragment and a Source address the server holds all apply
 *    and the block still passes; Packet size 0 sends an 8-byte packet and says so on the console.
 * 5. No reply under Record and continue: Success false, Reason NoReply, Error `No reply from
 *    192.0.2.1`, every Replies row timed out, Summary loss 100, one warning per unanswered request
 *    and the statistics still written.
 * 6. The four Pass when rules, each passing on the loopback and failing on the silent host with its
 *    own message and reason word: NoReply, NotAllReplied, TooFewReplies, RateTooLow.
 * 7. Timeout is the hard bound: the block ends with Reason Timeout, a request the bound never let
 *    out has no Replies row, and the statistics still reach the console.
 * 8. A host that does not resolve, a forced address family the host has no address for, and a
 *    Source address the server does not hold each fail before any request is sent, with no
 *    statistics written and no Replies rows.
 * 9. Fail the block inside a Try/Catch: the block paints failed, the ERROR line and the caught error
 *    carry `No reply from 192.0.2.1`, and no Record warning is written.
 * 10. Every bound output reaches a downstream Log, recorded blocks paint the warning state, and the
 *     run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  PING_FOREIGN_SOURCE,
  PING_GATEWAY_HOST,
  PING_GATEWAY_SENTINEL,
  PING_LOOPBACK_HOST,
  PING_SILENT_HOST,
  PING_UNRESOLVABLE_HOST,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

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
type Row = Record<string, unknown>

const FIXTURE_FILE = 'fixture.json'
const BOOKEND = 'ping-local-done'

/** Fixture blocks, by the text each one carries as its Description and as its Name (EXEC-25, EXEC-26). */
const BLOCK = {
  loopback: 'Loopback answered',
  gateway: 'Gateway answered',
  advanced: 'Advanced rows applied',
  noReply: 'No reply recorded',
  allPass: 'All replies passed',
  allFail: 'All replies recorded',
  minRepliesPass: 'Minimum replies passed',
  minRepliesFail: 'Minimum replies recorded',
  minRatePass: 'Minimum rate passed',
  minRateFail: 'Minimum rate recorded',
  timeout: 'Timeout recorded',
  unresolved: 'Unresolved recorded',
  ipVersion: 'IP version recorded',
  sourceAddress: 'Source address recorded',
  failBlock: 'No reply failed',
} as const

const LOG_BLOCKS = ['Answered proof', 'Pass rule proof', 'Failure proof', 'Fail caught', 'Done']

const PASSING_BLOCKS = [
  BLOCK.loopback,
  BLOCK.gateway,
  BLOCK.advanced,
  BLOCK.allPass,
  BLOCK.minRepliesPass,
  BLOCK.minRatePass,
  ...LOG_BLOCKS,
]
const RECORDED_BLOCKS = [
  BLOCK.noReply,
  BLOCK.allFail,
  BLOCK.minRepliesFail,
  BLOCK.minRateFail,
  BLOCK.timeout,
  BLOCK.unresolved,
  BLOCK.ipVersion,
  BLOCK.sourceAddress,
]

const SUMMARY_COLUMNS = [
  { name: 'sent', type: 'integer' },
  { name: 'received', type: 'integer' },
  { name: 'loss_percent', type: 'float' },
  { name: 'rtt_min_ms', type: 'float' },
  { name: 'rtt_avg_ms', type: 'float' },
  { name: 'rtt_max_ms', type: 'float' },
  { name: 'rtt_mdev_ms', type: 'float' },
]
const REPLY_COLUMNS = [
  { name: 'seq', type: 'integer' },
  { name: 'source', type: 'string' },
  { name: 'bytes', type: 'integer' },
  { name: 'ttl', type: 'integer' },
  { name: 'time_ms', type: 'float' },
  { name: 'status', type: 'string' },
]

/** The wire size ping reports beside the payload size: 28 bytes of IPv4 and ICMP headers. */
const IPV4_OVERHEAD = 28
/** What an answered echo of N payload bytes hands back: the 8-byte ICMP header plus the payload. */
const ICMP_HEADER = 8
const ANSWERED = 'answered'
const TIMED_OUT = 'timed out'

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

function numberOf(fixture: Fixture, description: string, name: string): number {
  const value = valuesOf(fixture, description)[name]
  expect(typeof value, `"${description}" sets ${name} to a number`).toBe('number')
  return value as number
}

/** The fixture must carry the harness targets, not copies that drifted. */
function expectFixtureTargets(fixture: Fixture): void {
  const targets: Array<[string, string]> = [
    [BLOCK.loopback, PING_LOOPBACK_HOST],
    [BLOCK.advanced, PING_LOOPBACK_HOST],
    [BLOCK.allPass, PING_LOOPBACK_HOST],
    [BLOCK.minRepliesPass, PING_LOOPBACK_HOST],
    [BLOCK.minRatePass, PING_LOOPBACK_HOST],
    [BLOCK.ipVersion, PING_LOOPBACK_HOST],
    [BLOCK.sourceAddress, PING_LOOPBACK_HOST],
    [BLOCK.gateway, PING_GATEWAY_SENTINEL],
    [BLOCK.noReply, PING_SILENT_HOST],
    [BLOCK.allFail, PING_SILENT_HOST],
    [BLOCK.minRepliesFail, PING_SILENT_HOST],
    [BLOCK.minRateFail, PING_SILENT_HOST],
    [BLOCK.timeout, PING_SILENT_HOST],
    [BLOCK.failBlock, PING_SILENT_HOST],
    [BLOCK.unresolved, PING_UNRESOLVABLE_HOST],
  ]
  for (const [description, host] of targets) {
    expect(valuesOf(fixture, description).host, `"${description}" pings the harness target`).toBe(
      host,
    )
  }
  expect(
    valuesOf(fixture, BLOCK.sourceAddress).source_address,
    'the Source address failure binds an address the WAVE server does not hold',
  ).toBe(PING_FOREIGN_SOURCE)
  expect(valuesOf(fixture, BLOCK.ipVersion).ip_version, 'the family is forced to IPv6').toBe('v6')
  expect(
    valuesOf(fixture, BLOCK.advanced).source_address,
    'the Advanced block binds an address the WAVE server does hold',
  ).toBe(PING_LOOPBACK_HOST)
  expect(valuesOf(fixture, BLOCK.advanced).dont_fragment, "Don't fragment is on").toBe(true)
  expect(valuesOf(fixture, BLOCK.advanced).ip_version, 'the family is forced to IPv4').toBe('v4')
  expect(valuesOf(fixture, BLOCK.loopback).stream_output, 'Log Output is on for the reply lines')
    .toBe(true)
  expect(
    valuesOf(fixture, BLOCK.timeout).timeout as number,
    'Timeout ends the block before Count requests can go out',
  ).toBeLessThan(
    (valuesOf(fixture, BLOCK.timeout).count as number) *
      (valuesOf(fixture, BLOCK.timeout).interval as number),
  )
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
): Row[] {
  expect(variables[name]?.type, `"${name}" holds a table`).toBe('table')
  const table = variables[name].value as WaveTable
  expect(table.columns, `"${name}" carries the declared columns`).toEqual(columns)
  return table.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column.name, row[index]])),
  )
}

/** The one Summary row of a table-bound output. */
function summaryRow(variables: SessionVariables, name: string): Row {
  const rows = boundRows(variables, name, SUMMARY_COLUMNS)
  expect(rows, `"${name}" holds exactly one Summary row`).toHaveLength(1)
  return rows[0]
}

/** A float column reaches the variables API as exact text, so every figure is read through this. */
function numeric(value: unknown, what: string): number {
  const parsed = Number(value)
  expect(
    Number.isFinite(parsed),
    `${what}: expected a number, got ${JSON.stringify(value)}`,
  ).toBe(true)
  return parsed
}

/** Assert an answered Replies row apart from its measured TTL and round-trip time. */
function expectAnswered(row: Row, expected: Row, what: string): void {
  const { ttl, time_ms: elapsed, ...rest } = row
  expect(rest, `${what}: the Replies row`).toEqual(expected)
  expect(Number.isInteger(ttl), `${what}: ttl is a whole number, got ${JSON.stringify(ttl)}`).toBe(
    true,
  )
  expect(ttl as number, `${what}: an answered reply carries the hop limit it came back with`)
    .toBeGreaterThan(0)
  expect(numeric(elapsed, `${what}: time_ms`), `${what}: time_ms is never negative`)
    .toBeGreaterThanOrEqual(0)
}

// --- reading the console back --------------------------------------------
/** Ping's own lines carry measured figures; only those are blanked before comparing. */
function normalize(message: string): string {
  return message
    .replace(
      /^(\d+) bytes from (\S+): icmp_seq=(\d+) ttl=\d+ time=[\d.]+ ms$/,
      '$1 bytes from $2: icmp_seq=$3 ttl=# time=# ms',
    )
    .replace(/^rtt min\/avg\/max\/mdev = [\d./]+ ms$/, 'rtt min/avg/max/mdev = # ms')
    .replace(/, time \d+ms$/, ', time #ms')
}

function dump(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`).join('\n')
}

/** Every line one Ping block wrote, as "LEVEL message" with the figures blanked, sorted. */
function pingLines(entries: readonly LogEntry[], name: string): string[] {
  const source = blockSource('Ping', name)
  return entries
    .filter((entry) => entry.source === source)
    .map((entry) => `${entry.level} ${normalize(entry.message)}`)
    .sort()
}

function expectPingLines(
  entries: readonly LogEntry[],
  name: string,
  expected: string[],
): void {
  expect(
    pingLines(entries, name),
    `the console lines of "${name}".\n${dump(entries)}`,
  ).toEqual([...expected].sort())
}

function expectLine(entries: readonly LogEntry[], level: string, message: string): void {
  expect(
    entries.some((entry) => entry.level === level && entry.message === message),
    `the console must carry [${level}] "${message}".\n${dump(entries)}`,
  ).toBe(true)
}

/** The banner, the statistics header and the packets line every finished run writes (PING-16). */
function banner(host: string, packetSize: number): string {
  return `INFO PING ${host} (${host}) ${packetSize}(${packetSize + IPV4_OVERHEAD}) bytes of data.`
}

function statistics(host: string, sent: number, received: number, loss: string): string[] {
  return [
    `INFO --- ${host} ping statistics ---`,
    `INFO ${sent} packets transmitted, ${received} received, ${loss}% packet loss, time #ms`,
  ]
}

const RTT_LINE = 'INFO rtt min/avg/max/mdev = # ms'

// --- suite ---------------------------------------------------------------
test.describe('V-PLUGIN-PING-LOCAL-FUNCTIONAL: Ping on the WAVE server', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('Every Pass when rule, the Advanced rows, Record and continue, Timeout and Fail the block', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const fixture = loadFixture()
    expectFixtureTargets(fixture)
    // The gateway block is the only one whose target depends on where the run happens.
    valuesOf(fixture, BLOCK.gateway).host = PING_GATEWAY_HOST
    const idOf = (description: string): string => nodeOf(fixture, description).id
    const loopbackCount = numberOf(fixture, BLOCK.loopback, 'count')
    const loopbackSize = numberOf(fixture, BLOCK.loopback, 'packet_size')
    const advancedSize = numberOf(fixture, BLOCK.advanced, 'packet_size')
    const silentCount = numberOf(fixture, BLOCK.noReply, 'count')
    const minReplies = numberOf(fixture, BLOCK.minRepliesFail, 'min_replies')
    const minRate = numberOf(fixture, BLOCK.minRateFail, 'min_rate')
    const timeoutSeconds = numberOf(fixture, BLOCK.timeout, 'timeout')
    const timeoutCount = numberOf(fixture, BLOCK.timeout, 'count')

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 150_000)

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
      await expectNodeStatus(page, idOf(BLOCK.failBlock), 'failed')
    })

    await test.step('the loopback answers every request (PING-1, PING-9, PING-16)', () => {
      expect(bound(variables, 'p_loop_ok'), 'an answered host passes Any reply').toBe(true)
      const summary = summaryRow(variables, 'p_loop_summary')
      expect(summary.sent, 'Summary counts what went out').toBe(loopbackCount)
      expect(summary.received, 'every request came back').toBe(loopbackCount)
      expect(numeric(summary.loss_percent, 'loss_percent'), 'nothing was lost').toBe(0)
      const minimum = numeric(summary.rtt_min_ms, 'rtt_min_ms')
      const average = numeric(summary.rtt_avg_ms, 'rtt_avg_ms')
      const maximum = numeric(summary.rtt_max_ms, 'rtt_max_ms')
      expect(minimum, 'the fastest round trip is measured').toBeGreaterThanOrEqual(0)
      expect(average, 'the average sits between the two ends').toBeGreaterThanOrEqual(minimum)
      expect(maximum, 'the slowest round trip is measured').toBeGreaterThanOrEqual(average)
      expect(numeric(summary.rtt_mdev_ms, 'rtt_mdev_ms'), 'the round-trip spread is measured')
        .toBeGreaterThanOrEqual(0)

      const rows = boundRows(variables, 'p_loop_replies', REPLY_COLUMNS)
      expect(rows, 'one Replies row per request').toHaveLength(loopbackCount)
      rows.forEach((row, index) => {
        expectAnswered(
          row,
          {
            seq: index + 1,
            source: PING_LOOPBACK_HOST,
            bytes: loopbackSize + ICMP_HEADER,
            status: ANSWERED,
          },
          `${BLOCK.loopback} row ${index + 1}`,
        )
      })

      expectPingLines(entries, BLOCK.loopback, [
        banner(PING_LOOPBACK_HOST, loopbackSize),
        ...rows.map(
          (row) =>
            `INFO ${row.bytes} bytes from ${PING_LOOPBACK_HOST}: icmp_seq=${row.seq} ttl=# time=# ms`,
        ),
        ...statistics(PING_LOOPBACK_HOST, loopbackCount, loopbackCount, '0.0'),
        RTT_LINE,
      ])
    })

    await test.step('a non-loopback host answers the same way (PING-2)', () => {
      expect(bound(variables, 'p_gw_ok')).toBe(true)
      const rows = boundRows(variables, 'p_gw_replies', REPLY_COLUMNS)
      expect(rows).toHaveLength(1)
      expectAnswered(
        rows[0],
        { seq: 1, source: PING_GATEWAY_HOST, bytes: loopbackSize + ICMP_HEADER, status: ANSWERED },
        BLOCK.gateway,
      )
      // Log Output is off, so only the summary lines reach the console.
      expectPingLines(entries, BLOCK.gateway, [
        banner(PING_GATEWAY_HOST, loopbackSize),
        ...statistics(PING_GATEWAY_HOST, 1, 1, '0.0'),
        RTT_LINE,
      ])
    })

    await test.step('every Advanced row applies and the block still passes (PING-7, PING-8, PING-12)', () => {
      expect(bound(variables, 'p_adv_ok'), 'IPv4, a TTL, Don\'t fragment and a held Source address')
        .toBe(true)
      const rows = boundRows(variables, 'p_adv_replies', REPLY_COLUMNS)
      expect(rows).toHaveLength(1)
      expectAnswered(
        rows[0],
        { seq: 1, source: PING_LOOPBACK_HOST, bytes: advancedSize + ICMP_HEADER, status: ANSWERED },
        BLOCK.advanced,
      )
      expectPingLines(entries, BLOCK.advanced, [
        banner(PING_LOOPBACK_HOST, advancedSize),
        `INFO ${advancedSize + ICMP_HEADER} bytes from ${PING_LOOPBACK_HOST}: icmp_seq=1 ttl=# time=# ms`,
        ...statistics(PING_LOOPBACK_HOST, 1, 1, '0.0'),
        RTT_LINE,
      ])
    })

    await test.step('a silent host records NoReply and goes on (PING-3, PING-16)', () => {
      expect(bound(variables, 'p_noreply_ok'), 'no answer fails Any reply').toBe(false)
      expect(boundText(variables, 'p_noreply_reason')).toBe('NoReply')
      expect(boundText(variables, 'p_noreply_error')).toBe(`No reply from ${PING_SILENT_HOST}`)

      const summary = summaryRow(variables, 'p_noreply_summary')
      expect(summary.sent, 'every request still went out').toBe(silentCount)
      expect(summary.received, 'nothing came back').toBe(0)
      expect(numeric(summary.loss_percent, 'loss_percent'), 'every request was lost').toBe(100)
      expect(
        [summary.rtt_min_ms, summary.rtt_avg_ms, summary.rtt_max_ms, summary.rtt_mdev_ms].map(
          (figure, index) => numeric(figure, `round-trip figure ${index}`),
        ),
        'with no answer there is no round trip to report',
      ).toEqual([0, 0, 0, 0])

      const rows = boundRows(variables, 'p_noreply_replies', REPLY_COLUMNS)
      expect(rows, 'Record still fills Replies with what was measured').toHaveLength(silentCount)
      rows.forEach((row, index) => {
        const { time_ms: elapsed, ...rest } = row
        expect(rest, `${BLOCK.noReply} row ${index + 1}`).toEqual({
          seq: index + 1,
          source: '',
          bytes: 0,
          ttl: 0,
          status: TIMED_OUT,
        })
        expect(numeric(elapsed, 'time_ms'), 'an unanswered request has no round trip').toBe(0)
      })

      expectPingLines(entries, BLOCK.noReply, [
        banner(PING_SILENT_HOST, loopbackSize),
        ...rows.map((row) => `WARN No reply to icmp_seq=${row.seq} from ${PING_SILENT_HOST}`),
        ...statistics(PING_SILENT_HOST, silentCount, 0, '100.0'),
        `WARN Ping failed (NoReply): No reply from ${PING_SILENT_HOST}`,
      ])
    })

    await test.step('the other three Pass when rules pass on an answered host (PING-3)', () => {
      expect(bound(variables, 'p_all_ok'), 'All replies passes when every request answers').toBe(
        true,
      )
      expect(bound(variables, 'p_minrep_ok'), 'At least N replies passes on N answers').toBe(true)
      expect(bound(variables, 'p_minrate_ok'), 'At least X% replies passes on 100%').toBe(true)
      for (const description of [BLOCK.allPass, BLOCK.minRepliesPass, BLOCK.minRatePass]) {
        expectPingLines(entries, description, [
          banner(PING_LOOPBACK_HOST, loopbackSize),
          ...statistics(PING_LOOPBACK_HOST, loopbackCount, loopbackCount, '0.0'),
          RTT_LINE,
        ])
      }
    })

    await test.step('each failing Pass when rule carries its own message and reason (PING-3)', () => {
      const cases: Array<[string, string, string, string]> = [
        [
          BLOCK.allFail,
          'p_allfail',
          'NotAllReplied',
          `0 of ${silentCount} requests answered`,
        ],
        [
          BLOCK.minRepliesFail,
          'p_minrepfail',
          'TooFewReplies',
          `0 of ${silentCount} requests answered, fewer than the ${minReplies} required`,
        ],
        [
          BLOCK.minRateFail,
          'p_minratefail',
          'RateTooLow',
          `0.0% of requests answered, below the ${minRate}% required`,
        ],
      ]
      for (const [description, prefix, reason, message] of cases) {
        expect(bound(variables, `${prefix}_ok`), `${description}: the rule was not met`).toBe(false)
        expect(boundText(variables, `${prefix}_reason`), description).toBe(reason)
        expect(boundText(variables, `${prefix}_error`), description).toBe(message)
        expectPingLines(entries, description, [
          banner(PING_SILENT_HOST, loopbackSize),
          ...statistics(PING_SILENT_HOST, silentCount, 0, '100.0'),
          `WARN Ping failed (${reason}): ${message}`,
        ])
      }
    })

    await test.step('Timeout is the hard bound and the statistics are still written (PING-6)', () => {
      expect(bound(variables, 'p_timeout_ok')).toBe(false)
      expect(boundText(variables, 'p_timeout_reason')).toBe('Timeout')
      expect(boundText(variables, 'p_timeout_error')).toBe(
        `Ping did not finish within ${timeoutSeconds} seconds`,
      )
      const rows = boundRows(variables, 'p_timeout_replies', REPLY_COLUMNS)
      expect(rows.length, 'a request the bound never let out has no Replies row').toBeLessThan(
        timeoutCount,
      )
      expect(rows.length, 'the requests that did go out are reported').toBeGreaterThanOrEqual(1)
      const summary = summaryRow(variables, 'p_timeout_summary')
      expect(summary.sent, 'Summary counts only what went out').toBe(rows.length)
      expect(summary.received).toBe(0)
      expectPingLines(entries, BLOCK.timeout, [
        banner(PING_SILENT_HOST, loopbackSize),
        ...statistics(PING_SILENT_HOST, rows.length, 0, '100.0'),
        `WARN Ping failed (Timeout): Ping did not finish within ${timeoutSeconds} seconds`,
      ])
    })

    await test.step('a block that never sends a request writes no statistics (PING-5, PING-8)', () => {
      const cases: Array<[string, string, string, string]> = [
        [
          BLOCK.unresolved,
          'p_unres',
          'Unresolved',
          `Cannot resolve host '${PING_UNRESOLVABLE_HOST}'`,
        ],
        [
          BLOCK.ipVersion,
          'p_v6',
          'Unresolved',
          `Host '${PING_LOOPBACK_HOST}' has no IPv6 address`,
        ],
        [
          BLOCK.sourceAddress,
          'p_src',
          'Source',
          `Cannot send from source address '${PING_FOREIGN_SOURCE}': Cannot assign requested address`,
        ],
      ]
      for (const [description, prefix, reason, message] of cases) {
        expect(bound(variables, `${prefix}_ok`), description).toBe(false)
        expect(boundText(variables, `${prefix}_reason`), description).toBe(reason)
        expect(boundText(variables, `${prefix}_error`), description).toBe(message)
        expectPingLines(entries, description, [`WARN Ping failed (${reason}): ${message}`])
      }
      expect(
        boundRows(variables, 'p_unres_replies', REPLY_COLUMNS),
        'nothing was sent, so nothing is reported',
      ).toEqual([])
      expect(boundRows(variables, 'p_src_replies', REPLY_COLUMNS)).toEqual([])
      const empty = summaryRow(variables, 'p_unres_summary')
      expect(
        SUMMARY_COLUMNS.map((column) => numeric(empty[column.name], column.name)),
        'the Summary of a block that sent nothing',
      ).toEqual([0, 0, 0, 0, 0, 0, 0])
    })

    const failError = bound(variables, 'p_fail_error') as Record<string, unknown>
    const failMessage = String(failError?.message)

    await test.step('Fail the block inside a Try/Catch carries the exact message (PING-3)', () => {
      expect(bound(variables, 'p_fail_caught'), 'the Try/Catch caught the failure').toBe(true)
      expect(failMessage, 'the block error is the Any reply message').toBe(
        `No reply from ${PING_SILENT_HOST}`,
      )
      expect(failError.node, 'the error names the Ping block').toBe(BLOCK.failBlock)
      expect(failError.node_id, 'the error points at the Ping block').toBe(idOf(BLOCK.failBlock))
      expectLine(entries, 'ERROR', `Block '${BLOCK.failBlock}' failed: ${failMessage}`)
      expectLine(entries, 'WARN', `Try-path error caught: ${failMessage}`)
      // Fail the block writes no Record warning; the statistics still reach the console.
      expectPingLines(entries, BLOCK.failBlock, [
        banner(PING_SILENT_HOST, loopbackSize),
        ...statistics(PING_SILENT_HOST, 1, 0, '100.0'),
      ])
    })

    await test.step('every bound output reaches its downstream Log', () => {
      const loopRows = boundRows(variables, 'p_loop_replies', REPLY_COLUMNS)
      const timeoutRows = boundRows(variables, 'p_timeout_replies', REPLY_COLUMNS)
      const expected = [
        `ping-answered loop-ok=True loop-sent=${loopbackCount} loop-received=${loopbackCount} ` +
          `loop-loss=0.0 loop-rows=${loopRows.length} loop-status=${ANSWERED} gw-ok=True ` +
          `gw-source=${PING_GATEWAY_HOST} adv-ok=True adv-bytes=${advancedSize + ICMP_HEADER}`,
        'ping-rules any-ok=False any-reason=NoReply all-ok=True allfail-ok=False ' +
          'allfail-reason=NotAllReplied minrep-ok=True minrepfail-reason=TooFewReplies ' +
          'minrate-ok=True minratefail-reason=RateTooLow',
        `ping-failures timeout-reason=Timeout timeout-rows=${timeoutRows.length} ` +
          'unres-reason=Unresolved unres-rows=0 v6-reason=Unresolved src-reason=Source src-rows=0',
        `ping-fail-caught ${failMessage}`,
        BOOKEND,
      ]
      for (const line of expected) {
        expect(messages, `the console must carry "${line}".\n${dump(entries)}`).toContain(line)
      }
    })
  })
})
