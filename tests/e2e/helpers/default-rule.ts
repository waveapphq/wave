/** Drivers and reads of the default rule on a Block row (FIELD-2, FIELD-3, FIELD-7): gray default, user value, {x} hint, switch warning, stored result. */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { leaveExpressionEditor } from './code-editor'
import { clickScrolledIntoView, waitForTooltipText } from './tooltip-wait'
import {
  DEFAULT_KEY_HINT,
  SWITCH_BODY,
  expectTextMuted,
  expressionBox,
  expressionHint,
  expressionToggle,
  fieldInput,
  fieldTooltip,
  nullButton,
  resetButton,
  stateMarker,
  switchWarning,
  switchWarningButtons,
  textMuted,
} from './value-field'

/** The free-entry field types a Block row draws as the one value field. */
export type FreeEntryType = 'string' | 'integer' | 'float' | 'array' | 'map' | 'table'

// The value color of each type, as the field paints a held value (lib/variable-format.ts).
const VALUE_COLOR_CLASS: Record<FreeEntryType, string> = {
  string: 'text-sky-300',
  integer: 'text-violet-400',
  float: 'text-pink-400',
  array: 'text-amber-300',
  map: 'text-emerald-400',
  table: 'text-blue-500',
}

/** The sRGB hex a class paints text in, read from a probe beside the sheet. */
export function classColor(page: Page, className: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.className = name
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }, className)
}

/** An element's text color as sRGB hex. */
function textColor(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }, undefined, { timeout: 2000 })
}

/** `target` draws its text in the value color of `type`. */
export async function expectValueColor(target: Locator, type: FreeEntryType, what: string): Promise<void> {
  const want = await classColor(target.page(), VALUE_COLOR_CLASS[type])
  const muted = await textMuted(target.page())
  expect(want, 'the value color is not Text Muted').not.toBe(muted)
  await expect.poll(() => textColor(target), { message: `${what} is in the ${type} value color` }).toBe(want)
}

/** Literal mode, not set: the default as real text in Text Muted, no reset icon (FIELD-2, FIELD-3). */
export async function expectGrayDefault(sheet: Locator, name: string, shown: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  const box = fieldInput(sheet, name)
  await expect(box, `${name}: the box holds the default text`).toHaveValue(shown)
  await expectTextMuted(box, `${name}: the gray default`)
  await expect(resetButton(sheet, name), `${name}: no reset icon while not set`).toHaveCount(0)
}

/** Literal mode, not set, with an empty-text default: the box is empty under the gray `<empty string>` (FIELD-2, FIELD-4). */
export async function expectGrayEmptyDefault(sheet: Locator, name: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  await expect(fieldInput(sheet, name), `${name}: the box holds no text`).toHaveValue('')
  await expectEmptyStringMarker(sheet, name)
  await expect(resetButton(sheet, name), `${name}: no reset icon while not set`).toHaveCount(0)
}

/** The italic gray `<empty string>` marker over the box, which shows while the box has no focus (FIELD-4). */
export async function expectEmptyStringMarker(sheet: Locator, name: string): Promise<void> {
  await fieldInput(sheet, name).blur()
  const marker = stateMarker(sheet, name)
  await expect(marker, `${name}: the empty text marker`).toHaveText('<empty string>')
  await expectTextMuted(marker, `${name}: <empty string>`)
}

/** Literal mode, not set, no default, a field that takes null: italic gray `null` with the pressed null button (FIELD-5). */
export async function expectNullNotSet(sheet: Locator, name: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  await fieldInput(sheet, name).blur()
  const marker = stateMarker(sheet, name)
  await expect(marker, `${name}: the null marker`).toHaveText('null')
  await expectTextMuted(marker, `${name}: null`)
  await expect(nullButton(sheet, name), `${name}: the null button is pressed`).toHaveAttribute('aria-pressed', 'true')
  await expect(resetButton(sheet, name)).toHaveCount(0)
}

/** Literal mode, not set, no default, a field that takes no null: an empty box with no marker. */
export async function expectEmptyNotSet(sheet: Locator, name: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  await expect(fieldInput(sheet, name), `${name}: the box is empty`).toHaveValue('')
  await expect(stateMarker(sheet, name), `${name}: no marker`).toHaveCount(0)
  await expect(resetButton(sheet, name)).toHaveCount(0)
  await expect(nullButton(sheet, name)).toHaveCount(0)
}

/** Literal mode holding the user's value: the text in its type's value color, the reset icon when the field has a default. */
export async function expectUserValue(
  sheet: Locator,
  name: string,
  type: FreeEntryType,
  shown: string,
  hasDefault = true,
): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  const box = fieldInput(sheet, name)
  await expect(box, `${name}: the box holds the user's value`).toHaveValue(shown)
  await expectValueColor(box, type, `${name}: the user's value`)
  await expect(resetButton(sheet, name), `${name}: the reset icon`).toHaveCount(hasDefault ? 1 : 0)
}

/** The text an {x} box holds, its gray hint left out. */
export function expressionText(sheet: Locator, name: string): Promise<string> {
  return expressionBox(sheet, name).evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.cm-placeholder').forEach((hint) => hint.remove())
    return copy.textContent ?? ''
  })
}

