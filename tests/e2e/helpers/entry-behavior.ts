/**
 * Entry editor behavior (FIELD-6, FIELD-7, FIELD-13): the type change and {x} switch questions an entry asks,
 * the text of an entry's {x} box, the unsaved-secret line, and the saves a behavior spec reads back.
 */

import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { leaveExpressionEditor } from './code-editor'
import { BACKEND_URL } from './config'
import { paramRow } from './config-sheet'
import { valueField } from './variable-create'
import type { LogEntry } from './log-reader'
import { runToEnd, saveBlockSheet, saveTest, selectEnvironment } from './workbench'

export const SECRET_LINE_TEST = 'Secret value stays visible until you save the test.'
export const SECRET_LINE_FUNCTION = 'Secret value stays visible until you save the Function.'
export const NESTED_LIMIT_NOTE = 'Up to 10 nested levels'
export const SWITCH_IN_TITLE = 'Switch the field to an expression?'
export const SWITCH_OUT_TITLE = 'Switch the field to a plain value?'
export const SWITCH_BODY = 'The current value is cleared.'

export type EntryType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map'

/** The six types a list item or map entry picks from, in picker order. */
export const SIX_TYPES: readonly EntryType[] = ['string', 'integer', 'float', 'boolean', 'array', 'map']

/** What a type change question names in its title. */
export type TypeChangeSubject = 'entry' | 'item' | 'variable'

/** The sentence a type change question asks with (`clears` is e.g. `1 existing string value`). */
export function typeChangeSentence(next: string, clears: string): string {
  return `Changing type to ${next} will clear ${clears}. This cannot be undone.`
}

/** The open `Change <subject> type?` question. */
export function typeChangeQuestion(page: Page, subject: TypeChangeSubject): Locator {
  return page.getByRole('alertdialog').filter({ hasText: `Change ${subject} type?` })
}

