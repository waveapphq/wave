/**
 * V-TABLE-SANDBOX-NAMES: the table types of the expression sandbox are names an expression may use
 * Wireframe: none (functional)
 * Design Decisions: none
 * REQ: REQ-3.1.3.13
 *
 * Setup (API): one blank `zz-` Test per test (`POST /tests`, no blocks, no variables) and the shared
 * execution environment (`ensureEnvironment`), both removed after. The variable, the Logs, their
 * expressions and the runs are all built through the UI.
 *
 * Pass Criteria:
 * 1. An Expression variable of type Table built with `Table([('k', 'integer')])` is created, the run
 *    passes the pre-run check, and a Log reading it prints `k:integer`.
 * 2. A block setting expression calling `Table`, `TableRowView` and `ColumnType` shows no warning or
 *    error in the sheet, the run passes the pre-run check, and the Log prints `b7float`.
 * 3. Typing the start of each name in an expression offers it in the suggestion list.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { rowError, rowWarning } from '../../helpers/config-sheet'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries, type LogEntry } from '../../helpers/log-reader'
import {
  createModal,
  insertCodeValue,
  openCreateModal,
  setCreateKind,
  setCreateName,
  setCreateType,
  submitCreate,
  variableRow,
} from '../../helpers/variable-create'
import {
  dropBelowStart,
  openBlockSheet,
  runToEnd,
  selectEnvironment,
  setBlockExpression,
} from '../../helpers/workbench'
import { closeConfig } from '../file-picker/picker'

function uniqueName(): string {
  return `zz-v-table-sandbox-names-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Run the Test; the pre-run check lets it start and it passes. */
async function runPassing(page: Page): Promise<LogEntry[]> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
  return entries
}

/** A Log under Start printing one expression; returns its id. */
async function addExpressionLog(page: Page, expression: string): Promise<string> {
  const id = await dropBelowStart(page, 'log')
  await setBlockExpression(page, id, 'message', expression)
  return id
}

test.describe('V-TABLE-SANDBOX-NAMES: Table, TableRowView and ColumnType in expressions', () => {
  let testId = ''

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.beforeEach(async ({ page, request }) => {
    testId = await createValidTest(request, { name: uniqueName(), nodes: [] })
    await openTest(page, testId)
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('an Expression variable built with Table(...) passes the pre-run check and runs', async ({ page }) => {
    await test.step("create t_tab, a Table Expression variable Table([('k', 'integer')])", async () => {
      const modal = await openCreateModal(page)
      await setCreateName(page, 't_tab')
      await setCreateType(page, 'table')
      await setCreateKind(page, 'Expression')
      await insertCodeValue(page, "Table([('k', 'integer')])")
      await leaveExpressionEditor(modal)
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(variableRow(page, 't_tab')).toBeVisible()
    })

    await addExpressionLog(page, "t_tab.col_names()[0] + ':' + t_tab.col_types()[0]")

    const entries = await runPassing(page)
    expectConsoleLine(entries, 'INFO', 'k:integer')
  })

  test('a block setting expression calling Table, TableRowView and ColumnType passes the pre-run check and runs', async ({
    page,
  }) => {
    const expression =
      "Table(['a', 'b']).col_names()[1] + str(TableRowView([7], ['k'])['k']) + ColumnType('float').value"
    const logId = await addExpressionLog(page, expression)

    await test.step('the expression carries no warning or error', async () => {
      const sheet = await openBlockSheet(page, logId)
      await expect.soft(rowWarning(sheet, 'message')).toHaveCount(0)
      await expect.soft(rowError(sheet, 'message')).toHaveCount(0)
      await closeConfig(sheet)
    })

    const entries = await runPassing(page)
    expectConsoleLine(entries, 'INFO', 'b7float')
  })

  test('the suggestion list offers Table, TableRowView and ColumnType', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, 'log'))
    await sheet.locator('[data-testid="param-row-message"] [data-testid="expression-toggle"]').click()
    const editor = sheet.locator('[data-testid="param-input-message"] .cm-content')
    const list = page.locator('.cm-tooltip-autocomplete:visible')
    for (const [typed, name] of [
      ['Tab', 'Table'],
      ['TableR', 'TableRowView'],
      ['ColumnT', 'ColumnType'],
    ] as const) {
      await editor.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Delete')
      await page.keyboard.insertText(typed)
      await expect(list.getByRole('option').filter({ hasText: new RegExp(`^${name}`) }).first(), name).toBeVisible()
      await leaveExpressionEditor(editor)
    }
  })
})
