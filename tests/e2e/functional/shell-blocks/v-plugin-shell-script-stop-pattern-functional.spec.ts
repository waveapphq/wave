/**
 * SH-10: Stop on pattern reads the exports and ends the whole process tree
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-7, SHRUN-9, SHRUN-13, SHRUN-15, SHRUN-18
 * REQ: REQ-3.4.1.1, REQ-3.4.1.18, REQ-3.2.2.4
 *
 * Pass Criteria (fixture-pattern.json, one run):
 * 1. The run passes within 30 s of its start, although every stopped script sleeps 300 s.
 * 2. Pass match (`sh-pass`, pass pattern `^READY-`): Success true, Exit Code 137, the
 *    export X reads `late` (a pattern stop reads the exports), and the block paints
 *    `success`, not the amber state of an export that was never read.
 * 3. The console carries exactly one INFO line `Output matched the pass pattern: READY-<token>`,
 *    and in the live log stream it comes before the pass block's DEBUG Outputs echo,
 *    which shows X as `late`.
 * 4. Fail match under Record and continue (`sh-fail`, fail pattern `ERROR|FATAL`): Reason
 *    `FailPattern`, Error exactly `Output matched the fail pattern: ERROR disk full <token>`,
 *    Success false, Exit Code 137, the converted export Y reads `early`, one WARN line
 *    reads exactly `Script failed (FailPattern): Output matched the fail pattern: ERROR disk full <token>`,
 *    and the block paints the recorded amber state.
 * 5. The probe after both reads exactly `gone gone`: each pattern stop ended the script's
 *    background job too, not just its shell.
 * 6. A Shell Exec pass match (`sh-exec-pass`) passes with Exit Code 137 and logs its own
 *    INFO line `Output matched the pass pattern: GO-<token>` before its Outputs echo.
 * 7. A pass match on a stdout marked secret (`sh-pass-secret`) passes with Exit Code 137 and
 *    logs exactly one INFO line `Output matched the pass pattern` with no matched line; the
 *    line is on no console entry and no WS event.
 * 8. A pass match whose foreground child ignores the stop (`sh-pass-stuck`) passes amber with
 *    Exit Code 137, the export Z keeps "orig", one WARN line reads exactly
 *    `Variable exports were not read: the script did not end after the pattern match`, and
 *    its probe reads `gone`: the group kill after the grace ended the child.
 * 9. A fail match under Fail inside Try/Catch (`sh-fail-hard`) raises: the caught message is
 *    exactly `Output matched the fail pattern: FATAL hard stop <token>`, the export Z and
 *    Exit Code bind nothing, and no recorded-failure WARN line is written for it.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogEntries } from '../../helpers/log-reader'
import { openSessionEventCollector, type WsEvent } from '../../helpers/ws-events'
import { expectNoSecret } from '../../helpers/secret-canary'
import { deleteTest } from '../file-picker/picker'
import {
  newToken,
  pairTreeProbeCommand,
  stripOneNewline,
  treeProbeCommand,
  withToken,
} from './shell-helpers'
import fs from 'fs'
import path from 'path'

type Fixture = {
  workflow: { nodes: Array<{ id: string; data: { config: { values: Record<string, unknown> } } }> }
}
type SessionVariables = Record<string, { value: unknown; type: string }>

const PASS_MATCH = 'Output matched the pass pattern'
const HOOK_NOT_REACHED =
  'Variable exports were not read: the script did not end after the pattern match'

let createdTest: string | undefined

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-pattern.json'), 'utf-8'),
  ) as Fixture
  const probes: Record<string, string> = {
    'sh-pattern-probe': pairTreeProbeCommand(10, 'pass.pid', 'fail.pid'),
    'sh-stuck-probe': treeProbeCommand(10, 'stuck.pid'),
  }
  for (const [nodeId, command] of Object.entries(probes)) {
    const probe = raw.workflow.nodes.find((node) => node.id === nodeId)
    expect(probe, `fixture-pattern.json has no probe node ${nodeId}`).toBeTruthy()
    probe!.data.config.values.command = command
  }
  return withToken(raw, token) as unknown as Record<string, unknown>
}

function cell(vars: SessionVariables, name: string): unknown {
  expect(vars[name], `variable "${name}" is missing from the session`).toBeTruthy()
  return vars[name].value
}

/** Harvested log events with a string message, in log sequence order. */
function logEvents(events: WsEvent[]): Array<{ level: unknown; message: string }> {
  return events
    .map((event, index) => ({ event, index }))
    .filter((item): item is { event: WsEvent & { message: string }; index: number } =>
      typeof item.event.message === 'string',
    )
    .sort((a, b) => {
      const sa = a.event.sequence
      const sb = b.event.sequence
      return typeof sa === 'number' && typeof sb === 'number' ? sa - sb : a.index - b.index
    })
    .map(({ event }) => ({ level: event.level, message: event.message }))
}

