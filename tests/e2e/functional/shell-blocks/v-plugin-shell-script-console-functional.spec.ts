/**
 * SH-11: Shell Script Log Output
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-8, SHRUN-12
 * REQ: REQ-3.4.1.1, REQ-3.1.3.5
 *
 * Pass Criteria:
 * 1. With Log Output ticked, the first stdout line reaches the console while the script is
 *    still sleeping: the block still paints running and its stdout variable still reads
 *    "seed", because no output is published while the script runs.
 * 2. After the run both stdout lines are one INFO entry each with source Shell Script, and
 *    the stderr line is one WARN entry with source Shell Script.
 * 3. After the run the stdout variable reads the two stdout lines.
 * 4. With Log Output unticked the block runs (its stdout binds) and no INFO or WARN entry
 *    carries its output.
 * 5. A stdout stream marked secret is never written live: its value is on no console entry
 *    and no WS event, no masked live line stands in for it, and its variable reads the mask.
 * 6. A secret input value is masked in a live line: the console reads "got " followed by
 *    the mask, and the value is on no console entry, WS event or session variable.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, getLogEntries, waitForLogText } from '../../helpers/log-reader'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { deleteTest } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, stripOneNewline, withToken } from './shell-helpers'

const SOURCE = 'Shell Script'

const createdTests: string[] = []

function loadFixture(file: string, token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
  return withToken(raw as Record<string, unknown>, token)
}

test.describe('SH-11: Shell Script Log Output', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('SH-11: live lines land as they arrive at INFO and WARN, an unticked block stays quiet, secrets never reach the console', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const lineOne = `line-one-${token}`
    const lineTwo = `line-two-${token}`
    const lineErr = `line-err-${token}`
    const quiet = `quiet-${token}`
    const secretStream = `shsec-live-${token}`
    const secretInput = `shsec-in-${token}`
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-console.json', token))
    createdTests.push(testId)

    const status = await startRun(page)
    const sid = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sid, [`log:${sid}`, `variable:${sid}`])

    await test.step('the first line is live while the script still runs', async () => {
      await waitForLogText(page, lineOne, 30_000)
      await expect(page.locator('[data-testid="workflow-node-sh-live"]')).toHaveAttribute(
        'data-execution-status',
        'running',
      )
      const during = await getSessionVariables(page, sid)
      expect(during.live_out.value, 'nothing is published while the script runs').toBe('seed')
    })

    await finishRun(page, status, `SH-11-done-${token}`, 60_000)
    const events = await collector.harvest()
    await collector.close()
    const entries = await getLogEntries(page)
    const copyTexts = await getLogCopyTexts(page)
    // The source column cuts a long source to its width; the copy text keeps it whole.
    const sourced = consoleEntriesFromCopy(copyTexts)
    const variables = await getSessionVariables(page, sid)
    const dump = JSON.stringify(sourced, null, 2)

    await test.step('stdout lines at INFO, the stderr line at WARN, each from Shell Script', async () => {
      expect(sourced.filter((entry) => entry.message === lineOne), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: lineOne },
      ])
      expect(sourced.filter((entry) => entry.message === lineTwo), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: lineTwo },
      ])
      expect(sourced.filter((entry) => entry.message === lineErr), dump).toEqual([
        { level: 'WARN', source: SOURCE, message: lineErr },
      ])
      expect(stripOneNewline(String(variables.live_out.value))).toBe(`${lineOne}\n${lineTwo}`)
    })

    await test.step('an unticked block writes no live line', async () => {
      expect(stripOneNewline(String(variables.quiet_out.value)), 'the quiet block ran').toBe(quiet)
      expect(
        entries.filter(
          (entry) =>
            (entry.level === 'INFO' || entry.level === 'WARN') && entry.message.includes(quiet),
        ),
      ).toEqual([])
    })

    await test.step('a secret stdout stream is never written live', async () => {
      expectNoSecret(JSON.stringify([entries, copyTexts]), 'console', [secretStream])
      expectNoSecret(JSON.stringify(events), 'WS events', [secretStream])
      expect(entries.filter((entry) => entry.message === SECRET_MASK), dump).toEqual([])
      expect(variables.sec_out.value).toBe(SECRET_MASK)
    })

    await test.step('a secret input value is masked in a live line', async () => {
      expect(sourced.filter((entry) => entry.message === `got ${SECRET_MASK}`), dump).toEqual([
        { level: 'INFO', source: SOURCE, message: `got ${SECRET_MASK}` },
      ])
      expectNoSecret(JSON.stringify([entries, copyTexts]), 'console', [secretInput])
      expectNoSecret(JSON.stringify(events), 'WS events', [secretInput])
      expectNoSecret(JSON.stringify(variables), 'session variables', [secretInput])
    })
  })
})
