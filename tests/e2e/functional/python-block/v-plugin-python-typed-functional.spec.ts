/**
 * V-PLUGIN-PYTHON-TYPED: Python typed round trip
 * Wireframe: none
 * Design Decisions: PYRUN-4, PYRUN-5, PYRUN-6, PYRUN-7, PYRUN-13, PYRUN-20
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. The Script body row opens the Python-mode sheet, takes a typed script, and the
 *    SAVED script is what runs: the persisted Test holds the typed text, the block's
 *    Stdout carries what that script printed, and its export binds what it set.
 * 2. A table Input Variable iterates as row dicts inside the script, a float Input
 *    Variable arrives as a decimal.Decimal, a null table cell arrives as None, and
 *    0.1 + 0.2 comes back exactly 0.3.
 * 3. Every Variable Exports row fills its bound WAVE variable with its declared type:
 *    string, integer, float, boolean, array, map, and a list of dicts exported to a
 *    table variable comes back as a table with the first row's key order.
 * 4. An export that does not fit its bound type fails the block with exactly
 *    `Script variable 'n' is not a valid integer`, reason OutputVariable, and the
 *    offending value is on no message; the bound variable keeps its value.
 * 5. sys.argv[1:] is the Arguments rows in order.
 * 6. print goes to Stdout and stderr text to Stderr; Exit Code and Success bind.
 * 7. An export the script never sets leaves its bound variable alone and is no failure.
 */

