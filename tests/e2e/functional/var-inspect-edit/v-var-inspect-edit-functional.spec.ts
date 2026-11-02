/**
 * V-VMGR-06-EDIT: editing Test variables in the one window (functional)
 * Design Decisions: VMGR-106, VMGR-108, VMGR-110
 * REQ: REQ-3.1.3.11 (Variable watching UI panel), REQ-3.1.3.13 (Computed variables with expressions)
 *
 * Phase: functional-workflow (imports its own fixture via POST /tests, validated with zero errors).
 *
 * Pass Criteria:
 * 1. The row pencil opens a window titled `Edit variable` showing the saved Name, Type, Kind and value
 *    on the Initial view; the watcher only shows values and has no Edit.
 * 2. A scalar edit: Save closes the window and the row shows the new value.
 * 3. A list edited in the "Edit value" Visual view comes back to the window's field; Save keeps it.
 * 4. Invalid JSON in the window's field shows the strip and disables Save; in the "Edit value" Code view
 *    it shows the strip and disables Save and the Visual view; valid JSON clears both.
 * 5. An expression source that reads itself shows
 *    `Circular reference detected for variable 'derived': derived -> derived` with Save disabled; a
 *    fixed source saves.
 * 6. An empty name shows `Name is required` with Save disabled; a valid rename saves and renames the row.
 * 7. After the Test save and a reload each saved value is still there.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import { valueEditorSheet } from '../../helpers/param-config'
import {
  cancelWindow,
  closeValueEditor,
  expandVariableManager,
  expectWindowValue,
  openEditWindow,
  openValueEditor,
  renameInWindow,
  renameNotice,
  replaceValueEditorCode,
  saveValueEditor,
  saveWindow,
  setValueEditorView,
  setWindowValue,
  valueSwitch,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'
import { saveTest } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')

test.describe('V-VMGR-06-EDIT: editing in the one window', () => {
  test('scalar, list and expression edits, the JSON and cycle gates, a rename, and a reload', async ({ page }) => {
    test.setTimeout(150_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    await test.step('VMGR-106: the watcher only shows values; it has no Edit', async () => {
      const row = variableRow(page, 'count')
      await row.hover()
      await row.locator('[data-testid^="expand-button-"]').click()
      const watcher = page.locator('section[aria-label="Inspect variable count"]')
      await expect(watcher).toBeVisible()
      await expect(watcher.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
      await expect(watcher.locator('[data-testid="inspect-edit-button"]')).toHaveCount(0)
      await watcher.locator('[aria-label="Close inspector for count"]').click()
      await expect(watcher).toHaveCount(0)
    })

    await test.step('VMGR-106: the pencil opens Edit variable on the saved definition; a scalar edit saves', async () => {
      const win = await openEditWindow(page, 'count')
      await expect(win).toHaveAttribute('aria-label', 'Edit variable')
      await expect(win.getByTestId('create-type-select')).toHaveText(/^Integer/)
      await expect(win.getByTestId('create-kind-select')).toHaveText('Literal')
      await expect(valueSwitch(win)).toHaveText('Initial')
      await expectWindowValue(win, '3')
      await setWindowValue(page, win, 7)
      await saveWindow(page, win)
      await expect(rowValue(page, 'count')).toHaveText('7')
    })

    await test.step('VMGR-110: a list edited in the "Edit value" Visual view saves', async () => {
      const win = await openEditWindow(page, 'colors')
      await expectWindowValue(win, '["red", "green", "blue"]')
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Visual')
      await sheet.locator('[data-testid="array-edit-input-0"]').fill('crimson')
      await saveValueEditor(sheet)
      await closeValueEditor(page, sheet)
      await expectWindowValue(win, '["crimson", "green", "blue"]')
      await saveWindow(page, win)
      await expect(rowValue(page, 'colors')).toHaveText('[3 items]')
    })

    await test.step('VMGR-110: invalid JSON holds Save in the window and in the "Edit value" Code view', async () => {
      const win = await openEditWindow(page, 'colors')
      const strip = win.getByTestId('create-validation')
      await setWindowValue(page, win, '["red", "green"')
      await expect(strip).toBeVisible()
      await expect(windowSaveButton(win)).toBeDisabled()
      await setWindowValue(page, win, '["red", "green"]')
      await expect(strip).toHaveCount(0)
      await expect(windowSaveButton(win)).toBeEnabled()

      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Code')
      await replaceValueEditorCode(page, sheet, '[ this is not json')
      // The strip shows the parser's own message, e.g. "Unexpected token 'h', ... is not valid JSON".
      await expect(sheet.getByTestId('value-editor-validation')).toContainText(/valid JSON/)
      await expect(sheet.getByTestId('value-editor-save-button')).toBeDisabled()
      await sheet.getByTestId('view-dropdown').click()
      await expect(page.getByRole('option', { name: 'Visual', exact: true })).toHaveAttribute('aria-disabled', 'true')
      await page.keyboard.press('Escape')
      await expect(valueEditorSheet(page)).toBeVisible()
      await replaceValueEditorCode(page, sheet, '["red","green","teal"]')
      await expect(sheet.getByTestId('value-editor-validation')).toHaveCount(0)
      await expect(sheet.getByTestId('value-editor-save-button')).toBeEnabled()
      await closeValueEditor(page, sheet, 'Close')
      await cancelWindow(page, win, 'Close')
      await expect(rowValue(page, 'colors')).toHaveText('[3 items]')
    })

    await test.step('REQ-3.1.3.13: an expression that reads itself holds Save until it is fixed', async () => {
      const win = await openEditWindow(page, 'derived')
      await expect(win.getByTestId('create-kind-select')).toHaveText('Expression')
      await expectWindowValue(win, "'svc-' + base")
      await setWindowValue(page, win, "derived + '!'")
      await expect(win.getByTestId('create-cycle-error')).toHaveText(
        "Circular reference detected for variable 'derived': derived -> derived",
      )
      await expect(windowSaveButton(win)).toBeDisabled()
      await setWindowValue(page, win, "'ok-done'")
      await expect(win.getByTestId('create-cycle-error')).toHaveCount(0)
      await saveWindow(page, win)
      await expect(rowValue(page, 'derived')).toHaveText("'ok-done'")
    })

    await test.step('VMGR-106: an empty name holds Save; a valid rename saves', async () => {
      const win = await openEditWindow(page, 'base')
      await renameInWindow(win, '')
      await expect(win.getByTestId('create-name-error')).toHaveText('Name is required')
      await expect(windowSaveButton(win)).toBeDisabled()
      await renameInWindow(win, 'account')
      await expect(win.getByTestId('create-name-error')).toHaveCount(0)
      await expect(renameNotice(win)).toHaveText('Renaming updates all references to base across the test.')
      await saveWindow(page, win)
      await expect(variableRow(page, 'account')).toBeVisible()
      await expect(variableRow(page, 'base')).toHaveCount(0)
    })

    await test.step('after the Test save and a reload each saved value is still there', async () => {
      await saveTest(page)
      await openTest(page, testId)
      await expandVariableManager(page)
      await expect(rowValue(page, 'count')).toHaveText('7')
      await expect(rowValue(page, 'account')).toHaveText('wave')
      await expect(rowValue(page, 'derived')).toHaveText("'ok-done'")
      const win = await openEditWindow(page, 'colors')
      await expectWindowValue(win, '["crimson", "green", "blue"]')
      await cancelWindow(page, win)
    })
  })
})
