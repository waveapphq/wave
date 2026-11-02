/** The one variable window (VMGR-106): Add and Edit of a Test variable, a Function local, an input and an output. */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { leaveExpressionEditor } from './code-editor'
import { valueEditorSheet } from './param-config'

export const CREATE_MODAL = '[data-testid="variable-create-modal"]'
export const EDIT_WINDOW = `${CREATE_MODAL}[data-window-mode="edit"]`

const NAME_FIELD = '[data-testid="create-variable-name"]'

/** A create window by its place in opening order, or its locator; omitted, the one open window. */
export type CreateWindowRef = number | Locator

/** The create modal root (variable / input / output mode); `which` picks one of several open windows (VMGR-101). */
export function createModal(page: Page, which?: CreateWindowRef): Locator {
  if (which === undefined) return page.locator(CREATE_MODAL)
  return typeof which === 'number' ? page.locator(CREATE_MODAL).nth(which) : which
}

/** The create window opened last. */
export function latestCreateModal(page: Page): Locator {
  return page.locator(CREATE_MODAL).last()
}

/** The window holding the Name field with this id; it stays that window whatever else opens or closes. */
function windowByNameId(page: Page, id: string): Locator {
  return page.locator(CREATE_MODAL).filter({ has: page.locator(`[id="${id}"]`) })
}

async function pinWindow(page: Page, win: Locator): Promise<Locator> {
  const id = await win.locator(NAME_FIELD).getAttribute('id')
  expect(id, 'the window Name field has an id').toBeTruthy()
  return windowByNameId(page, id as string)
}

/** Run an Add action and return the window it opened, pinned to it. */
async function openNewWindow(page: Page, open: () => Promise<void>): Promise<Locator> {
  const windows = page.locator(CREATE_MODAL)
  const before = await windows.count()
  await open()
  await expect(windows).toHaveCount(before + 1)
  const modal = windows.nth(before)
  await expect(modal).toBeVisible()
  return pinWindow(page, modal)
}

/** A variable row in the panel, addressed by name. */
export function variableRow(page: Page, name: string): Locator {
  return page
    .locator('[data-testid="variable-manager-content"]')
    .locator(`[aria-label="Variable ${name}"]`)
}

/** The row pencil that opens the variable's Edit window. */
export function editPencil(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="edit-button-"]')
}

/** Expand the Variable Manager panel if it is collapsed. Idempotent. */
export async function expandVariableManager(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="variable-manager"]')
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

/** Open the root "+ Add" create modal (variable mode); returns the new window even when others are open. */
export async function openCreateModal(page: Page): Promise<Locator> {
  await expandVariableManager(page)
  return openNewWindow(page, () => page.locator('[data-testid="add-variable-button"]').click())
}