/** Assert the match line streams before the Outputs echo that carries `outputText`; return that echo. */
function expectMatchBeforeEcho(
  stream: Array<{ level: unknown; message: string }>,
  matchLine: string,
  outputText: string,
): string {
  const matchAt = stream.findIndex((item) => item.message === matchLine)
  const echoAt = stream.findIndex(
    (item) => item.message.startsWith('Outputs:') && item.message.includes(outputText),
  )
  const dump = stream.map((item) => `[${String(item.level)}] ${item.message}`).join('\n')
  expect(matchAt, `"${matchLine}" must stream live.\n${dump}`).toBeGreaterThanOrEqual(0)
  expect(echoAt, `the Outputs echo carrying ${outputText} must stream after it.\n${dump}`).toBeGreaterThan(
    matchAt,
  )
  return stream[echoAt].message
}

async function readVariables(page: Page): Promise<SessionVariables> {
  return getSessionVariables(page, await getActiveSessionId(page))
}

test.describe('SH-10: Stop on pattern', () => {
  test.afterAll(async ({ request }) => {
    if (createdTest) await deleteTest(request, createdTest)
  })

  test('a pass match and a fail match each stop the script, read its exports and end the tree', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const token = newToken()
    const passLine = `${PASS_MATCH}: READY-${token}`
    const failMessage = `Output matched the fail pattern: ERROR disk full ${token}`
    const execPassLine = `${PASS_MATCH}: GO-${token}`
    const secretLine = `shsec-go-${token}`
    const stuckPassLine = `${PASS_MATCH}: STUCK-${token}`
    const hardFailMessage = `Output matched the fail pattern: FATAL hard stop ${token}`
    createdTest = await importValidateAndNavigate(page, loadFixture(token))

    // The leading ws-hold Delay keeps output back until the collector has subscribed.
    const status = await startRun(page)
    const sid = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sid, [`log:${sid}`, `variable:${sid}`])
    const logs = await finishRun(page, status, `SH-10-done-${token}`, 30_000)
    const vars = await readVariables(page)
    const entries = await getLogEntries(page)
    const events = await collector.harvest()
    const stream = logEvents(events)
    await collector.close()

    await test.step('the pass match passes with its export read and exit code 137', async () => {
      expect(cell(vars, 'p_ok')).toBe(true)
      expect(cell(vars, 'p_code'), 'a WAVE stop reads exit code 137').toBe(137)
      expect(cell(vars, 'p_x'), 'a pass-pattern stop reads the exports').toBe('late')
      await expectNodeStatus(page, 'sh-pass', 'success')
    })

    await test.step('one INFO line names the matched line, before the Outputs echo', () => {
      const infos = entries.filter((entry) => entry.message === passLine)
      expect(infos, `exactly one console line "${passLine}"`).toHaveLength(1)
      expect(infos[0].level).toBe('INFO')
      const echo = expectMatchBeforeEcho(stream, passLine, `READY-${token}`)
      expect(echo, 'the Outputs echo shows the export').toContain(`"X":"late"`)
    })

    await test.step('the fail match records FailPattern with its export read and exit code 137', async () => {
      expect(cell(vars, 'f_reason')).toBe('FailPattern')
      expect(cell(vars, 'f_err')).toBe(failMessage)
      expect(cell(vars, 'f_ok')).toBe(false)
      expect(cell(vars, 'f_code'), 'a WAVE stop reads exit code 137').toBe(137)
      expect(cell(vars, 'f_y'), 'a fail-pattern stop under Record binds the exports').toBe('early')
      const warns = entries.filter(
        (entry) =>
          entry.level === 'WARN' && entry.message === `Script failed (FailPattern): ${failMessage}`,
      )
      expect(warns, 'exactly one recorded fail-pattern WARN line').toHaveLength(1)
      await expectNodeStatus(page, 'sh-fail', 'warning')
    })

    await test.step('both background jobs are gone', () => {
      expect(stripOneNewline(String(cell(vars, 'pattern_probe')))).toBe('gone gone')
    })

    await test.step('a Shell Exec pass match logs its own line before its Outputs echo', async () => {
      expect(cell(vars, 'e_ok')).toBe(true)
      expect(cell(vars, 'e_code'), 'a WAVE stop reads exit code 137').toBe(137)
      await expectNodeStatus(page, 'sh-exec-pass', 'success')
      const infos = entries.filter((entry) => entry.message === execPassLine)
      expect(infos, `exactly one console line "${execPassLine}"`).toHaveLength(1)
      expect(infos[0].level).toBe('INFO')
      expectMatchBeforeEcho(stream, execPassLine, `GO-${token}`)
    })

    await test.step('a pass match on a secret stream logs the line without the matched text', async () => {
      expect(cell(vars, 's_ok')).toBe(true)
      expect(cell(vars, 's_code'), 'a WAVE stop reads exit code 137').toBe(137)
      await expectNodeStatus(page, 'sh-pass-secret', 'success')
      const infos = entries.filter((entry) => entry.message === PASS_MATCH)
      expect(infos, `exactly one console line "${PASS_MATCH}"`).toHaveLength(1)
      expect(infos[0].level).toBe('INFO')
      expectNoSecret(JSON.stringify(entries), 'console', [secretLine])
      expectNoSecret(JSON.stringify(events), 'WS events', [secretLine])
    })

    await test.step('a child that ignores the stop leaves the exports unread, amber, and is killed', async () => {
      expect(cell(vars, 'k_ok')).toBe(true)
      expect(cell(vars, 'k_code'), 'a WAVE stop reads exit code 137').toBe(137)
      expect(cell(vars, 'k_z'), 'the bound variable keeps its value').toBe('orig')
      expect(entries.filter((entry) => entry.message === stuckPassLine)).toHaveLength(1)
      const warns = entries.filter(
        (entry) => entry.level === 'WARN' && entry.message === HOOK_NOT_REACHED,
      )
      expect(warns, `WARN lines:\n${JSON.stringify(entries, null, 2)}`).toHaveLength(1)
      await expectNodeStatus(page, 'sh-pass-stuck', 'warning')
      expect(stripOneNewline(String(cell(vars, 'stuck_probe')))).toBe('gone')
    })

    await test.step('a fail match under Fail raises and binds nothing', () => {
      const allLogs = logs.join('\n')
      expect(logs, `the catch branch never ran.\n${allLogs}`).toContain(`SH-10-catch-ran-${token}`)
      const caughtPrefix = `SH-10-caught-${token} msg=`
      const caught = logs.find((text) => text.startsWith(caughtPrefix))
      expect(caught, `no caught-message line.\n${allLogs}`).toBe(`${caughtPrefix}${hardFailMessage}`)
      expect((cell(vars, 'h_error') as Record<string, unknown>).message).toBe(hardFailMessage)
      expect(cell(vars, 'h_z'), 'a failed block under Fail binds no export').toBe('orig')
      expect(cell(vars, 'h_code'), 'a failed block under Fail binds no exit code').toBe(-99)
      expect(
        entries.filter((entry) => entry.message === `Script failed (FailPattern): ${hardFailMessage}`),
      ).toEqual([])
    })
  })
})