/** {x} mode holding `text`; `hint` is the gray default hint an empty box shows, null for none (FIELD-2, FIELD-7). */
export async function expectExpression(sheet: Locator, name: string, text: string, hint: string | null): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: {x} mode`).toHaveAttribute('aria-pressed', 'true')
  await expect(expressionBox(sheet, name)).toBeVisible()
  await expect.poll(() => expressionText(sheet, name), { message: `${name}: the {x} box text` }).toBe(text)
  if (hint === null) {
    await expect(expressionHint(sheet, name), `${name}: no gray hint`).toHaveCount(0)
    return
  }
  await expect(expressionHint(sheet, name), `${name}: the default as a Python literal`).toHaveText(hint)
  await expectTextMuted(expressionHint(sheet, name), `${name}: the {x} hint`)
}

/** Replace the {x} box text in one input, so quote and bracket pairing leaves it alone. */
export async function typeExpression(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  const editor = expressionBox(sheet, name)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect.poll(() => expressionText(sheet, name), { message: `${name}: the typed expression` }).toBe(text)
  await leaveExpressionEditor(editor)
}

/** Type into the field's box key by key, as a user does (FIELD-2: the first key replaces a gray default). */
export async function typeKeys(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  await fieldInput(sheet, name).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

/** Select all in the field's box and press Delete (FIELD-2: back to not set). */
export async function selectAllAndDelete(page: Page, sheet: Locator, name: string): Promise<void> {
  await fieldInput(sheet, name).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
}

/** Press `key` in the gray default: the text stays and the field's tooltip explains (FIELD-2). */
export async function expectDefaultKeyHint(page: Page, sheet: Locator, name: string, key: 'Delete' | 'Backspace'): Promise<void> {
  const box = fieldInput(sheet, name)
  const before = await box.inputValue()
  await clickScrolledIntoView(box)
  await page.keyboard.press(key)
  await waitForTooltipText(page, DEFAULT_KEY_HINT, `${name} tooltip after ${key}`, 5_000)
  await expect(fieldTooltip(page, name), `${name}: ${key} explains the default`).toHaveText(DEFAULT_KEY_HINT)
  await expect(box, `${name}: ${key} leaves the default whole`).toHaveValue(before)
  // Leaving the box closes the tooltip.
  await box.blur()
  await expect(fieldTooltip(page, name)).toHaveCount(0)
}

/** Click {x} on a row that holds nothing: it switches at once, with no warning (FIELD-7). */
export async function switchSilently(page: Page, sheet: Locator, name: string, pressed: boolean): Promise<void> {
  const toggle = expressionToggle(sheet, name)
  await toggle.click()
  await expect(toggle, `${name}: switched with no warning`).toHaveAttribute('aria-pressed', String(pressed))
  await expect(switchWarning(page), `${name}: a field holding nothing asks nothing`).toHaveCount(0)
}

export type SwitchAnswer = 'Cancel' | 'Clear & Default' | 'Clear' | 'Clear & Empty'

/** The switch warning: its title as its name, the one body line, the buttons left to right, the last one primary, focus on Cancel (FIELD-7). */
export async function expectSwitchWarning(dialog: Locator, title: string, buttons: readonly SwitchAnswer[]): Promise<void> {
  await expect(dialog).toBeVisible()
  await expect(dialog, 'the title names the switch, never the field').toHaveAccessibleName(title)
  await expect(dialog).toHaveAccessibleDescription(SWITCH_BODY)
  const row = switchWarningButtons(dialog)
  await expect(row).toHaveText([...buttons])
  const last = buttons.length - 1
  for (const [index] of buttons.entries()) {
    await expect(row.nth(index), `${buttons[index]} ${index === last ? 'is' : 'is not'} the primary button`).toHaveClass(
      index === last ? /\bbtn-primary\b/ : /\bbtn-secondary\b/,
    )
  }
  await expect(dialog.getByTestId('switch-mode-cancel'), 'focus starts on Cancel').toBeFocused()
}

/** Click {x} on a row holding a value, check the warning it asks, answer it and wait for it to close. */
export async function switchWithAnswer(
  page: Page,
  sheet: Locator,
  name: string,
  title: string,
  buttons: readonly SwitchAnswer[],
  answer: SwitchAnswer,
): Promise<void> {
  await expressionToggle(sheet, name).click()
  const dialog = switchWarning(page)
  await expectSwitchWarning(dialog, title, buttons)
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

/** The stored Block's own fields: values and flags as GET /tests/{id} holds them. */
export interface StoredFields {
  values: Record<string, unknown>
  expressionFields: string[]
}

export function storedFields(data: Record<string, any>): StoredFields {
  return {
    values: (data.config?.values ?? {}) as Record<string, unknown>,
    expressionFields: (data.expressionFields ?? []) as string[],
  }
}

/** Save stored nothing for the field: no value and no {x} flag of it (REQ-3.1.1.5). */
export function expectNothingStored(stored: StoredFields, name: string, what: string): void {
  expect(Object.hasOwn(stored.values, name), `${what}: ${name} stores no value (${JSON.stringify(stored.values[name])})`).toBe(false)
  const flags = stored.expressionFields.filter((flag) => flag === name || flag.startsWith(`${name}.`))
  expect(flags, `${what}: ${name} stores no {x} flag`).toEqual([])
}

/** The field is stored as `value`, a plain value or an expression by `expression`. */
export function expectStored(stored: StoredFields, name: string, value: unknown, expression: boolean, what: string): void {
  expect(stored.values[name], `${what}: ${name} stores its value`).toEqual(value)
  expect(stored.expressionFields.includes(name), `${what}: ${name} ${expression ? 'is' : 'is not'} stored as {x}`).toBe(expression)
}
