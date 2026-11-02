/**
 * V-PLUGIN-PING-REMOTE-FUNCTIONAL: Ping inside a Remote Execution body
 * Wireframe: N/A
 * Design Decisions: PING-1, PING-3, PING-9, PING-14, PING-16
 * REQ: REQ-3.3.4.4, REQ-3.4.1.9
 *
 * The Remote Execution body pushes the worker to the real sshd host, and the Ping blocks inside it
 * send their echo requests from there: they reach `netcat-target`, a compose service only the
 * remote host resolves, and the same Host pinged from WAVE does not resolve at all. That pair is
 * the proof the ICMP left the remote host and not the WAVE server.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests and validates with zero errors.
 * 2. Every Ping block inside the body carries one R locus badge; nothing outside it carries one.
 * 3. The remote-only target answers: Success true, Summary sent 2 / received 2 / loss 0, two
 *    answered Replies rows whose source is the remote target's own address, and ping's own console
 *    lines written from the remote host.
 * 4. The remote loopback answers, so the block is running with its own network, not WAVE's.
 * 5. A silent host under Record and continue records Reason NoReply on the remote host too.
 * 6. The same Host pinged from WAVE fails to resolve, which is what makes 3 a remote proof.
 * 7. Every bound output reaches a downstream Log and the run passes.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  NETCAT_TARGET_SERVICE,
  PING_LOOPBACK_HOST,
  PING_SILENT_HOST,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
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

const FIXTURE_FILE = 'fixture-remote.json'
const BOOKEND = 'ping-remote-done'
const LOCUS_BADGE = '[data-testid="node-remote-locus-badge"]'
/** The dialing side's own loopback, which the SSH host rewrite never touches. */
const OWN_LOOPBACK = 'localhost'

/** Fixture blocks by Description; each Ping block carries the same text as its Name (EXEC-25). */
const BLOCK = {
  sshOpen: 'Open the remote host',
  remote: 'Run on the remote host',
  target: 'Remote target answered',
  loopback: 'Remote loopback answered',
  silent: 'Remote no reply recorded',
  waveSide: 'WAVE side unresolved recorded',
  proof: 'Remote proof',
  done: 'Done',
} as const

const BODY_BLOCKS = [BLOCK.target, BLOCK.loopback, BLOCK.silent]
const OUTSIDE_BLOCKS = [BLOCK.sshOpen, BLOCK.remote, BLOCK.waveSide, BLOCK.proof, BLOCK.done]

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

const IPV4_OVERHEAD = 28
const ICMP_HEADER = 8
const ANSWERED = 'answered'

const createdTests: string[] = []

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

/** The fixture must carry the harness endpoints, not copies that drifted. */
function expectFixtureTargets(fixture: Fixture): void {
  const ssh = valuesOf(fixture, BLOCK.sshOpen)
  expect(ssh.host, 'the SSH session carries the sentinel the import rewrites').toBe(
    SSH_FIXTURE_HOST_SENTINEL,
  )
  expect(String(ssh.port), 'the SSH session dials the harness port').toBe(SSH_MAIN_PORT)
  for (const description of [BLOCK.target, BLOCK.waveSide]) {
    expect(
      valuesOf(fixture, description).host,
      `"${description}" pings the internal-only compose service`,
    ).toBe(NETCAT_TARGET_SERVICE)
  }
  expect(
    valuesOf(fixture, BLOCK.loopback).host,
    'the remote loopback block carries the name the SSH host rewrite never touches',
  ).toBe(OWN_LOOPBACK)
  expect(valuesOf(fixture, BLOCK.loopback).ip_version, 'IPv4, so the source is 127.0.0.1').toBe('v4')
  expect(valuesOf(fixture, BLOCK.silent).host).toBe(PING_SILENT_HOST)
  expect(valuesOf(fixture, BLOCK.target).stream_output, 'Log Output is on for the reply lines')
    .toBe(true)
}

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

/** A float column reaches the variables API as exact text, so every figure is read through this. */
function numeric(value: unknown, what: string): number {
  const parsed = Number(value)
  expect(
    Number.isFinite(parsed),
    `${what}: expected a number, got ${JSON.stringify(value)}`,
  ).toBe(true)
  return parsed
}

function normalize(message: string): string {
  return message
    .replace(
      /^(\d+) bytes from (\S+): icmp_seq=(\d+) ttl=\d+ time=[\d.]+ ms$/,
      '$1 bytes from $2: icmp_seq=$3 ttl=# time=# ms',
    )
    .replace(/^rtt min\/avg\/max\/mdev = [\d./]+ ms$/, 'rtt min/avg/max/mdev = # ms')
    .replace(/, time \d+ms$/, ', time #ms')
    .replace(/^PING (\S+) \(\S+\) (\d+)\((\d+)\) bytes of data\.$/, 'PING $1 (#) $2($3) bytes of data.')
}

function dump(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`).join('\n')
}

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

/** Every body member shows one R badge; nothing outside the body shows one. */
async function expectLocusBadges(page: Page, bodyIds: string[], outsideIds: string[]): Promise<void> {
  for (const id of bodyIds) {
    const badge = page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`)
    await expect(badge, `${id} is a remotable block inside the body`).toHaveCount(1)
    await expect(badge, `${id} runs on the remote host`).toHaveAttribute('data-locus', 'R')
    await expect(badge).toHaveText('R')
  }
  for (const id of outsideIds) {
    await expect(
      page.locator(`[data-testid="workflow-node-${id}"] ${LOCUS_BADGE}`),
      `${id} sits outside the body, so it carries no locus badge`,
    ).toHaveCount(0)
  }
  await expect(page.locator(`${LOCUS_BADGE}[data-locus="L"]`), 'no block is pinned local')
    .toHaveCount(0)
  await expect(page.locator(LOCUS_BADGE), 'one badge per body member').toHaveCount(bodyIds.length)
}