/** Open the in-Function "+ Add" dropdown and pick input / output / variable; returns the new window. */
export async function openFunctionCreateModal(
  page: Page,
  mode: 'input' | 'output' | 'variable',
): Promise<Locator> {
  await expandVariableManager(page)
  const label =
    mode === 'input' ? 'Input parameter' : mode === 'output' ? 'Output parameter' : 'Variable'
  const trigger = page.locator('[data-testid="add-variable-dropdown-trigger"]')
  const item = page.getByRole('menuitem', { name: label, exact: true })
  return openNewWindow(page, async () => {
    // A just-closed window can swallow the first trigger click before the menu mounts.
    await expect(async () => {
      if (!(await item.isVisible())) await trigger.click()
      await item.click({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  })
}

export async function setCreateName(page: Page, name: string, which?: CreateWindowRef): Promise<void> {
  await createModal(page, which).locator(NAME_FIELD).fill(name)
}

/** Pick a Type via the shadcn Select (labels are capitalized: String, Integer...). */
export async function setCreateType(page: Page, type: string, which?: CreateWindowRef): Promise<void> {
  await createModal(page, which).locator('[data-testid="create-type-select"]').click()
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  await page.getByRole('option', { name: new RegExp(`^${label}`) }).click()
}

/** Pick a Kind (variable mode only): Literal / Expression / Template. */
export async function setCreateKind(
  page: Page,
  kind: 'Literal' | 'Expression' | 'Template',
  which?: CreateWindowRef,
): Promise<void> {
  await createModal(page, which).locator('[data-testid="create-kind-select"]').click()
  await page.getByRole('option', { name: kind, exact: true }).click()
}

/** The value field of a window, or its Allowed values field. */
export function valueField(win: Locator, field: 'value' | 'allowed-values' = 'value'): Locator {
  return win.locator(`[data-testid="${field === 'value' ? 'window-value-field' : 'allowed-values-field'}"]`)
}

/** The one-line text box of a String, list, map or table field. */
function lineInput(win: Locator, field: 'value' | 'allowed-values' = 'value'): Locator {
  return valueField(win, field).locator('input:not([data-testid])')
}

type Face = 'null' | 'masked' | 'source' | 'enum' | 'boolean' | 'number' | 'line'

const FACE_PARTS = 'input, button, .cm-content, [data-testid="create-null-field"], [data-testid="enum-value-select"]'

/** Which field the value shows, once it has rendered. */
async function shownFace(win: Locator): Promise<Face> {
  const field = valueField(win)
  // An expression editor mounts its content after the field itself.
  await expect(field.locator(FACE_PARTS).first()).toBeVisible()
  const has = async (selector: string) => (await field.locator(selector).count()) > 0
  if (await has('[data-testid="create-null-field"]')) return 'null'
  if ((await field.getByRole('button', { name: /Edit protected value$/ }).count()) > 0) return 'masked'
  if (await has('.cm-content')) return 'source'
  if (await has('[data-testid="enum-value-select"]')) return 'enum'
  if (await has('[data-testid="scalar-edit-bool-true"]')) return 'boolean'
  if (await has('[data-testid="scalar-edit-input"]')) return 'number'
  return 'line'
}

/** The value's editable element: the one-line box (a Literal, a number) or the Expression / Template code editor. */
export function valueEditor(page: Page, which?: CreateWindowRef): Locator {
  const field = valueField(createModal(page, which))
  return field.locator('.cm-content').or(field.locator('input[type="text"]')).first()
}

/** Paste `text` into a code editor in one input, so no suggestion list opens and no pairing applies. */
async function pasteCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await editor.evaluate((el, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
  await expect(editor).toHaveText(text)
}

/** Type an Expression / Template source key by key, or enter any other value through its field (`setWindowValue`). */
export async function typeStringValue(page: Page, text: string, which?: CreateWindowRef): Promise<void> {
  const win = createModal(page, which)
  if ((await shownFace(win)) !== 'source') {
    await setWindowValue(page, win, text)
    return
  }
  await valueField(win).locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.type(text)
}

/** Fill the integer / float scalar value input. */
export async function setNumericValue(page: Page, text: string, which?: CreateWindowRef): Promise<void> {
  await createModal(page, which).locator('[data-testid="scalar-edit-input"]').fill(text)
}

export async function submitCreate(page: Page, which?: CreateWindowRef): Promise<void> {
  await createModal(page, which).locator('[data-testid="create-submit-button"]').click()
}

/** The window's footer Save (Edit) / Create (Add) button. */
export function windowSaveButton(win: Locator): Locator {
  return win.locator('[data-testid="create-submit-button"]')
}

export function windowCancelButton(win: Locator): Locator {
  return win.locator('[data-testid="create-cancel-button"]')
}

/** The Keep Editing / Close / Save question a window with a change asks on Cancel. */
export function closeQuestion(page: Page): Locator {
  return page.locator('[data-testid="unsaved-changes-dialog"]')
}

const CLOSE_ANSWER_IDS = {
  'Keep Editing': 'unsaved-keep-editing',
  Close: 'unsaved-close',
  Save: 'unsaved-save',
} as const

export type CloseAnswer = keyof typeof CLOSE_ANSWER_IDS

/** Cancel a window; when it asks about its change, Close it; waits for that window to close. */
export async function cancelCreate(page: Page, which?: CreateWindowRef): Promise<void> {
  const win = which === undefined ? createModal(page) : await pinWindow(page, createModal(page, which))
  await windowCancelButton(win).click()
  const question = closeQuestion(page)
  await expect(async () => {
    if (await question.isVisible()) return
    await expect(win).toBeHidden({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
  if (await question.isVisible()) {
    await question.locator(`[data-testid="${CLOSE_ANSWER_IDS.Close}"]`).click()
    await expect(question).toBeHidden()
  }
  await expect(win).toBeHidden()
}

/** Cancel a window: with no answer it must close at once; with one, the close question is answered. */
export async function cancelWindow(page: Page, which: CreateWindowRef, answer?: CloseAnswer): Promise<void> {
  const win = await pinWindow(page, createModal(page, which))
  await windowCancelButton(win).click()
  const question = closeQuestion(page)
  if (answer === undefined) {
    await expect(win, 'a window with no change closes at once').toBeHidden()
    await expect(question).toHaveCount(0)
    return
  }
  await expect(question, 'the window asks about its change').toBeVisible()
  await question.locator(`[data-testid="${CLOSE_ANSWER_IDS[answer]}"]`).click()
  await expect(question).toBeHidden()
  if (answer === 'Keep Editing') await expect(win).toBeVisible()
  else await expect(win).toBeHidden({ timeout: 15_000 })
}

/** The Set to null checkbox of a create window (VMGR-97). */
export function setToNullCheckbox(page: Page, which?: CreateWindowRef): Locator {
  return createModal(page, which).locator('[data-testid="create-set-to-null-checkbox"]')
}

/** The one `null` field a ticked Set to null shows in place of the value (VMGR-97). */
export function createNullField(page: Page, which?: CreateWindowRef): Locator {
  return createModal(page, which).locator('[data-testid="create-null-field"]')
}

/** Tick Set to null in a create window and wait for its `null` field. */
export async function setToNull(page: Page, which?: CreateWindowRef): Promise<void> {
  const box = setToNullCheckbox(page, which)
  await box.click()
  await expect(box).toBeChecked()
  await expect(createNullField(page, which)).toBeVisible()
}

export interface CreateVariableOptions {
  type?: string
  kind?: 'Literal' | 'Expression' | 'Template'
  /** Entered per face: number box, true / false, one-line text, list / map / table JSON (Code view), source, enum pick. */
  value?: string
  secret?: boolean
}

/** Replace an Expression / Template source in one input, or enter any other value through its field (`setWindowValue`). */
export async function insertCodeValue(page: Page, text: string, which?: CreateWindowRef): Promise<void> {
  const win = createModal(page, which)
  if ((await shownFace(win)) !== 'source') {
    await setWindowValue(page, win, text)
    return
  }
  const content = valueField(win).locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect(content).toHaveText(text)
}

/** Create a Function parameter or local variable through the in-Function "+ Add" menu and wait for its row. */
export async function createFunctionParam(
  page: Page,
  mode: 'input' | 'output' | 'variable',
  name: string,
  opts: CreateParamOptions = {},
): Promise<void> {
  const modal = await openFunctionCreateModal(page, mode)
  await fillCreateWindow(page, modal, name, opts)
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

export interface SimpleVariableOptions extends CreateVariableOptions {
  /** Tick Set to null last, so the variable is created holding null whatever else was set (VMGR-97). */
  setToNull?: boolean
}

/** Create a variable through the root Add window and wait for its row; the default is a String Literal. */
export async function createSimpleVariable(
  page: Page,
  name: string,
  opts: SimpleVariableOptions = {},
): Promise<void> {
  const modal = await openCreateModal(page)
  await fillCreateWindow(page, modal, name, opts)
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

const LIST_TYPES: ReadonlySet<string> = new Set(['array', 'map', 'table'])

/** Every control of the one window body a spec may set (VMGR-98). */
export interface CreateParamOptions extends CreateVariableOptions {
  /** Parameter windows only. */
  description?: string
  /** Input only. */
  required?: boolean
  /** Input of Type String / Integer / Float only: tick Create enum, then type the allowed values; `value` is the default picked. */
  createEnum?: boolean
  enumValues?: readonly string[]
  /** Ticked last, so the window holds null whatever else was set (VMGR-97). */
  setToNull?: boolean
}

type WindowBox = 'required' | 'secret' | 'set-to-null' | 'create-enum'

const BOX_TEST_IDS: Record<WindowBox, string> = {
  required: 'param-required-checkbox',
  secret: 'create-secret-checkbox',
  'set-to-null': 'create-set-to-null-checkbox',
  'create-enum': 'param-create-enum-checkbox',
}

/** One of the window's checkboxes. */
export function windowCheckbox(win: Locator, box: WindowBox): Locator {
  return win.locator(`[data-testid="${BOX_TEST_IDS[box]}"]`)
}

/** Click a checkbox when its state differs, then wait for the new state. */
export async function setWindowCheckbox(win: Locator, box: WindowBox, on: boolean): Promise<void> {
  const el = windowCheckbox(win, box)
  const want = on ? 'checked' : 'unchecked'
  if ((await el.getAttribute('data-state')) !== want) await el.click()
  await expect(el).toHaveAttribute('data-state', want)
}

/** Append one list item per value with Add item in the Allowed values editor and type it, as an author does. */
export async function fillAllowedValues(
  page: Page,
  values: readonly string[],
  which?: CreateWindowRef,
): Promise<void> {
  if (values.length === 0) return
  const sheet = await openValueEditor(page, createModal(page, which), 'allowed-values')
  const start = await sheet.locator('[data-testid^="array-edit-input-"]').count()
  for (const [offset, text] of values.entries()) {
    await sheet.locator('[data-testid="array-add-item"]').click()
    const item = sheet.locator(`[data-testid="array-edit-input-${start + offset}"]`)
    await expect(item).toBeVisible()
    await item.pressSequentially(text)
    await expect(item).toHaveValue(text)
  }
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
}

/** Fill the Allowed values one-line field with `text` exactly, e.g. `["low", "high"]`. */
export async function setAllowedValues(win: Locator, text: string): Promise<void> {
  const box = lineInput(win, 'allowed-values')
  await box.fill(text)
  await expect(box).toHaveValue(text)
}

/** Write a list, map or table value as JSON in the "Edit value" sheet's Code view, then Save and Close it. */
export async function insertCreateCode(page: Page, text: string, which?: CreateWindowRef): Promise<void> {
  await writeValueEditor(page, createModal(page, which), text)
}

/** Enter a value given as text through the face the window shows. */
async function enterValue(page: Page, win: Locator, text: string, type: string, literal: boolean): Promise<void> {
  if (literal && LIST_TYPES.has(type)) {
    await insertCreateCode(page, text, win)
    return
  }
  const face = await shownFace(win)
  if (face === 'source') {
    await insertCodeValue(page, text, win)
    await leaveExpressionEditor(win)
    return
  }
  await setWindowValue(page, win, text)
}

/** Fill one window without creating, scoped to it (VMGR-101). */
export async function fillCreateWindow(
  page: Page,
  which: CreateWindowRef,
  name: string,
  opts: CreateParamOptions = {},
): Promise<void> {
  const modal = createModal(page, which)
  await setCreateName(page, name, modal)
  if (opts.description !== undefined) {
    await modal.locator('[data-testid="param-description"]').fill(opts.description)
  }
  if (opts.type && opts.type !== 'string') await setCreateType(page, opts.type, modal)
  if (opts.kind && opts.kind !== 'Literal') await setCreateKind(page, opts.kind, modal)
  if (opts.required) await setWindowCheckbox(modal, 'required', true)
  if (opts.createEnum) {
    await setWindowCheckbox(modal, 'create-enum', true)
    if (opts.enumValues) await fillAllowedValues(page, opts.enumValues, modal)
  }
  if (opts.value !== undefined) {
    const literal = !opts.kind || opts.kind === 'Literal'
    await enterValue(page, modal, opts.value, opts.type ?? 'string', literal)
  }
  if (opts.secret) await setWindowCheckbox(modal, 'secret', true)
  if (opts.setToNull) await setToNull(page, modal)
}

/** The kind of each field block of a create window's form, top to bottom (VMGR-98). */
export type CreateFieldKind =
  | 'name'
  | 'description'
  | 'type'
  | 'type+kind'
  | 'required'
  | 'create-enum'
  | 'secret'
  | 'set-to-null'
  | 'allowed-values'
  | 'value'
  | 'other'

/** Read a create window's form blocks in DOM order, each named by the control it holds. */
export async function createWindowOrder(page: Page, which?: CreateWindowRef): Promise<CreateFieldKind[]> {
  const area = createModal(page, which).locator('[data-testid="create-value-area"]')
  return area.evaluate((valueArea) => {
    const form = valueArea.parentElement as HTMLElement
    const holds = (el: Element, id: string) =>
      el.getAttribute('data-testid') === id || el.querySelector(`[data-testid="${id}"]`) !== null
    return Array.from(form.children).map((el) => {
      if (holds(el, 'create-value-area')) return 'value'
      if (holds(el, 'allowed-values-field')) return 'allowed-values'
      if (holds(el, 'create-variable-name')) return 'name'
      if (holds(el, 'param-description')) return 'description'
      if (holds(el, 'create-type-select')) return holds(el, 'create-kind-select') ? 'type+kind' : 'type'
      if (holds(el, 'param-required-checkbox')) return 'required'
      if (holds(el, 'param-create-enum-checkbox')) return 'create-enum'
      if (holds(el, 'create-secret-checkbox')) return 'secret'
      if (holds(el, 'create-set-to-null-checkbox')) return 'set-to-null'
      return 'other'
    })
  }) as Promise<CreateFieldKind[]>
}

/** A Function input, output or local as the Test stores it (`name`, `type`, `default` / `value`, kind flags, `required`). */
export type StoredDeclaration = Record<string, unknown>

/** The window controls that make `decl`; a value the window already holds (its type default) is not typed. */
export function declarationOptions(
  mode: 'input' | 'output' | 'variable',
  decl: StoredDeclaration,
): CreateParamOptions {
  const source = mode === 'variable' ? decl.value : decl.default
  const opts: CreateParamOptions = { type: String(decl.type ?? 'string') }
  if (decl.isExpression) opts.kind = 'Expression'
  if (decl.isTemplate) opts.kind = 'Template'
  if (decl.required) opts.required = true
  if (Array.isArray(decl.enumValues)) {
    opts.createEnum = true
    opts.enumValues = decl.enumValues.map(String)
  }
  if (source === null) opts.setToNull = true
  else if (source === true) opts.value = 'true'
  else if (opts.kind || (typeof source === 'string' && source !== '') || typeof source === 'number') {
    opts.value = String(source)
  }
  return opts
}

/** Fill an open window with `decl`; a source is pasted, so no suggestion list opens and no Escape can close the window. */
export async function fillDeclaration(
  page: Page,
  modal: Locator,
  mode: 'input' | 'output' | 'variable',
  decl: StoredDeclaration,
): Promise<void> {
  const opts = declarationOptions(mode, decl)
  const source = opts.value !== undefined && opts.kind !== undefined
  await fillCreateWindow(page, modal, String(decl.name), source ? { ...opts, value: undefined } : opts)
  if (!source) return
  const editor = valueField(modal).locator('.cm-content').first()
  await pasteCode(page, editor, opts.value as string)
  await leaveExpressionEditor(editor)
}

/** Make a Function input, output or local from its stored shape with the in-Function Add menu, and wait for its row. */
export async function createDeclaration(
  page: Page,
  mode: 'input' | 'output' | 'variable',
  decl: StoredDeclaration,
): Promise<void> {
  const name = String(decl.name)
  const modal = await openFunctionCreateModal(page, mode)
  await fillDeclaration(page, modal, mode, decl)
  await submitCreate(page, modal)
  await expect(modal).toBeHidden()
  await expect(variableRow(page, name)).toBeVisible()
}

// --- Edit window ---

interface OpenEditWindow {
  id: string
  name: string
  active: boolean
}

async function openEditWindows(page: Page): Promise<OpenEditWindow[]> {
  return page.locator(EDIT_WINDOW).evaluateAll((sections) =>
    sections.map((section) => {
      const field = section.querySelector('[data-testid="create-variable-name"]') as HTMLTextAreaElement | null
      return { id: field?.id ?? '', name: field?.value ?? '', active: section.getAttribute('data-active') === 'true' }
    }),
  )
}

/** The value pill's options: an input reads Default / Current, everything else Initial / Current. */
export type WindowValueView = 'Initial' | 'Current' | 'Default'

/** The value pill of an Edit window. */
export function valueSwitch(win: Locator): Locator {
  return win.locator('[data-testid="value-switch"]')
}

/** Pick a value view on the pill and wait for the pill to read it. */
export async function setValueView(page: Page, win: Locator, view: WindowValueView): Promise<void> {
  const pill = valueSwitch(win)
  if (((await pill.textContent()) ?? '').trim() !== view) {
    await pill.click()
    await page.getByRole('option', { name: view, exact: true }).click()
  }
  await expect(pill).toHaveText(view)
}

/** Open the Edit window of `name` from its row pencil in the scope shown; an open one is raised and returned. */
export async function openEditWindow(
  page: Page,
  name: string,
  opts: { view?: WindowValueView } = {},
): Promise<Locator> {
  await expandVariableManager(page)
  const row = variableRow(page, name)
  await expect(row, `the row of ${name} shows`).toBeVisible()
  await row.hover()
  const pencil = editPencil(page, name)
  await expect(pencil, `the pencil of ${name} is unlocked`).not.toHaveAttribute('aria-disabled', 'true')
  const before = new Set((await openEditWindows(page)).map((w) => w.id))
  await pencil.click()
  let id = ''
  await expect
    .poll(
      async () => {
        const open = (await openEditWindows(page)).filter((w) => w.name === name)
        id = (open.find((w) => !before.has(w.id)) ?? open.find((w) => w.active))?.id ?? ''
        return id
      },
      { message: `the Edit window of ${name} opens`, timeout: 10_000 },
    )
    .not.toBe('')
  const win = windowByNameId(page, id)
  await expect(win).toBeVisible()
  if (opts.view) await setValueView(page, win, opts.view)
  return win
}

/** The open Edit window whose Name field holds `name`, pinned to it. */
export async function editWindow(page: Page, name: string): Promise<Locator> {
  let id = ''
  await expect
    .poll(
      async () => {
        const open = (await openEditWindows(page)).filter((w) => w.name === name)
        id = (open.find((w) => w.active) ?? open.at(-1))?.id ?? ''
        return id
      },
      { message: `an Edit window of ${name} is open`, timeout: 10_000 },
    )
    .not.toBe('')
  return windowByNameId(page, id)
}

/** Open the Edit window of a watcher's variable at the value the watcher shows; returns the window. */
export async function editFromWatcher(watcher: Locator): Promise<Locator> {
  const page = watcher.page()
  const name = ((await watcher.getAttribute('aria-label')) ?? '').replace(/^Inspect variable /, '')
  expect(name, 'the watcher names its variable').not.toBe('')
  const pill = watcher.locator('[data-testid="mode-dropdown"]')
  const shows = (await pill.count()) > 0 ? ((await pill.textContent()) ?? '').trim() : ''
  const win = await openEditWindow(page, name)
  if (shows === 'Current' || shows === 'Compare') await setValueView(page, win, 'Current')
  return win
}

/** A value as a person enters it. */
export type WindowValue = string | number | boolean | null

/** Set the value the pill shows, through the face the field shows (null ticks Set to null). */
export async function setWindowValue(page: Page, win: Locator, value: WindowValue): Promise<void> {
  let face = await shownFace(win)
  if (value === null) {
    if (face !== 'null') await setToNull(page, win)
    return
  }
  if (face === 'null') {
    await setWindowCheckbox(win, 'set-to-null', false)
    face = await shownFace(win)
  }
  const field = valueField(win)
  const text = String(value)
  switch (face) {
    case 'masked':
      throw new Error('The value is a masked secret: call editProtectedValue first')
    case 'boolean': {
      const button = field.locator(`[data-testid="scalar-edit-bool-${text}"]`)
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      return
    }
    case 'number': {
      const box = field.locator('[data-testid="scalar-edit-input"]')
      await box.fill(text)
      await expect(box).toHaveValue(text)
      return
    }
    case 'enum': {
      const trigger = field.locator('[data-testid="enum-value-select"] [role="combobox"]')
      await trigger.click()
      await page.getByRole('option', { name: text, exact: true }).click()
      await expect(trigger).toHaveText(text)
      return
    }
    case 'source': {
      const editor = field.locator('.cm-content').first()
      await pasteCode(page, editor, text)
      await leaveExpressionEditor(editor)
      return
    }
    default:
      if (text.includes('\n')) {
        await writeValueEditor(page, win, text)
        return
      }
      await lineInput(win).fill(text)
      await expect(lineInput(win)).toHaveValue(text)
  }
}

/** The value field shows `value` (a multi-line String Literal: its full text in the field's title). */
export async function expectWindowValue(win: Locator, value: WindowValue): Promise<void> {
  const field = valueField(win)
  if (value === null) {
    await expect(field.locator('[data-testid="create-null-field"]')).toBeVisible()
    return
  }
  const text = String(value)
  const face = await shownFace(win)
  switch (face) {
    case 'boolean':
      await expect(field.locator(`[data-testid="scalar-edit-bool-${text}"]`)).toHaveAttribute('aria-pressed', 'true')
      return
    case 'number':
      await expect(field.locator('[data-testid="scalar-edit-input"]')).toHaveValue(text)
      return
    case 'enum':
      await expect(field.locator('[data-testid="enum-value-select"] [role="combobox"]')).toHaveText(text)
      return
    case 'source':
      await expect(field.locator('.cm-content').first()).toHaveText(text)
      return
    case 'line':
      if (text.includes('\n')) await expect(lineInput(win)).toHaveAttribute('title', text)
      else await expect(lineInput(win)).toHaveValue(text)
      return
    default:
      throw new Error(`The field shows ${face}, not ${text}`)
  }
}

/** Fill an Edit window's Name with a new name. */
export async function renameInWindow(win: Locator, name: string): Promise<void> {
  const field = win.locator(NAME_FIELD)
  await field.fill(name)
  await expect(field).toHaveValue(name)
}

/** The notice a rename in an Edit window shows (`window-rename-notice`). */
export function renameNotice(win: Locator): Locator {
  return win.locator('[data-testid="window-rename-notice"]')
}

/** Answer the open "Change variable type?" or "Change variable kind?" confirm. */
export async function answerChangeConfirm(
  page: Page,
  answer: 'Change type' | 'Change kind' | 'Cancel',
): Promise<void> {
  const dialog = page.getByRole('alertdialog').filter({ hasText: /Change variable (type|kind)\?/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Pick a Type in an Edit window and answer the confirm it asks. */
export async function retypeInWindow(
  page: Page,
  win: Locator,
  type: string,
  answer: 'Change type' | 'Cancel' = 'Change type',
): Promise<void> {
  await setCreateType(page, type, win)
  await answerChangeConfirm(page, answer)
}

/** Pick a Kind in an Edit window and answer the confirm it asks. */
export async function rekindInWindow(
  page: Page,
  win: Locator,
  kind: 'Literal' | 'Expression' | 'Template',
  answer: 'Change kind' | 'Cancel' = 'Change kind',
): Promise<void> {
  await setCreateKind(page, kind, win)
  await answerChangeConfirm(page, answer)
}

/** Answer "Remove Secret Protection?", which unticking Mark as secret on a saved secret asks. */
export async function answerRemoveSecret(page: Page, answer: 'Remove & Delete Value' | 'Cancel'): Promise<void> {
  const dialog = page.getByRole('alertdialog').filter({ hasText: 'Remove Secret Protection?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Click a masked secret field's pencil and answer "Edit Protected Value?". */
export async function editProtectedValue(
  page: Page,
  win: Locator,
  answer: 'Delete & Edit' | 'Cancel' = 'Delete & Edit',
): Promise<void> {
  const masked = valueField(win).getByRole('button', { name: /Edit protected value$/ })
  await masked.click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toBeHidden()
  if (answer === 'Delete & Edit') await expect(masked).toHaveCount(0)
  else await expect(masked).toBeVisible()
}

/** The question Save asks before it makes a saved plain variable secret. */
export function makeSecretQuestion(page: Page): Locator {
  return page.getByRole('alertdialog').filter({ hasText: 'Make this variable secret?' })
}

/** Save a window and wait for it to close; the window closes only once a Current value's write is done. */
export async function saveWindow(
  page: Page,
  which?: CreateWindowRef,
  opts: { makeSecret?: boolean } = {},
): Promise<void> {
  const win = which === undefined ? createModal(page) : await pinWindow(page, createModal(page, which))
  const save = windowSaveButton(win)
  await expect(save, 'Save is not locked by the run').not.toHaveAttribute('aria-disabled', 'true')
  await expect(save).toBeEnabled()
  await save.click()
  if (opts.makeSecret) {
    const question = makeSecretQuestion(page)
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'Make secret and save', exact: true }).click()
    await expect(question).toBeHidden()
  }
  await expect(win, 'the window closes once its Save is written').toBeHidden({ timeout: 15_000 })
}

// --- "Edit value" sheet ---

/** Click a field's Open editor and return the "Edit value" sheet it opened. */
export async function openValueEditor(
  page: Page,
  win: Locator,
  field: 'value' | 'allowed-values' = 'value',
): Promise<Locator> {
  const sheets = valueEditorSheet(page)
  const before = await sheets.count()
  await valueField(win, field).getByRole('button', { name: 'Open editor', exact: true }).click()
  await expect(sheets).toHaveCount(before + 1)
  const sheet = sheets.nth(before)
  await expect(sheet).toBeVisible()
  return sheet
}

/** Switch the sheet's Visual / Code view (lists, maps, tables). */
export async function setValueEditorView(page: Page, sheet: Locator, view: 'Visual' | 'Code'): Promise<void> {
  const trigger = sheet.locator('[data-testid="view-dropdown"]')
  if (((await trigger.textContent()) ?? '').trim() !== view) {
    await trigger.click()
    await page.getByRole('option', { name: view, exact: true }).click()
  }
  await expect(trigger).toHaveText(view)
}

/** The sheet's code editor: a string's body, or a list / map / table in the Code view. */
export function valueEditorCode(sheet: Locator): Locator {
  return sheet.locator('.cm-content').first()
}

/** Replace the sheet's code text in one input, so quote and bracket pairing leaves it alone. */
export async function replaceValueEditorCode(page: Page, sheet: Locator, text: string): Promise<void> {
  const editor = valueEditorCode(sheet)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
  await expect(editor.locator('.cm-line')).toHaveText(text.split('\n'))
}

/** Click the sheet's Save, which writes the draft into the window and keeps the sheet open. */
export async function saveValueEditor(sheet: Locator): Promise<void> {
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save, 'the draft is written').toBeDisabled()
}

const SHEET_ANSWER_IDS: Record<CloseAnswer, string> = {
  'Keep Editing': 'value-editor-unsaved-keep-button',
  Close: 'value-editor-unsaved-discard-button',
  Save: 'value-editor-unsaved-save-button',
}

/** Click the sheet's Close: with no answer it must close at once; with one, its question is answered. */
export async function closeValueEditor(page: Page, sheet: Locator, answer?: CloseAnswer): Promise<void> {
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  if (answer === undefined) {
    await expect(sheet).toBeHidden()
    return
  }
  const question = page.locator('[data-testid="value-editor-unsaved-dialog"]')
  await expect(question).toBeVisible()
  await question.locator(`[data-testid="${SHEET_ANSWER_IDS[answer]}"]`).click()
  await expect(question).toBeHidden()
  if (answer === 'Keep Editing') await expect(sheet).toBeVisible()
  else await expect(sheet).toBeHidden()
}

/** Pick a string format on the sheet (`Plain`, `JSON`, `XML`, `YAML`, or the Auto label as shown). */
export async function setValueEditorFormat(page: Page, sheet: Locator, label: string): Promise<void> {
  const trigger = sheet.locator('[data-testid="format-dropdown"]')
  await trigger.click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(trigger).toHaveText(label)
}

/** Click the sheet's Format: the Code view's, or a string's. */
export async function formatValueEditor(sheet: Locator): Promise<void> {
  await sheet
    .locator('[data-testid="value-editor-format-button"], [data-testid="value-editor-string-format-button"]')
    .click()
}

/** Write `text` into a field through its sheet (Code view for a list, map or table), then Save and Close it. */
export async function writeValueEditor(
  page: Page,
  win: Locator,
  text: string,
  field: 'value' | 'allowed-values' = 'value',
): Promise<void> {
  const sheet = await openValueEditor(page, win, field)
  if ((await sheet.locator('[data-testid="view-dropdown"]').count()) > 0) await setValueEditorView(page, sheet, 'Code')
  await replaceValueEditorCode(page, sheet, text)
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  // Save stays dead when the text matches what the field already holds.
  if (await save.isEnabled()) await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
}
