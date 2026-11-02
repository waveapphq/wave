/** Shared helpers for the script "Edit value" sheet (Python and SQL modes). */

import { expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { valueEditorSheet } from '../../helpers/param-config'

export function runButton(sheet: Locator): Locator {
  return sheet.getByTestId('value-editor-run-button')
}

export function stopButton(sheet: Locator): Locator {
  return sheet.getByTestId('value-editor-stop-button')
}

export function saveButton(sheet: Locator): Locator {
  return sheet.getByTestId('value-editor-save-button')
}

export function workflowStatus(page: Page): Locator {
  return page.getByTestId('workflow-status')
}

/** The SQL editor footer's Get Tables chip (SQL-12). */
export function tablesChip(sheet: Locator): Locator {
  return sheet.getByTestId('get-tables-chip')
}

/** The label the Get Tables chip shows in its current state. */
export function tablesChipStatus(sheet: Locator): Locator {
  return tablesChip(sheet).getByTestId('get-tables-status')
}

/** The Tables popover the settled chip opens. */
export function tablesPopover(page: Page): Locator {
  return page.getByTestId('tables-popover')
}

/** Open a script body's "Edit value" sheet from an open config sheet; it opens idle, on Run. */
export async function openScriptSheet(
  page: Page,
  dialog: Locator,
  param = 'script',
): Promise<Locator> {
  await dialog.getByTestId(`param-expand-${param}`).click()
  const sheet = valueEditorSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await expect(runButton(sheet), 'the script sheet carries Run').toBeVisible()
  return sheet
}

/** Replace the whole script by typing it and assert the editor holds exactly it. */
export async function typeScript(page: Page, sheet: Locator, script: string): Promise<void> {
  const editor = sheet.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type(script)
  await expect(editor).toHaveText(script)
  await leaveExpressionEditor(sheet)
}

/** Close the script sheet, discarding whatever the step left unsaved. */
export async function closeScriptSheet(page: Page, sheet: Locator): Promise<void> {
  await leaveExpressionEditor(sheet)
  await sheet.getByTestId('value-editor-cancel-button').click()
  const unsaved = page.getByTestId('value-editor-unsaved-dialog')
  if (await unsaved.isVisible().catch(() => false)) {
    await page.getByTestId('value-editor-unsaved-discard-button').click()
  }
  await expect(sheet).toBeHidden({ timeout: 10_000 })
}

/** Close the config sheet, discarding whatever the step left unsaved. */
export async function closeConfigSheet(page: Page, dialog: Locator): Promise<void> {
  // A read-only sheet, as a run in flight makes it, says Close where an editable one says Cancel.
  await dialog.getByRole('button', { name: /^(Cancel|Close)$/ }).last().click()
  const unsaved = page.getByTestId('unsaved-changes-dialog')
  if (await unsaved.isVisible().catch(() => false)) {
    await page.getByTestId('unsaved-close').click()
  }
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/** While the editor's own run is in flight (SQL-13, PYRUN-21): Stop, F1 Help, a dead Save on a changed draft, a read-only config. */
export async function expectEditorWhileRunning(
  page: Page,
  dialog: Locator,
  sheet: Locator,
  mode: 'python' | 'sql',
): Promise<void> {
  await expect(stopButton(sheet), 'Stop stands where Run was').toBeEnabled()
  await expect(runButton(sheet), 'Run is gone while its own run is in flight').toHaveCount(0)
  await expect(sheet.getByTestId('value-editor-run-spinner')).toBeVisible()

  const help = page.getByTestId(`${mode}-help-popover`)
  await sheet.getByTestId('value-editor-help-chip').click()
  await expect(help, 'F1 Help opens during the run').toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden({ timeout: 10_000 })
  await expect(sheet, 'Escape shut the help, not the editor').toBeVisible()

  await expect(saveButton(sheet), 'Save refuses a changed draft while the run is in flight').toBeDisabled()

  await expect(dialog.getByTestId('element-config-read-only-pill')).toBeVisible()
  await expect(dialog.getByTestId('element-name-input'), 'the config behind is frozen').toBeDisabled()
  await expect(dialog.getByRole('button', { name: /^Save$/ })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^Close$/ }).last()).toBeVisible()
}

/** Close the editor mid-run: the unsaved prompt's Save is dead too, and discarding leaves the run going. */
export async function closeEditorWhileRunning(page: Page, sheet: Locator): Promise<void> {
  await leaveExpressionEditor(sheet)
  const close = sheet.getByTestId('value-editor-cancel-button')
  await expect(close, 'Close stays usable during the run').toBeEnabled()
  await close.click()
  await expect(page.getByTestId('value-editor-unsaved-dialog')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('value-editor-unsaved-save-button')).toBeDisabled()
  await page.getByTestId('value-editor-unsaved-discard-button').click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  await expect(workflowStatus(page), 'closing the editor leaves the run going').toHaveAttribute(
    'data-status',
    'running',
  )
}

/** End a run from the canvas toolbar with Stop Immediately. */
export async function stopRunFromToolbar(page: Page): Promise<void> {
  await page.getByTestId('action-stop-button').click()
  await expect(page.getByTestId('stop-confirmation-dialog')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('stop-confirm-immediate').click()
  await expect(workflowStatus(page)).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 })
}
