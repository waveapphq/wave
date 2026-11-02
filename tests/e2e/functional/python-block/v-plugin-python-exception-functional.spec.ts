/**
 * V-PLUGIN-PYTHON-EXCEPTION: Python failure outcomes
 * Wireframe: none
 * Design Decisions: PYRUN-6, PYRUN-7
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. Under Record and continue an uncaught ValueError gives Success false, Error
 *    exactly `ValueError: boom` and Reason `Exception`, and the block paints the
 *    recorded-failure state while the run carries on.
 * 2. The traceback is written to Stderr and reaches the run console at ERROR.
 * 3. An export the script set BEFORE the raise still lands in its WAVE variable.
 * 4. Exit Code reads 1 for an uncaught exception.
 * 5. Under Fail the block the same exception fails the run, and only the Record leg
 *    writes the recorded-failure line.
 * 6. sys.exit(2) fails with exactly `Script exited with code 2` and reason
 *    NonZeroExit; sys.exit() and sys.exit(0) pass with Exit Code 0.
 * 7. sys.exit("text") puts the text on Stderr and fails with exactly
 *    `Script exited with code 1: text-<token>`.
 * 8. A script that does not parse fails with reason Exception and a message of the
 *    shape `SyntaxError: ... (line 2)`.
 */

import { randomBytes } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRunAnyVerdict, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { deleteTest } from '../file-picker/picker'

const RAISED = 'ValueError: boom'
const RECORDED_EXCEPTION = `Script failed (Exception): ${RAISED}`
const TRACEBACK_HEAD = 'Traceback (most recent call last):'
const EXIT_TWO = 'Script exited with code 2'
const SYNTAX_SHAPE = /^SyntaxError: .+ \(line 2\)$/
const FAILED_BLOCK_LINE = /^Block '.+' failed: ValueError: boom$/
const HALT_MARKER = `failed: ${RAISED}`

// A console row's copy text: "HH:MM:SS.mmm ZONE LEVEL [source] message".
const COPY_TEXT_ROW =
  /^\d{2}:\d{2}:\d{2}\.\d{3} \S+ (DEBUG|INFO|WARN|ERROR|FATAL) +\[(.*?)\] ([\s\S]*)$/

interface ConsoleEntry {
  level: string
  source: string
  message: string
}

const createdTests: string[] = []

/** A fresh per-run token: "py" plus 8 lowercase hex characters. */
function newToken(): string {
  return `py${randomBytes(4).toString('hex')}`
}

/** A deep copy of the fixture with every __TOKEN__ in every string replaced. */
function withToken<T>(fixture: T, token: string): T {
  return JSON.parse(JSON.stringify(fixture).split('__TOKEN__').join(token)) as T
}

function loadFixture(file: string, token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
  return withToken(raw as Record<string, unknown>, token)
}

/** The stream with one trailing newline removed, if it has one. */
function stripOneNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}

/** Console entries read from each row's copy text, which keeps the newlines of a traceback. */
function consoleEntriesFromCopy(copyTexts: string[]): ConsoleEntry[] {
  return copyTexts.map((text) => {
    const row = COPY_TEXT_ROW.exec(text)
    return row
      ? { level: row[1], source: row[2], message: row[3].trim() }
      : { level: '', source: '', message: text }
  })
}

/** Run to whatever verdict the workflow reaches, gated on the marker line given. */
async function runToVerdict(page: Page, marker: string) {
  const status = await startRun(page)
  return finishRunAnyVerdict(page, status, marker, 120_000)
}