import { randomBytes } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import { openStringParamSheet } from '../../helpers/param-config'
import { openSessionEventCollector, type WsEvent } from '../../helpers/ws-events'
import {
  deleteTest,
  openConfig,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'

const WRONG_TYPE = "Script variable 'n' is not a valid integer"
const RECORDED_WRONG_TYPE = `Script failed (OutputVariable): ${WRONG_TYPE}`
const NEVER_SET =
  "Variable export 'never_out' was never set; the bound variable keeps its value"

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

/** Distinct WS log entries (by entry id) at `level` whose message is exactly `text`. */
function logEventsReading(events: WsEvent[], level: string, text: string): string[] {
  const ids = events
    .filter((event) => event.level === level && event.message === text)
    .map((event) => String(event.id))
  return [...new Set(ids)]
}

/** A table variable as GET /workbench/{sid}/variables renders it. */
interface TableValue {
  columns: Array<{ name: string; type: string }>
  rows: unknown[][]
}

/** The script an author types into the sheet; never the text an assertion reads. */
function uiBody(token: string): string {
  return [
    'part = "ui"',
    `mark = part + "-typed-${token}"`,
    'ui_mark = mark',
    'print("ran " + mark)',
  ].join('\n')
}

/** Drive the Script body row: open the Python-mode sheet, replace the text, Save, Close. */
async function typeScriptBody(page: Page, dialog: Locator, body: string): Promise<void> {
  const sheet = await openStringParamSheet(dialog, page, 'script')
  const editor = sheet.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // insertText, not type: auto-close and auto-indent would rewrite a typed script.
  await page.keyboard.insertText(body)
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  await expect(save, 'Save wakes up once the draft differs').toBeEnabled()
  await save.click()
  // Per PYRUN-20 Save applies, keeps the sheet open and goes dead again.
  await expect(save).toBeDisabled()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

/** Start the run, then subscribe while the leading Delay holds it. */
async function runWithCollector(page: Page, bookend: string) {
  const status = await startRun(page)
  const sid = await getActiveSessionId(page)
  const collector = await openSessionEventCollector(page, sid, [`log:${sid}`, `variable:${sid}`])
  await finishRun(page, status, bookend, 120_000)
  const events = await collector.harvest()
  await collector.close()
  return { sid, events }
}

function warnsReading(entries: LogEntry[], text: string): LogEntry[] {
  return entries.filter((entry) => entry.level === 'WARN' && entry.message === text)
}

test.describe('V-PLUGIN-PYTHON-TYPED: the Python typed round trip', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('a typed script runs, typed inputs arrive as their Python types, and typed exports bind', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const testId = await importValidateAndNavigate(page, loadFixture('fixture-typed.json', token))
    createdTests.push(testId)

    const typed = uiBody(token)
    const mark = `ui-typed-${token}`

    await test.step('the Script body row takes a typed script and saves it (L-A)', async () => {
      const dialog = await openConfig(page, 'py-ui')
      await typeScriptBody(page, dialog, typed)
      await saveConfig(dialog)
      await saveWorkbench(page)
      const values = await persistedValues(request, testId)
      expect(values['py-ui'].script, 'the saved Test holds the typed script').toBe(typed)
    })

    const { sid, events } = await runWithCollector(page, `PY-TYPED-done-${token}`)
    const variables = await getSessionVariables(page, sid)
    const entries = await getLogEntries(page)

    await test.step('the saved typed script is the one that ran (L-A)', async () => {
      expect(variables.ui_mark_v.value, 'the typed script set its own export').toBe(mark)
      expect(
        stripOneNewline(String(variables.ui_stdout_v.value)),
        'what the typed script printed reached Stdout',
      ).toBe(`ran ${mark}`)
      await expectNodeStatus(page, 'py-ui', 'success')
    })

    await test.step('typed Input Variables arrive as their Python types (L-B)', async () => {
      const probe = variables.probe_v.value as Record<string, string>
      expect(probe.row_keys, 'a table row is a dict keyed by the column names').toBe(
        'name,temp_c,note',
      )
      expect(probe.row_names, 'the script iterates the table as row dicts').toBe('alpha,beta')
      expect(probe.row_count).toBe('2')
      expect(probe.row_total, 'the float cells add up exactly').toBe('41.75')
      expect(probe.cell_kind, 'a float table cell arrives as a Decimal').toBe('Decimal')
      expect(probe.note_kind, 'a null table cell arrives as None').toBe('NoneType')
      expect(probe.ratio_kind, 'a float Input Variable arrives as a Decimal').toBe('Decimal')
      expect(probe.sum_text, '0.1 + 0.2 is exact, not a binary float').toBe('0.3')
      expect(probe.count_kind).toBe('int')
      expect(probe.flag_kind).toBe('bool')
      expect(probe.list_kind).toBe('list')
      expect(probe.map_kind).toBe('dict')
      expect(probe.text_kind).toBe('str')
    })

    await test.step('every export binds as the type of the variable it binds to (L-C)', async () => {
      expect(variables.s_v.value).toBe(`s-${token}`)
      expect(variables.i_v.value, 'an integer export binds a number, not text').toBe(7)
      expect(String(variables.f_v.value), 'a float export binds the exact decimal').toBe('0.3')
      expect(variables.b_v.value).toBe(true)
      expect(variables.a_v.value).toEqual(['a', 'b c', ''])
      expect(variables.m_v.value).toEqual({ k1: 'v1', k2: 'v 2' })
    })

    await test.step('a list of dicts exported to a table binds a table in first-row key order (L-C)', async () => {
      expect(variables.t_v.type).toBe('table')
      const table = variables.t_v.value as TableValue
      expect(
        table.columns.map((column) => column.name),
        'the columns follow the first row key order, not an alphabetical one',
      ).toEqual(['sku', 'qty'])
      expect(table.columns.map((column) => column.type)).toEqual(['string', 'integer'])
      expect(table.rows).toEqual([
        ['s1', 2],
        ['s2', 5],
      ])
    })

    await test.step('the Arguments rows reach the script as sys.argv[1:] in order', async () => {
      expect(variables.argv_v.value).toEqual(['alpha', 'beta gamma', 'delta'])
    })

    await test.step('print is Stdout, stderr text is Stderr, and Exit Code and Success bind', async () => {
      expect(stripOneNewline(String(variables.out_v.value))).toBe(`out py-mark-${token}`)
      expect(stripOneNewline(String(variables.err_v.value))).toBe(`err py-mark-${token}`)
      expect(variables.code_v.value).toBe(0)
      expect(variables.ok_v.value).toBe(true)
      await expectNodeStatus(page, 'py-typed', 'success')
    })

    await test.step('an export the script never sets leaves its variable alone', async () => {
      expect(variables.keep_v.value, 'the never-set export keeps the variable value').toBe(
        'keep-me',
      )
      expect(
        logEventsReading(events, 'DEBUG', NEVER_SET),
        'exactly one DEBUG line names the never-set export',
      ).toHaveLength(1)
    })

    await test.step('an export that does not fit its type fails the block, value unnamed (L-C)', async () => {
      expect(String(variables.bad_err.value)).toBe(WRONG_TYPE)
      expect(variables.bad_reason.value).toBe('OutputVariable')
      expect(variables.bad_ok.value).toBe(false)
      const offending = `xyz-${token}`
      expect(
        String(variables.bad_err.value),
        'the refused value is never echoed in the message',
      ).not.toContain(offending)
      expect(
        entries.filter((entry) => entry.message.includes(offending)),
        'the refused value is on no console entry either',
      ).toEqual([])
      expect(variables.n_v.value, 'the bound variable keeps its value').toBe(0)
      expect(
        variables.bad_code.value,
        'the script itself ended cleanly; only the export refused',
      ).toBe(0)
      expect(
        warnsReading(entries, RECORDED_WRONG_TYPE),
        `WARN lines:\n${JSON.stringify(entries, null, 2)}`,
      ).toHaveLength(1)
      await expectNodeStatus(page, 'py-badtype', 'warning')
    })
  })
})
