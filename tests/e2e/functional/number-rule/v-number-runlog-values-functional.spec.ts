/**
 * V-NUMBER-RUNLOG-VALUES-FUNCTIONAL: run values a number row refuses, and a tiny float on every print surface
 * Wireframe: none (functional)
 * Design Decisions: FIELD-7
 * REQ: REQ-3.1.3.14, REQ-3.1.3.19, REQ-3.1.3.23
 *
 * `fixture-blocks-runlog.json`: four Try/Catch Blocks, each guarding one number row an expression feeds - an HTTP
 * Retry Delay giving NaN, an HTTP Backoff Factor giving infinity, an HTTP Timeout giving True and a While Max
 * iterations giving True - then an HTTP Block with Retry Delay `0.0000001`, a JSON Parser reading `{"v": 0.0000001}`,
 * a Log of the float variable `tiny` (0.0000001), a Log of the table `grid` whose float cell is 0.0000001, a Log of
 * the cells of `grid` and of the integer table `counts`, and a Local Function whose table input holds 0.0000001.
 *
 * Pass Criteria:
 * 1. A float row whose expression gives NaN or infinity stops its Block with the type error naming the value,
 *    `Parameter 'retry_delay' expects float, got NaN` / `... got Infinity`; the Try/Catch catches it and its catch
 *    path runs.
 * 2. An HTTP Timeout whose expression gives True stops the Block with the field's type error
 *    `Parameter 'timeout' expects integer, got bool`, before the Block runs.
 * 3. A While whose Max iterations expression gives True stops with `Parameter 'max_iterations' expects integer,
 *    got bool`.
 * 4. The HTTP Block's DEBUG `Inputs:` line holds `"retry_delay":0.0000001`, the JSON Parser's `Outputs:` line holds
 *    `0.0000001`, a Log of `f'tiny={tiny}'` prints `tiny=0.0000001` and the table Log prints its float cell as the
 *    number `0.0000001` (no quotes); none of these lines writes a number with an exponent.
 * 5. A float cell (0.0000001) and an integer cell (1234567890123456789) of a table variable, and a float cell of a
 *    Function table input, reach the run as numbers: `* 2` gives `0.0000002`, `+ 1` gives `1234567890123456790`,
 *    and none is text (REQ-3.1.3.19).
 * 6. The run passes.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { readFixture } from '../../helpers/element-types'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { formatEntries, getLogCopyTexts, setConsoleMinimumLevel } from '../../helpers/log-reader'
import { deleteTestQuietly, ioLines, nodeIdOf } from '../../helpers/number-rule'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

const DONE = 'number-runlog-done'
const EXPONENT = /\d[eE][+-]?\d/

const REFUSALS = [
  { errorVar: 'err_nan', guard: 'Guard NaN', block: 'NaN Delay', message: "Parameter 'retry_delay' expects float, got NaN" },
  {
    errorVar: 'err_inf',
    guard: 'Guard Infinity',
    block: 'Infinity Backoff',
    message: "Parameter 'retry_backoff_factor' expects float, got Infinity",
  },
  {
    errorVar: 'err_timeout',
    guard: 'Guard True Timeout',
    block: 'True Timeout',
    message: "Parameter 'timeout' expects integer, got bool",
  },
  {
    errorVar: 'err_while',
    guard: 'Guard True Iterations',
    block: 'True Iterations',
    message: "Parameter 'max_iterations' expects integer, got bool",
  },
] as const

test.describe('V-NUMBER-RUNLOG-VALUES-FUNCTIONAL: run values and the print form of a tiny float', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await deleteTestQuietly(request, testId)
  })

  test('NaN, infinity and True stop their Blocks, and 0.0000001 prints in plain digits everywhere', async ({ page }) => {
    test.setTimeout(240_000)
    const fixture = readFixture(__dirname, 'fixture-blocks-runlog.json')
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true, rejectRepairs: true })

    await setConsoleMinimumLevel(page, 'DEBUG')
    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE)
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const consoleText = formatEntries(entries)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    for (const refusal of REFUSALS) {
      await test.step(`${refusal.block}: ${refusal.message}`, async () => {
        const error = sessionValue(variables, refusal.errorVar) as { message?: string; node_id?: string }
        expect(error.message, consoleText).toBe(refusal.message)
        expect(error.node_id, 'the refused Block is named').toBe(nodeIdOf(fixture, refusal.block))
        await expectNodeStatus(page, nodeIdOf(fixture, refusal.block), 'failed')
        expect(logs, `the catch path of ${refusal.guard} ran`).toContain(`${refusal.errorVar.slice(4)}-caught`)
      })
    }

    await test.step('the HTTP Inputs line and the JSON Parser Outputs line write 0.0000001', async () => {
      const inputs = ioLines(entries, 'Tiny Delay', 'Inputs')
      expect(inputs, consoleText).toHaveLength(1)
      expect(inputs[0]).toContain('"retry_delay":0.0000001,')
      expect(inputs[0]).not.toMatch(EXPONENT)
      const outputs = ioLines(entries, 'Tiny Parse', 'Outputs')
      expect(outputs, consoleText).toHaveLength(1)
      expect(outputs[0]).toContain('0.0000001')
      expect(outputs[0]).not.toMatch(EXPONENT)
    })

    const lines = (name: string) =>
      entries
        .filter((entry) => entry.level === 'INFO' && entry.source === blockSource('Log', name))
        .map((entry) => entry.message)

    await test.step('the Log of a float and of a table cell write 0.0000001', async () => {
      expect(lines('Tiny Value'), consoleText).toEqual(['tiny=0.0000001'])
      expect(lines('Tiny Table'), 'a float cell prints as its number').toEqual([
        '{"columns":[{"name":"x","type":"float"}],"rows":[[0.0000001]]}',
      ])
    })

    await test.step('float and integer table cells reach the run as numbers, in a variable and a Function input', async () => {
      expect(lines('Table Cells'), consoleText).toEqual(['cells text=False 0.0000002 text=False 1234567890123456790'])
      expect(
        entries.filter((entry) => entry.level === 'INFO' && entry.message.startsWith('input ')).map((e) => e.message),
        consoleText,
      ).toEqual(['input text=False 0.0000002'])
    })
  })
})
