/**
 * V-VARPICK-SUGGEST-FOCUS: a suggestion list belongs to the field that has focus
 * Wireframe: none (functional)
 * Design Decisions: VARPICK-1, VMGR-74, VMGR-110
 * REQ: REQ-3.5.1.20
 *
 * Setup (API): one blank `zz-` Test per test (`POST /tests`, no blocks), deleted after. The
 * variable `t_src`, every block, sheet, window and editor is opened through the UI.
 *
 * Pass Criteria (each editor host: a block setting expression, a check row expression, a table
 * filter expression row, a Function Block input binding, the create window in Expression and in
 * Template kind, the variable's window in Edit for an Expression and a Template source, a
 * setting's Edit value sheet in Template kind, the full expression editor, a Python script body):
 * 1. While the field has focus, typing the start of a name opens the suggestion list.
 * 2. Leaving the field closes the open list.
 * 3. Typing and leaving the field at once never opens a list: none is on screen after the list's
 *    delay.
 * 4. In the variable's window in Edit (VMGR-74, VMGR-110) the list offers the variables in scope,
 *    and Ctrl/Cmd+E in the source field opens the full expression editor.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { exprToggle } from '../../helpers/config-sheet'
import { addExpressionRow } from '../../helpers/condition-builder'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import { openStringParamSheet } from '../../helpers/param-config'
import { addFilterBlock } from '../../helpers/table-transform'
import {
  createFunctionParam,
  createSimpleVariable,
  openCreateModal,
  openEditWindow,
  setCreateKind,
  setCreateName,
  valueEditor,
} from '../../helpers/variable-create'
import { digIn, dropBelowStart, openBlockSheet, popToBreadcrumbSegment } from '../../helpers/workbench'
import { createComputedVariable } from '../var-manager-panel/unused-places'
import { uniqueName } from '../var-manager-panel/references-helpers'

const LIST = '.cm-tooltip-autocomplete:visible'
// The list opens about 100 ms after the last keystroke; a fetched list (Python) can take longer.
const LIST_DELAY_MS = 2_000

interface Typing {
  /** Typed into the emptied field: the start of a name the list offers. */
  first: string
  /** Typed at the end afterwards: still a name the list offers. */
  more: string
  /** How long the first list may take (a Python body's first list loads the language server). */
  firstListTimeout?: number
}

const NAME_TYPING: Typing = { first: 't_s', more: 'r' }
const TEMPLATE_TYPING: Typing = { first: '{{t_s', more: 'r' }

/** Clear the field and type `text` in one input. */
async function retype(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}

/** Criteria 1-3 on one editor. */
async function expectListFollowsFocus(page: Page, editor: Locator, typing: Typing): Promise<void> {
  const lists = page.locator(LIST)
  await test.step('typing in the focused field opens the list', async () => {
    await retype(page, editor, typing.first)
    await expect(lists).toHaveCount(1, { timeout: typing.firstListTimeout ?? 5_000 })
  })
  await test.step('leaving the field closes the open list', async () => {
    await editor.blur()
    await expect(lists).toHaveCount(0)
  })
  await test.step('typing and leaving the field at once opens no list', async () => {
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(typing.more)
    await editor.blur()
    // Nothing to wait for: the list must not appear once its delay has passed.
    await page.waitForTimeout(LIST_DELAY_MS)
    await expect(lists).toHaveCount(0)
  })
}

/** Typing the start of a name offers the variables in scope, `t_src` among them. */
async function expectOffersInScope(page: Page, editor: Locator): Promise<void> {
  await retype(page, editor, NAME_TYPING.first)
  await expect(page.locator(LIST).getByRole('option').filter({ hasText: 't_src' }).first()).toBeVisible()
  await editor.blur()
  await expect(page.locator(LIST)).toHaveCount(0)
}

/** Ctrl/Cmd+E in the field opens the full expression editor. */
async function expectFullEditorShortcut(page: Page, editor: Locator): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.locator('[data-testid="expression-editor-modal"]')).toBeVisible()
}

