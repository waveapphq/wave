/**
 * V-NUMBER-BLOCKS-SAVE-FUNCTIONAL: a Block number field keeps the number typed, and refuses one past the rule
 * Wireframe: none (functional)
 * Design Decisions: FIELD-1, FIELDERR-1, PING-17
 * REQ: REQ-3.1.3.14
 *
 * `fixture-blocks.json` holds two HTTP Blocks the spec types into through their sheets. `fixture-blocks-stored.json`
 * holds values only a stored file can hold (a 20-digit integer, a 29-significant-digit float, a Ping Interval a hair
 * under 0.2); it is written through admin bulk for the window checks and sent to POST /tests for the Save checks.
 *
 * Pass Criteria:
 * 1. Timeout `007`, Retry Delay `2.50` and Max Size `1234567890123456789` typed in the sheet are stored as that exact
 *    text; Max Redirects `5000` and Backoff Factor `2.5` are stored as JSON numbers.
 * 2. A float typed `0.0000001` is stored and reopens as `0.0000001` and takes more keys; `1000000000000000000000` in a
 *    float field reopens in plain digits.
 * 3. The run uses those numbers: each HTTP Block's DEBUG `Inputs:` line holds `"timeout":7`, `"retry_delay":2.5`,
 *    `"max_size":1234567890123456789`, `"retry_delay":0.0000001` and `"retry_backoff_factor":1000000000000000000000`,
 *    never an exponent.
 * 4. POST /tests refuses a 20-digit Max Size with `Setting 'max_size' of block 'http-client' allows at most 19 digits,
 *    got 20` and a 29-digit Retry Delay with `... allows at most 28 significant digits, got 29`; in the window those
 *    rows show `Maximum 19 digits` / `Maximum 28 significant digits`, the badge names them and Save is held.
 * 5. Ping Interval `0.19999999999999999999` is refused with `Interval (seconds) must be at least 0.2` on the row and on
 *    the canvas badge, and at POST /tests with `Setting 'interval' of block 'ping' must be at least 0.2, got
 *    0.19999999999999999999`; `0.2` saves.
 * 6. A Ping Interval sent as NaN, Infinity or -Infinity is refused at POST /tests with only the type finding
 *    (`... expects float, got NaN`), no bound finding.
 * 7. A stored Max Size `abc` shows `abc` with `Enter a valid integer value` on its row, and the canvas badge reads
 *    `Max Size: Enter a valid integer value`.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { numberInput, rowAlerts, rowError, saveButton } from '../../helpers/config-sheet'
import { BACKEND_URL } from '../../helpers/config'
import { readFixture } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { dismissLoadDialogIfPresent, openTest, rawPersistTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, setConsoleMinimumLevel } from '../../helpers/log-reader'
import {
  badgeLines,
  clearNumber,
  createTest,
  deleteTestQuietly,
  discardSheet,
  expectTestRefused,
  ioLines,
  nodeIdOf,
  oneNodeTest,
  openGroup,
  rawJson,
  typeNumber,
} from '../../helpers/number-rule'
import { openBlockSheet, saveBlockSheet } from '../../helpers/workbench'
import { persistedValues, saveWorkbench } from '../file-picker/picker'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const DONE = 'number-blocks-done'

const CAP = {
  maxSize: "Setting 'max_size' of block 'http-client' allows at most 19 digits, got 20",
  retryDelay: "Setting 'retry_delay' of block 'http-client' allows at most 28 significant digits, got 29",
}
const INTERVAL_ROW = 'Interval (seconds) must be at least 0.2'
const INTERVAL_SAVE = "Setting 'interval' of block 'ping' must be at least 0.2, got 0.19999999999999999999"

test.describe('V-NUMBER-BLOCKS-SAVE-FUNCTIONAL: a Block number field keeps the number typed', () => {
  const created: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTestQuietly(request, id)
  })

  test('digit text typed in number rows is stored as typed, reopens as typed and runs with that number', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const fixture = readFixture(__dirname, 'fixture-blocks.json')
    const exact = nodeIdOf(fixture, 'Exact Digits')
    const tiny = nodeIdOf(fixture, 'Tiny Digits')
    const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })
    created.push(testId)

    await test.step('the rows take digit text, a tiny float and a huge float', async () => {
      const sheet = await openBlockSheet(page, exact)
      await openGroup(sheet, 'Timeouts & Retries')
      await typeNumber(page, numberInput(sheet, 'timeout'), '007')
      await typeNumber(page, numberInput(sheet, 'retry_delay'), '2.50')
      await typeNumber(page, numberInput(sheet, 'retry_backoff_factor'), '2.5')
      await openGroup(sheet, 'Response')
      await typeNumber(page, numberInput(sheet, 'max_size'), '1234567890123456789')
      await openGroup(sheet, 'Connection')
      await typeNumber(page, numberInput(sheet, 'max_redirects'), '5000')
      await expect(rowAlerts(sheet), 'every typed number keeps the rule').toHaveCount(0)
      await saveBlockSheet(sheet)

      const tinySheet = await openBlockSheet(page, tiny)
      await openGroup(tinySheet, 'Timeouts & Retries')
      await typeNumber(page, numberInput(tinySheet, 'retry_delay'), '0.0000001')
      await typeNumber(page, numberInput(tinySheet, 'retry_backoff_factor'), '1000000000000000000000')
      await expect(rowAlerts(tinySheet)).toHaveCount(0)
      await saveBlockSheet(tinySheet)
      await saveWorkbench(page)
    })

    await test.step('the stored Test holds exact text where a JSON number would change it, else the number', async () => {
      const stored = await persistedValues(request, testId)
      expect(stored[exact]).toMatchObject({
        timeout: '007',
        retry_delay: '2.50',
        max_size: '1234567890123456789',
        max_redirects: 5000,
        retry_backoff_factor: 2.5,
      })
      expect(stored[tiny]).toMatchObject({ retry_delay: '0.0000001', retry_backoff_factor: '1000000000000000000000' })
    })

    await test.step('a reload shows every row as typed, and the tiny float takes more keys', async () => {
      await openTest(page, testId)
      const sheet = await openBlockSheet(page, exact)
      await openGroup(sheet, 'Timeouts & Retries')
      await openGroup(sheet, 'Response')
      await openGroup(sheet, 'Connection')
      await expect(numberInput(sheet, 'timeout')).toHaveValue('007')
      await expect(numberInput(sheet, 'retry_delay')).toHaveValue('2.50')
      await expect(numberInput(sheet, 'retry_backoff_factor')).toHaveValue('2.5')
      await expect(numberInput(sheet, 'max_size')).toHaveValue('1234567890123456789')
      await expect(numberInput(sheet, 'max_redirects')).toHaveValue('5000')
      await discardSheet(page, sheet)

      const tinySheet = await openBlockSheet(page, tiny)
      await openGroup(tinySheet, 'Timeouts & Retries')
      const delay = numberInput(tinySheet, 'retry_delay')
      await expect(delay).toHaveValue('0.0000001')
      await expect(numberInput(tinySheet, 'retry_backoff_factor')).toHaveValue('1000000000000000000000')
      await delay.click()
      await page.keyboard.press('End')
      await page.keyboard.type('5')
      await expect(delay, 'the plain-digit text is edited like any number').toHaveValue('0.00000015')
      await page.keyboard.press('Backspace')
      await expect(delay).toHaveValue('0.0000001')
      await discardSheet(page, tinySheet)
    })

    await test.step('the run sends every number as stored, in plain digits', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const status = await startRun(page)
      await finishRun(page, status, DONE)
      const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
      const exactInputs = ioLines(entries, 'Exact Digits', 'Inputs')
      expect(exactInputs, 'one Inputs line for Exact Digits').toHaveLength(1)
      for (const part of [
        '"timeout":7,',
        '"retry_delay":2.5,',
        '"retry_backoff_factor":2.5,',
        '"max_size":1234567890123456789',
        '"max_redirects":5000',
      ]) {
        expect(exactInputs[0], `Exact Digits sends ${part}`).toContain(part)
      }
      const tinyInputs = ioLines(entries, 'Tiny Digits', 'Inputs')
      expect(tinyInputs, 'one Inputs line for Tiny Digits').toHaveLength(1)
      expect(tinyInputs[0]).toContain('"retry_delay":0.0000001,')
      expect(tinyInputs[0]).toContain('"retry_backoff_factor":1000000000000000000000,')
      expect(tinyInputs[0], 'no number is written with an exponent').not.toMatch(/\d[eE][+-]?\d/)
      await expectNodeStatus(page, exact, 'success')
      await expectNodeStatus(page, tiny, 'success')
    })
  })

  test('a number past the digit caps or a hair under a bound is refused at Save, on the row and on the canvas', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const fixture = readFixture(__dirname, 'fixture-blocks-stored.json')
    const cap = nodeIdOf(fixture, 'Too Many Digits')
    const interval = nodeIdOf(fixture, 'Interval Bound')
    const text = nodeIdOf(fixture, 'Text Digits')

    await test.step('POST /tests refuses each value with its exact finding', async () => {
      await expectTestRefused(request, oneNodeTest(fixture, 'Too Many Digits'), [
        ['SETTING_TOO_MANY_DIGITS', CAP.retryDelay],
        ['SETTING_TOO_MANY_DIGITS', CAP.maxSize],
      ])
      await expectTestRefused(request, oneNodeTest(fixture, 'Interval Bound'), [['SETTING_BELOW_MINIMUM', INTERVAL_SAVE]])
      created.push(await createTest(request, oneNodeTest(fixture, 'Interval Bound', { interval: '0.2' })))
    })

    await test.step('a non-finite Interval is refused by type alone', async () => {
      for (const [raw, got] of [
        ['NaN', 'NaN'],
        ['Infinity', 'Infinity'],
        ['-Infinity', '-Infinity'],
      ]) {
        const body = rawJson(oneNodeTest(fixture, 'Interval Bound', { interval: '__NOT_FINITE__' }), {
          __NOT_FINITE__: raw,
        })
        expect(body).toContain(`"interval":${raw}`)
        await expectTestRefused(request, body, [
          ['INVALID_SETTING_TYPE', `Setting 'interval' of block 'ping' expects float, got ${got}`],
        ])
      }
    })

    const testId = await persistStored(request, fixture)
    created.push(testId)
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    await test.step('the canvas badges name each row the rule refuses', async () => {
      expect((await badgeLines(page, cap)).sort()).toEqual(
        ['Max Size: Maximum 19 digits', 'Retry Delay: Maximum 28 significant digits'].sort(),
      )
      expect(await badgeLines(page, interval)).toEqual([INTERVAL_ROW])
      expect(await badgeLines(page, text)).toEqual(['Max Size: Enter a valid integer value'])
    })

    await test.step('the window shows the cap messages on the rows and holds Save', async () => {
      const sheet = await openBlockSheet(page, cap)
      await openGroup(sheet, 'Timeouts & Retries')
      await openGroup(sheet, 'Response')
      await expect(numberInput(sheet, 'max_size'), 'the stored text is shown as stored').toHaveValue('12345678901234567890')
      await expect(rowError(sheet, 'max_size')).toHaveText('Maximum 19 digits')
      await expect(rowError(sheet, 'retry_delay')).toHaveText('Maximum 28 significant digits')
      await expect(saveButton(sheet)).toBeDisabled()
      await clearNumber(page, numberInput(sheet, 'max_size'), '')
      await clearNumber(page, numberInput(sheet, 'retry_delay'), '1')
      await expect(rowAlerts(sheet)).toHaveCount(0)
      await saveBlockSheet(sheet)
    })

    await test.step('the Interval row compares exactly: a hair under 0.2 is held, 0.2 saves', async () => {
      const sheet = await openBlockSheet(page, interval)
      await expect(numberInput(sheet, 'interval')).toHaveValue('0.19999999999999999999')
      await expect(rowError(sheet, 'interval')).toHaveText(INTERVAL_ROW)
      await expect(saveButton(sheet)).toBeDisabled()
      await typeNumber(page, numberInput(sheet, 'interval'), '0.2')
      await expect(rowAlerts(sheet)).toHaveCount(0)
      await saveBlockSheet(sheet)
      await expect(
        page.locator(`[data-testid="workflow-node-${interval}"] [data-testid="node-validation-alert"]`),
      ).toHaveCount(0)
    })

    await test.step('text in an integer row is shown as stored and named on its row', async () => {
      const sheet = await openBlockSheet(page, text)
      await openGroup(sheet, 'Response')
      await expect(numberInput(sheet, 'max_size')).toHaveValue('abc')
      await expect(rowError(sheet, 'max_size')).toHaveText('Enter a valid integer value')
      await expect(saveButton(sheet)).toBeDisabled()
      await discardSheet(page, sheet)
    })

    await test.step('with the last stored text cleared, the Test saves 0.2 and drops the refused values', async () => {
      const sheet = await openBlockSheet(page, text)
      await openGroup(sheet, 'Response')
      await clearNumber(page, numberInput(sheet, 'max_size'), '')
      await saveBlockSheet(sheet)
      await saveWorkbench(page)
      const stored = await persistedValues(request, testId)
      expect(stored[interval].interval).toBe(0.2)
      expect(stored[cap].max_size).toBeUndefined()
      expect(stored[cap].retry_delay).toBeUndefined()
      expect(stored[text].max_size).toBeUndefined()
    })
  })
})

/** Write the stored fixture as it is, past the Save check, the way an older file or an outside tool leaves it. */
async function persistStored(request: APIRequestContext, fixture: Record<string, any>): Promise<string> {
  return rawPersistTest(request, {
    name: `zz-11541-s8-stored-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nodes: fixture.workflow.nodes,
    edges: fixture.workflow.edges,
    variables: fixture.variables,
  })
}
