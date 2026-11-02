/**
 * V-NULL-PRINT-FORM-FUNCTIONAL: WAVE's print form in the Assert detail and in console tables
 * Wireframe: none (functional)
 * Design Decisions: N/A
 * REQ: REQ-3.1.3.23
 *
 * One fixture, one run: five failing Asserts (single mode, so the flow goes on), one check on
 * a variable that holds null inside a Try/Catch, and a Log that prints a table through an
 * f-string.
 *
 * Pass Criteria:
 * 1. A failing Assert writes its summary, the check and an `actual:` line: a string actual
 *    stays quoted (`actual: 'done'`), an integer prints `actual: 3`, a list `actual: [1,2]`,
 *    a list holding null `actual: [1,null]`.
 * 2. An actual over 1000 characters is cut to its first 500, then ` ... `, then its last 500.
 * 3. A check on a variable that holds null is an ordinary false check: the Assert fails amber,
 *    its detail ends `actual: null`, nothing is caught and the catch path never runs.
 * 4. A Log whose f-string prints a table holding boolean and null cells shows `true`,
 *    `false` and `null` in the aligned cells; the stored table keeps the null cells.
 * 5. The failing Asserts end amber (warning), the null check too, and the run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  formatEntries,
  getLogCopyTexts,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { readFixture } from '../../helpers/element-types'
import { BACKEND_URL } from '../../helpers/config'
import { deleteTest } from '../file-picker/picker'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const DONE_MARKER = 'null-print-form-done'

const IDS = {
  assertString: '3d899351-733c-4a35-9e46-bbfc14a50150',
  assertInteger: 'c2ffcf30-ce66-4c4a-a6a4-9a76a4da111c',
  assertList: '014ca48e-f779-4cf0-a810-b4c837b8b6ed',
  assertListNull: '2255954b-7d05-4b92-a640-0118c9a0108b',
  assertLong: '6ca532c7-df6e-4930-81e6-2b11bfb6f056',
  tcNull: '8717c631-270b-4c0e-9c27-fe44b2b1a408',
  assertNull: '69d7c1f9-cf6b-41e7-b36b-9015e602e0e6',
  nullCaught: '1d0b249d-eb44-46de-b77f-d870a12df66d',
  logTable: '6c982849-e9ee-4f79-9544-2b7a92894da5',
  done: '54211702-42ff-455a-bc59-c9dfdb14501b',
} as const

const SUMMARY = 'Assertion failed: 1 of 1 assertions failed'

/** 1200 characters, a-z repeating, so every cut position reads differently. */
const LONG_TEXT = Array.from({ length: 1200 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
/** Python's quoted form of LONG_TEXT, cut the way the Assert detail cuts any actual over 1000. */
const LONG_QUOTED = `'${LONG_TEXT}'`
const LONG_ACTUAL = `actual: ${LONG_QUOTED.slice(0, 500)} ... ${LONG_QUOTED.slice(-500)}`

/** Table.__str__ for the fixture's svc_table: booleans and nulls in the print form. */
const TABLE_GOLDEN = [
  'Table (3 rows x 3 columns)',
  'host    healthy  note',
  'string  boolean  string',
  '------  -------  ------',
  'web     true     null',
  'db      false    ok',
  'cache   null     warm',
]

function loadFixture(): Record<string, unknown> {
  const fixture = readFixture(__dirname, 'fixture-print-form.json')
  fixture.variables.long_text.value = LONG_TEXT
  return fixture
}

function assertLines(entries: readonly LogEntry[], blockName: string): string[] {
  const source = blockSource('Assert', blockName)
  return entries.filter((entry) => entry.source === source).map((entry) => entry.message)
}

test.describe("V-NULL-PRINT-FORM-FUNCTIONAL: WAVE's print form in Assert details and tables", () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
  })

  test('the Assert actual line and a printed table use the print form', async ({ page }) => {
    test.setTimeout(180_000)
    testId = await importValidateAndNavigate(page, loadFixture())

    const status = await startRun(page)
    await finishRun(page, status, DONE_MARKER)
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const consoleText = formatEntries(entries)
    const vars: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step("a string actual stays quoted: actual: 'done'", () => {
      expect(assertLines(entries, 'Assert String Actual'), consoleText).toEqual([
        SUMMARY,
        "- s_done (string) equals 'other'",
        "actual: 'done'",
      ])
    })

    await test.step('an integer and a list print as WAVE prints them: actual: 3, actual: [1,2]', () => {
      expect(assertLines(entries, 'Assert Integer Actual'), consoleText).toEqual([
        SUMMARY,
        '- i_three (integer) equals 4',
        'actual: 3',
      ])
      expect(assertLines(entries, 'Assert List Actual'), consoleText).toEqual([
        SUMMARY,
        '- l_pair (array) contains 5',
        'actual: [1,2]',
      ])
    })

    await test.step('a null item inside the actual prints null: actual: [1,null]', () => {
      expect(assertLines(entries, 'Assert List Null Item'), consoleText).toEqual([
        SUMMARY,
        '- l_with_null (array) contains 5',
        'actual: [1,null]',
      ])
    })

    await test.step('an actual over 1000 characters is cut to the first 500, " ... ", the last 500', () => {
      const lines = assertLines(entries, 'Assert Long Actual')
      expect(lines.slice(0, 2), consoleText).toEqual([SUMMARY, "- long_text (string) equals 'short'"])
      expect(lines.length, 'the summary, the check and one actual line').toBe(3)
      expect(lines[2].length, 'actual: plus 500 + 5 + 500 characters').toBe('actual: '.length + 1005)
      expect(lines[2]).toBe(LONG_ACTUAL)
      expect(lines[2], 'the middle of the value is cut out').not.toContain(LONG_TEXT)
    })

    await test.step('a check on a variable that holds null is a false check ending actual: null, and nothing is caught', async () => {
      expect(sessionValue(vars, 'n_null'), 'the checked variable holds null').toBeNull()
      // Per REQ-3.1.3.25: equals on a null value is false, an ordinary failed check.
      expect(assertLines(entries, 'Assert Null Actual'), consoleText).toEqual([
        SUMMARY,
        '- n_null (integer) equals 1',
        'actual: null',
      ])
      expect(sessionValue(vars, 'null_assert_err'), 'nothing was caught').toBeNull()
      expect(
        entries.filter((entry) => entry.message.startsWith('Try-path error caught')),
        'no Try-path error line',
      ).toEqual([])
      expect(
        entries.some((entry) => entry.message === 'null-check-caught'),
        'the catch path never runs',
      ).toBe(false)
      await expectNodeStatus(page, IDS.assertNull, 'warning')
    })

    await test.step('a Log f-string of a table prints true, false and null in the cells', () => {
      const source = blockSource('Log', 'Print Table')
      const printed = entries.filter((entry) => entry.source === source)
      expect(printed.length, `exactly one table entry from "${source}".\n${consoleText}`).toBe(1)
      expect(printed[0].message.split('\n')).toEqual(TABLE_GOLDEN)

      const table = sessionTable(vars, 'svc_table')
      expect(table.rows, 'the stored table keeps its boolean and null cells').toEqual([
        ['web', true, null],
        ['db', false, 'ok'],
        ['cache', null, 'warm'],
      ])
    })

    await test.step('the failing Asserts and the null check end amber, the catch path never runs, the run passed', async () => {
      for (const id of [IDS.assertString, IDS.assertInteger, IDS.assertList, IDS.assertListNull, IDS.assertLong, IDS.assertNull]) {
        await expectNodeStatus(page, id, 'warning')
      }
      for (const id of [IDS.tcNull, IDS.logTable, IDS.done]) {
        await expectNodeStatus(page, id, 'success')
      }
      await expect(
        page.locator(`[data-testid="workflow-node-${IDS.nullCaught}"]`),
        'the catch path never runs',
      ).not.toHaveAttribute('data-execution-status', 'success')
    })
  })
})