/** The type change question is open with its exact title, sentence and buttons. */
export async function expectTypeChangeQuestion(
  page: Page,
  subject: TypeChangeSubject,
  sentence: string,
): Promise<Locator> {
  const dialog = typeChangeQuestion(page, subject)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText(`Change ${subject} type?`)
  await expect(dialog.getByText(sentence, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Change type'])
  return dialog
}

/** Answer the open type change question and wait for it to close. */
export async function answerTypeChange(dialog: Locator, answer: 'Cancel' | 'Change type'): Promise<void> {
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Pick `type` on an entry's Type picker; a question it asks is left open for the caller. */
export async function pickEntryType(page: Page, picker: Locator, type: EntryType): Promise<void> {
  await picker.click()
  await page.getByRole('option', { name: type, exact: true }).click()
}

/** Pick `type` on a picker that asks nothing, and see it take the type at once. */
export async function pickEntryTypeAtOnce(page: Page, picker: Locator, type: EntryType): Promise<void> {
  await pickEntryType(page, picker, type)
  await expect(page.getByRole('alertdialog'), `the pick of ${type} asks nothing`).toHaveCount(0)
  await expect(picker).toHaveText(type)
}

/** The type names a picker offers, read from its open list; the list is closed on the type it shows. */
export async function typeOptions(page: Page, picker: Locator): Promise<string[]> {
  const shown = ((await picker.textContent()) ?? '').trim()
  await picker.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const names = (await listbox.getByRole('option').allTextContents()).map((name) => name.trim())
  // Escape would also reach the sheet around the picker, so the list closes on the type it already shows.
  await listbox.getByRole('option', { name: shown, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(picker).toHaveText(shown)
  return names
}

/** The one FIELD-7 switch question. */
export function switchQuestion(page: Page): Locator {
  return page.locator('[data-testid="switch-mode-dialog"]')
}

/** The switch question is open going `in` to {x} or `out` of it, with exactly `buttons`. */
export async function expectSwitchQuestion(
  page: Page,
  direction: 'in' | 'out',
  buttons: readonly string[],
): Promise<Locator> {
  const dialog = switchQuestion(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText(direction === 'in' ? SWITCH_IN_TITLE : SWITCH_OUT_TITLE)
  await expect(dialog.getByText(SWITCH_BODY, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button')).toHaveText([...buttons])
  return dialog
}

/** Answer the open switch question and wait for it to close. */
export async function answerSwitch(dialog: Locator, answer: 'Cancel' | 'Clear' | 'Clear & Empty'): Promise<void> {
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Press an entry's {x} when it holds nothing: it switches at once, asking nothing. */
export async function switchAtOnce(page: Page, toggle: Locator, pressed: boolean): Promise<void> {
  await toggle.click()
  await expect(switchQuestion(page), 'an entry with no value switches at once').toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-pressed', String(pressed))
}

/** The text of the code editor inside `scope`, its placeholder left out. */
export function codeText(scope: Locator): Promise<string> {
  return scope
    .locator('.cm-content')
    .first()
    .evaluate((el) => {
      const lines = Array.from(el.querySelectorAll('.cm-line'))
      return lines
        .map((line) => {
          const copy = line.cloneNode(true) as HTMLElement
          copy.querySelectorAll('.cm-placeholder').forEach((hint) => hint.remove())
          return copy.textContent ?? ''
        })
        .join('\n')
    })
}

/** The code editor inside `scope` holds exactly `text`. */
export async function expectCodeText(scope: Locator, text: string, what: string): Promise<void> {
  await expect.poll(() => codeText(scope), { message: what }).toBe(text)
}

/** Replace the text of the code editor inside `scope` in one input, then leave it. */
export async function writeCode(page: Page, scope: Locator, text: string): Promise<void> {
  const editor = scope.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expectCodeText(scope, text, `the editor holds ${text}`)
  await leaveExpressionEditor(editor)
}

/** The expression editor an {x} entry's expand opens (`Edit <entry> value`). */
export function expressionEditorModal(page: Page): Locator {
  return page.locator('[data-testid="expression-editor-modal"]')
}

/** Write `text` in the open expression editor and Apply it. */
export async function applyInExpressionEditor(page: Page, modal: Locator, text: string): Promise<void> {
  const editor = modal.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expectCodeText(modal, text, `the expression editor holds ${text}`)
  await leaveExpressionEditor(editor)
  await modal.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(modal).toHaveCount(0)
}

/** A Block row's one-line text box. */
export function rowTextBox(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).locator('input[type="text"]').first()
}

/** A Block row's amber line under the field. */
export function rowNote(sheet: Locator, name: string): Locator {
  return sheet.locator(`[data-testid="param-warning-${name}"]`)
}

/** The note is drawn in the amber warning color (`text-warning`), read from a probe beside it. */
export async function expectWarningColor(note: Locator): Promise<void> {
  const colors = await note.evaluate((el) => {
    const probe = document.createElement('span')
    probe.className = 'text-warning'
    ;(el.parentElement ?? document.body).appendChild(probe)
    const warning = getComputedStyle(probe).color
    probe.remove()
    return { note: getComputedStyle(el).color, warning }
  })
  expect(colors.note, 'the note uses the amber warning color').toBe(colors.warning)
}

/** A masked secret's control in a Block row. */
export function maskedControl(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).getByRole('button', { name: 'Edit protected value', exact: true })
}

/** `control` names `note` among the ids of its aria-describedby. */
export async function expectDescribedBy(control: Locator, note: Locator): Promise<void> {
  const id = await note.getAttribute('id')
  expect(id, 'the note has an id').toBeTruthy()
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/)
  expect(ids, 'the field is described by the note').toContain(id)
}

/** Click a masked secret and answer `Edit Protected Value?` with Delete & Edit. */
export async function deleteAndEdit(page: Page, masked: Locator): Promise<void> {
  await masked.click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

/** Whether the focused element is a text box inside `scope`. */
export function focusedTextBoxInside(scope: Locator): Promise<boolean> {
  return scope.evaluate((el) => {
    const active = el.ownerDocument.activeElement
    return active instanceof HTMLInputElement && active.type === 'text' && el.contains(active)
  })
}

/** The one-line text box of a variable window's value field. */
export function windowLine(win: Locator): Locator {
  return valueField(win).locator('input:not([data-testid])')
}

/** Save the Block window, then the Test from the toolbar. */
export async function saveBlockAndTest(page: Page, sheet: Locator): Promise<void> {
  await saveBlockSheet(sheet)
  await saveTest(page)
}

/** Pick the E2E environment and run the Test to its end; returns the verdict and the console entries. */
export async function runTest(page: Page): Promise<{ verdict: string | null; entries: LogEntry[] }> {
  await selectEnvironment(page)
  return runToEnd(page)
}

/** A stored node of the Test, read back through GET /tests/{id}. */
export async function storedNode(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
  const node = nodes.find((entry) => entry.id === nodeId)
  expect(node, `node ${nodeId} is stored`).toBeTruthy()
  return node as Record<string, any>
}

/** A stored List or Map entry read as its structure, whether it is kept as JSON text or as the structure. */
export function structureOf(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** Open the Edit mode of the library Function View that is shown. */
export async function enterFunctionEditMode(page: Page): Promise<void> {
  await page.locator('[data-testid="action-bar-edit-function-button"]').click()
  await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
}

/** Delete a library Function; cascade, so another Function naming it never blocks the delete. */
export async function deleteLibraryFunction(request: APIRequestContext, functionId: string): Promise<void> {
  const resp = await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`)
  expect(resp.ok() || resp.status() === 404, `DELETE /functions/${functionId}: ${resp.status()}`).toBeTruthy()
}