test.describe('V-VARPICK-SUGGEST-FOCUS: the suggestion list follows focus', () => {
  let testId = ''
  let testName = ''

  test.beforeEach(async ({ page, request }) => {
    testName = uniqueName('v-varpick-suggest-focus')
    testId = await createValidTest(request, { name: testName, nodes: [] })
    await openTest(page, testId)
    await createSimpleVariable(page, 't_src', { value: 'a' })
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('a block setting expression', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, 'log'))
    await exprToggle(sheet, 'message').click()
    await expectListFollowsFocus(page, sheet.locator('[data-testid="param-input-message"] .cm-content'), NAME_TYPING)
  })

  test('a check row expression', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, 'assert'))
    await addExpressionRow(sheet)
    await expectListFollowsFocus(page, sheet.locator('[data-testid="assert-expression-input-0"] .cm-content'), NAME_TYPING)
  })

  test('a table filter expression row', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, { term: 'csv', testId: 'palette-item-csv-parser' }))
    const block = await addFilterBlock(page, sheet, 'id', 'string')
    await block.locator('[data-testid^="filter-add-expression-"]').click()
    await expectListFollowsFocus(page, block.locator('.cm-content').last(), NAME_TYPING)
  })

  test('a Function Block input binding', async ({ page }) => {
    const fnId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
    await digIn(page, fnId)
    await createFunctionParam(page, 'input', 'who')
    await popToBreadcrumbSegment(page, testName)
    await expect(page.locator(`[data-testid="workflow-node-${fnId}"]`)).toBeVisible({ timeout: 15_000 })
    const sheet = await openBlockSheet(page, fnId)
    await exprToggle(sheet, 'who').click()
    await expectListFollowsFocus(page, sheet.locator('[data-testid="param-input-who"] .cm-content'), NAME_TYPING)
  })

  test('the create window, Expression kind', async ({ page }) => {
    await openCreateModal(page)
    await setCreateName(page, 't_calc')
    await setCreateKind(page, 'Expression')
    await expectListFollowsFocus(page, valueEditor(page), NAME_TYPING)
  })

  test('the create window, Template kind', async ({ page }) => {
    await openCreateModal(page)
    await setCreateName(page, 't_tpl')
    await setCreateKind(page, 'Template')
    await expectListFollowsFocus(page, valueEditor(page), TEMPLATE_TYPING)
  })

  test('the variable window in Edit, Expression source', async ({ page }) => {
    await createComputedVariable(page, 't_calc', 'Expression', "t_src + '!'")
    const win = await openEditWindow(page, 't_calc')
    await expectOffersInScope(page, valueEditor(page, win))
    await expectListFollowsFocus(page, valueEditor(page, win), NAME_TYPING)
    await expectFullEditorShortcut(page, valueEditor(page, win))
  })

  test('the variable window in Edit, Template source', async ({ page }) => {
    await createComputedVariable(page, 't_tpl', 'Template', 'hi {{ t_src }}')
    const win = await openEditWindow(page, 't_tpl')
    await expectListFollowsFocus(page, valueEditor(page, win), TEMPLATE_TYPING)
    await expectFullEditorShortcut(page, valueEditor(page, win))
  })

  test("a setting's Edit value sheet, Template kind", async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, 'log'))
    const editor = await openStringParamSheet(sheet, page, 'message')
    await editor.locator('[data-testid="kind-dropdown"]').click()
    await page.getByRole('option', { name: 'Template', exact: true }).click()
    await expectListFollowsFocus(page, editor.locator('.cm-content').first(), TEMPLATE_TYPING)
  })

  test('the full expression editor', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, 'log'))
    await exprToggle(sheet, 'message').click()
    await sheet.locator('[data-testid="param-input-message"] .cm-content').click()
    await page.keyboard.press('ControlOrMeta+e')
    const modal = page.locator('[data-testid="expression-editor-modal"]')
    await expect(modal).toBeVisible()
    await expectListFollowsFocus(page, modal.locator('.cm-content').first(), NAME_TYPING)
  })

  test('a Python script body', async ({ page }) => {
    const sheet = await openBlockSheet(page, await dropBelowStart(page, { term: 'python', testId: 'palette-item-python' }))
    await sheet.getByTestId('param-expand-script').click()
    const editor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expectListFollowsFocus(page, editor.locator('.cm-content').first(), {
      first: 'import o',
      more: 'p',
      firstListTimeout: 30_000,
    })
  })
})