test.describe('V-PLUGIN-PYTHON-EXCEPTION: how a Python block fails', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('an uncaught exception, the sys.exit codes and a script that does not parse', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(
      page,
      loadFixture('fixture-exception.json', token),
    )
    createdTests.push(testId)

    // The bookend Log sits before the Fail leg, so the run's LAST line gates the harvest.
    const { verdict, logs } = await runToVerdict(page, HALT_MARKER)
    expect(
      logs.some((line) => line.includes(`PY-EXC-done-${token}`)),
      'the run reached the bookend before the Fail leg',
    ).toBeTruthy()
    const sid = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sid)
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))

    await test.step('an uncaught exception under Record and continue is recorded, not fatal', async () => {
      expect(variables.rec_ok.value).toBe(false)
      expect(String(variables.rec_err.value)).toBe(RAISED)
      expect(variables.rec_reason.value).toBe('Exception')
      expect(variables.rec_code.value, "Python's own code for an uncaught exception").toBe(1)
      await expectNodeStatus(page, 'py-record', 'warning')
      expect(
        entries.filter((entry) => entry.level === 'WARN' && entry.message === RECORDED_EXCEPTION),
        'only the Record leg writes the recorded-failure line',
      ).toHaveLength(1)
    })

    await test.step('the traceback is on Stderr and on the run console at ERROR', async () => {
      const stderr = String(variables.rec_stderr.value)
      expect(stderr).toContain(TRACEBACK_HEAD)
      expect(
        stripOneNewline(stderr).split('\n').pop(),
        'the traceback ends on the exception line',
      ).toBe(RAISED)
      const traced = entries.find(
        (entry) =>
          entry.level === 'ERROR' &&
          entry.message.includes(TRACEBACK_HEAD) &&
          entry.message.includes(RAISED),
      )
      expect(
        traced,
        `no ERROR console entry carries the traceback. Got:\n${JSON.stringify(entries, null, 2)}`,
      ).toBeTruthy()
    })

    await test.step('an export set before the raise still lands (PYRUN-6)', async () => {
      expect(
        variables.before_v.value,
        'the globals exist when the script raises, so what it set is read',
      ).toBe(`kept-${token}`)
    })

    await test.step('sys.exit with a non-zero code fails as NonZeroExit', async () => {
      expect(String(variables.e2_err.value)).toBe(EXIT_TWO)
      expect(variables.e2_reason.value).toBe('NonZeroExit')
      expect(variables.e2_ok.value).toBe(false)
      expect(variables.e2_code.value).toBe(2)
      expect(String(variables.e2_stderr.value), 'an int exit writes nothing to stderr').toBe('')
      await expectNodeStatus(page, 'py-exit-2', 'warning')
    })

    await test.step('sys.exit with no value and sys.exit(0) pass', async () => {
      expect(variables.bare_ok.value).toBe(true)
      expect(variables.bare_code.value).toBe(0)
      expect(variables.zero_ok.value).toBe(true)
      expect(variables.zero_code.value).toBe(0)
      await expectNodeStatus(page, 'py-exit-bare', 'success')
      await expectNodeStatus(page, 'py-exit-zero', 'success')
    })

    await test.step('sys.exit with text puts the text on Stderr and names it in the message', async () => {
      expect(stripOneNewline(String(variables.t_stderr.value))).toBe(`text-${token}`)
      expect(String(variables.t_err.value)).toBe(`Script exited with code 1: text-${token}`)
      expect(variables.t_reason.value).toBe('NonZeroExit')
      expect(variables.t_code.value).toBe(1)
      await expectNodeStatus(page, 'py-exit-text', 'warning')
    })

    await test.step('a script that does not parse fails as an Exception naming its line', async () => {
      expect(String(variables.syn_err.value)).toMatch(SYNTAX_SHAPE)
      expect(variables.syn_reason.value).toBe('Exception')
      expect(variables.syn_ok.value).toBe(false)
      expect(variables.syn_code.value).toBe(1)
      await expectNodeStatus(page, 'py-syntax', 'warning')
    })

    await test.step('the same exception under Fail the block fails the run', async () => {
      expect(verdict, 'the run ends failed, not passed').toBe('failed')
      await expectNodeStatus(page, 'py-fail', 'failed')
      const halted = entries.find(
        (entry) => entry.level === 'ERROR' && FAILED_BLOCK_LINE.test(entry.message),
      )
      expect(
        halted,
        `no ERROR console entry ends the run on the exception. Got:\n${JSON.stringify(entries, null, 2)}`,
      ).toBeTruthy()
    })
  })
})