test.describe('V-PLUGIN-PING-REMOTE-FUNCTIONAL: Ping inside a Remote Execution body', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })

  test('The body pings a host only the remote side resolves, and WAVE cannot', async ({ page }) => {
    test.setTimeout(180_000)

    const fixture = loadFixture()
    expectFixtureTargets(fixture)
    const idOf = (description: string): string => nodeOf(fixture, description).id
    const targetCount = numberOf(fixture, BLOCK.target, 'count')
    const targetSize = numberOf(fixture, BLOCK.target, 'packet_size')

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const testId = await importValidateAndNavigate(page, fixture, {
      injectSsh: true,
      rejectRepairs: true,
    })
    createdTests.push(testId)

    const validation = await validateTest(page.request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(
      validation.errors,
      `the fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toHaveLength(0)

    await test.step('the body members are marked remote and nothing else is (PING-1)', async () => {
      await expectLocusBadges(page, BODY_BLOCKS.map(idOf), OUTSIDE_BLOCKS.map(idOf))
    })

    const status = await startRun(page)
    await finishRun(page, status, BOOKEND, 150_000)

    const variables = (await getSessionVariables(
      page,
      await getActiveSessionId(page),
    )) as SessionVariables
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const messages = entries.map((entry) => entry.message)

    await test.step('every block ends in the state its permutation calls for', async () => {
      for (const description of [BLOCK.target, BLOCK.loopback, BLOCK.proof, BLOCK.done]) {
        await expectNodeStatus(page, idOf(description), 'success')
      }
      for (const description of [BLOCK.silent, BLOCK.waveSide]) {
        await expectNodeStatus(page, idOf(description), 'warning')
      }
    })

    const targetRows = boundRows(variables, 'r_replies', REPLY_COLUMNS)
    const targetAddress = String(targetRows[0]?.source ?? '')

    await test.step('the remote-only target answers from the remote host (PING-9, PING-14)', () => {
      expect(bound(variables, 'r_ok'), 'the remote target answered').toBe(true)
      const summary = boundRows(variables, 'r_summary', SUMMARY_COLUMNS)
      expect(summary).toHaveLength(1)
      expect(summary[0].sent).toBe(targetCount)
      expect(summary[0].received, 'every request came back').toBe(targetCount)
      expect(numeric(summary[0].loss_percent, 'loss_percent'), 'nothing was lost').toBe(0)

      expect(targetRows, 'one Replies row per request').toHaveLength(targetCount)
      expect(targetAddress, 'the replies name the address the remote host resolved').not.toBe('')
      expect(
        targetAddress,
        'the remote target is not the remote loopback, so the run really left the host',
      ).not.toBe(PING_LOOPBACK_HOST)
      targetRows.forEach((row, index) => {
        const { ttl, time_ms: elapsed, ...rest } = row
        expect(rest, `remote target row ${index + 1}`).toEqual({
          seq: index + 1,
          source: targetAddress,
          bytes: targetSize + ICMP_HEADER,
          status: ANSWERED,
        })
        expect(ttl as number, 'an answered reply carries its hop limit').toBeGreaterThan(0)
        expect(numeric(elapsed, 'time_ms'), 'time_ms is never negative').toBeGreaterThanOrEqual(0)
      })

      expectPingLines(entries, BLOCK.target, [
        `INFO PING ${NETCAT_TARGET_SERVICE} (#) ${targetSize}(${targetSize + IPV4_OVERHEAD}) bytes of data.`,
        ...targetRows.map(
          (row) =>
            `INFO ${row.bytes} bytes from ${targetAddress}: icmp_seq=${row.seq} ttl=# time=# ms`,
        ),
        `INFO --- ${NETCAT_TARGET_SERVICE} ping statistics ---`,
        `INFO ${targetCount} packets transmitted, ${targetCount} received, 0.0% packet loss, time #ms`,
        'INFO rtt min/avg/max/mdev = # ms',
      ])
    })

    await test.step('the remote host pings its own loopback', () => {
      expect(bound(variables, 'r_loop_ok')).toBe(true)
      const rows = boundRows(variables, 'r_loop_replies', REPLY_COLUMNS)
      expect(rows).toHaveLength(1)
      expect(rows[0].source, 'the remote loopback answers as itself').toBe(PING_LOOPBACK_HOST)
      expect(rows[0].status).toBe(ANSWERED)
    })

    await test.step('Record and continue works on the remote host too (PING-3)', () => {
      expect(bound(variables, 'r_silent_ok')).toBe(false)
      expect(boundText(variables, 'r_silent_reason')).toBe('NoReply')
      expect(boundText(variables, 'r_silent_error')).toBe(`No reply from ${PING_SILENT_HOST}`)
    })

    await test.step('the same Host pinged from WAVE does not resolve', () => {
      expect(bound(variables, 'w_ok')).toBe(false)
      expect(boundText(variables, 'w_reason')).toBe('Unresolved')
      expect(boundText(variables, 'w_error')).toBe(`Cannot resolve host '${NETCAT_TARGET_SERVICE}'`)
    })

    await test.step('every bound output reaches its downstream Log', () => {
      const line =
        `ping-remote target-ok=True target-sent=${targetCount} target-received=${targetCount} ` +
        `target-rows=${targetRows.length} target-source=${targetAddress} target-status=${ANSWERED} ` +
        `loop-ok=True loop-source=${PING_LOOPBACK_HOST} silent-ok=False silent-reason=NoReply ` +
        'wave-ok=False wave-reason=Unresolved'
      expect(messages, `the console must carry "${line}".\n${dump(entries)}`).toContain(line)
      expect(messages).toContain(BOOKEND)
    })
  })
})
