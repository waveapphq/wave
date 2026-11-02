/**
 * PYLOG: Python logging and the run console
 * Wireframe: none
 * Design Decisions: PYRUN-8, PYRUN-10, SHRUN-12
 * REQ: REQ-3.4.1.2, REQ-3.1.3.5
 *
 * Pass Criteria:
 * 1. With Log Output off, the script's standard `logging` records reach the run console at
 *    the mapped levels: DEBUG as DEBUG, INFO as INFO, WARNING as WARN, ERROR as ERROR and
 *    CRITICAL as ERROR.
 * 2. With Log Output off a `print` line and a raw stderr line reach the block's Stdout and
 *    Stderr but no console entry; with Log Output on the same two lines are one INFO and
 *    one WARN console entry.
 * 3. Every one of those console entries is attributed to the source Python, and no console
 *    message carries a "[Python] " prefix inside its text.
 * 4. A caught exception logged with `logging.exception` shows its traceback in the console
 *    entry at ERROR, with the raising line and the exception text.
 * 5. A log message with a line break arrives as one console entry holding both lines.
 * 6. A secret Input Variable value is masked in the console line and sits on no console
 *    entry, no WS event and no session variable.
 * 7. The logging does not disturb the exports: the two Variable Exports bind their values.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, getLogEntries } from '../../helpers/log-reader'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { deleteTest } from '../file-picker/picker'
import { consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

const SOURCE = 'Python'
const TRACEBACK_HEAD = 'Traceback (most recent call last):'
// The struck text prefixes; the source column is what names the block now.
const OLD_PREFIX = /\[Python( stderr)?\] /

const createdTests: string[] = []

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-logging.json'), 'utf-8'),
  ) as Record<string, unknown>
  return withToken(raw, token)
}

/** Open the console and set its minimum level to DEBUG before the run subscribes. */
async function showDebugLines(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .click()
  }
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: 'DEBUG', exact: true }).click()
}

test.describe('PYLOG: Python logging reaches the run console', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('PYLOG: the five level mappings, the Log Output gate, the traceback, the mask and the exports', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    const marker = (part: string) => `py-${part}-${token}`
    const secret = `pysec-in-${token}`
    const testId = await importValidateAndNavigate(page, loadFixture(token))
    createdTests.push(testId)

    await showDebugLines(page)
    const status = await startRun(page)
    const sid = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sid, [`log:${sid}`, `variable:${sid}`])

    await finishRun(page, status, `PYLOG-done-${token}`, 90_000)
    const events = await collector.harvest()
    await collector.close()
    const entries = await getLogEntries(page)
    const copyTexts = await getLogCopyTexts(page)
    // The source column cuts a long source to its width; the copy text keeps it whole.
    const sourced = consoleEntriesFromCopy(copyTexts)
    const variables = await getSessionVariables(page, sid)
    const dump = JSON.stringify(sourced, null, 2)

    await expectNodesSuccess(page, ['py-levels', 'py-loud', 'py-secret'])

    await test.step('every logging level maps to its run-console level, from the source Python', async () => {
      for (const [part, level] of [
        ['dbg', 'DEBUG'],
        ['inf', 'INFO'],
        ['wrn', 'WARN'],
        ['err', 'ERROR'],
        ['crt', 'ERROR'],
      ] as const) {
        const message = marker(part)
        expect(
          sourced.filter((entry) => entry.message === message),
          dump,
        ).toEqual([{ level, source: SOURCE, message }])
      }
    })

    await test.step('Log Output off keeps print and stderr off the console but not out of the streams', async () => {
      expect(String(variables.levels_stdout.value), 'the print line ran').toContain(
        marker('print-off'),
      )
      expect(String(variables.levels_stderr.value), 'the stderr line ran').toContain(
        marker('stderr-off'),
      )
      // The DEBUG Outputs echo carries the bound streams, so the live lines are the
      // non-DEBUG ones.
      for (const part of ['print-off', 'stderr-off']) {
        expect(
          entries.filter(
            (entry) => entry.level !== 'DEBUG' && entry.message.includes(marker(part)),
          ),
          dump,
        ).toEqual([])
      }
    })

    await test.step('Log Output on writes the print line at INFO and the stderr line at WARN', async () => {
      expect(
        sourced.filter((entry) => entry.message === marker('print-on')),
        dump,
      ).toEqual([{ level: 'INFO', source: SOURCE, message: marker('print-on') }])
      expect(
        sourced.filter((entry) => entry.message === marker('stderr-on')),
        dump,
      ).toEqual([{ level: 'WARN', source: SOURCE, message: marker('stderr-on') }])
    })

    await test.step('no console message carries a [Python] prefix inside its text', async () => {
      expect(
        sourced.filter((entry) => OLD_PREFIX.test(entry.message)),
        dump,
      ).toEqual([])
    })

    await test.step('a logged exception carries its traceback into the console entry at ERROR', async () => {
      const logged = sourced.filter((entry) => entry.message.startsWith(marker('caught')))
      expect(logged, dump).toHaveLength(1)
      expect(logged[0].level).toBe('ERROR')
      expect(logged[0].source).toBe(SOURCE)
      expect(logged[0].message, 'the traceback travels with the record').toContain(TRACEBACK_HEAD)
      expect(logged[0].message).toContain(`ValueError: ${marker('boom')}`)
    })

    await test.step('a message with a line break is one console entry holding both lines', async () => {
      const whole = `${marker('ml1')}\n${marker('ml2')}`
      expect(
        sourced.filter((entry) => entry.message === whole),
        dump,
      ).toEqual([{ level: 'WARN', source: SOURCE, message: whole }])
    })

    await test.step('a secret Input Variable value is masked in the console line', async () => {
      const masked = `${marker('got')} ${SECRET_MASK}`
      expect(
        sourced.filter((entry) => entry.message === masked),
        dump,
      ).toEqual([{ level: 'INFO', source: SOURCE, message: masked }])
      expectNoSecret(JSON.stringify([entries, copyTexts]), 'console', [secret])
      expectNoSecret(JSON.stringify(events), 'WS events', [secret])
      expectNoSecret(JSON.stringify(variables), 'session variables', [secret])
      expect(variables.sec_var.value).toBe(SECRET_MASK)
    })

    await test.step('the exports keep their values', async () => {
      expect(variables.py_num.value, 'the integer export binds a number').toBe(7)
      expect(variables.py_text.value).toBe(marker('kept'))
    })
  })
})
