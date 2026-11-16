/** Reads and drivers of a Block row's one value field (FIELD-1..FIELD-7): its text, state, buttons and switch warning. */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { elementColor, paramRow, resolvedColor } from './config-sheet'
import { clickScrolledIntoView, waitForTooltipText } from './tooltip-wait'

/** The exact texts of the field's two key tooltips (FIELD-2, FIELD-6). */
export const DEFAULT_KEY_HINT = 'Not set, so the default is used. Type to use your own value.'
export const ENTRIES_KEY_HINT = 'Has {{ }} entries. Open the editor to change it.'

/** The switch warning texts (FIELD-7). */
export const SWITCH_TO_EXPRESSION_TITLE = 'Switch the field to an expression?'
export const SWITCH_TO_PLAIN_TITLE = 'Switch the field to a plain value?'
export const SWITCH_BODY = 'The current value is cleared.'

/** The bordered box of a row's value field (the input group, or a choice list's trigger). */
export function fieldBox(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).locator('[data-slot="input-group"], button[role="combobox"]').first()
}

/** The text box of a row's value field. */
export function fieldInput(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).locator('[data-slot="input-group"] input').first()
}

/** The line drawn over a box: a `{{ }}` entries line, `null` or `<empty string>`. */
export function fieldOverlay(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).locator('[data-slot="input-group"] span.pointer-events-none > span')
}

/** The italic state marker drawn over an empty box: `null` or `<empty string>` (FIELD-4, FIELD-5). */
export function stateMarker(sheet: Locator, name: string): Locator {
  return paramRow(sheet, name).locator('[data-slot="input-group"] span.pointer-events-none > span.italic')
}

/** The {x} code box of a row in expression mode. */
export function expressionBox(sheet: Locator, name: string): Locator {
  return sheet.locator(`[data-testid="param-input-${name}"] .cm-content`)
}

/** The gray hint an empty {x} box shows for the default. */
export function expressionHint(sheet: Locator, name: string): Locator {
  return sheet.locator(`[data-testid="param-input-${name}"] .cm-placeholder`)
}

export const expandButton = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-expand-${name}"]`)
export const resetButton = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-reset-${name}"]`)
export const nullButton = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-null-${name}"]`)
export const expressionToggle = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('[data-testid="expression-toggle"]')

/** The box area of a field cell outside a table row (a condition value, a lane limit, a Setter value), by its stem. */
export function cellShell(scope: Locator, stem: string): Locator {
  return scope.locator(`[data-testid="param-key-hint-${stem}"]`).locator('xpath=..')
}

/** The bordered box of a cell: its input group in every literal face, else its {x} or Template code box. */
export function cellBox(scope: Locator, stem: string): Locator {
  return cellShell(scope, stem).locator(`[data-slot="input-group"], [data-testid="param-input-${stem}"]`).first()
}

/** The text, number or code box of a cell. */
export const cellInput = (scope: Locator, stem: string): Locator => scope.locator(`[data-testid="param-input-${stem}"]`)

/** The line drawn over a cell's box: a `{{ }}` entries line, `null` or `<empty string>`. */
export const cellOverlay = (scope: Locator, stem: string): Locator =>
  cellShell(scope, stem).locator('span.pointer-events-none > span')

/** The italic state marker drawn over a cell's empty box: `null` or `<empty string>`. */
export const cellStateMarker = (scope: Locator, stem: string): Locator =>
  cellShell(scope, stem).locator('span.pointer-events-none > span.italic')

/** The error line under a cell's box. */
export const cellError = (scope: Locator, stem: string): Locator => scope.locator(`[data-testid="param-error-${stem}"]`)

/** The visible tooltip of a row's field (the hidden screen-reader copy left out). */
export function fieldTooltip(page: Page, name: string): Locator {
  return page.locator(`[data-slot="tooltip-content"] > [data-testid="param-tooltip-${name}"]`)
}

/** Text Muted, the one gray of a default, a hint, `null` and `<empty string>` (FIELD-2, FIELD-4, FIELD-5). */
export function textMuted(page: Page): Promise<string> {
  return resolvedColor(page, 'var(--color-text-muted)')
}

/** `target` draws its text in Text Muted. */
export async function expectTextMuted(target: Locator, what: string): Promise<void> {
  const muted = await textMuted(target.page())
  await expect.poll(() => elementColor(target, 'color'), { message: `${what} is Text Muted` }).toBe(muted)
}

/** The computed look of an element's text: style, selectability and font family. */
export function textLook(target: Locator): Promise<{ fontStyle: string; userSelect: string; monospace: boolean }> {
  return target.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      fontStyle: style.fontStyle,
      userSelect: style.userSelect,
      monospace: /mono/i.test(style.fontFamily),
    }
  })
}

/** Focus a row's text box, press `key`, and wait for the field's tooltip to read `hint`; returns the tooltip. */
export async function pressForHint(page: Page, sheet: Locator, name: string, key: string, hint: string): Promise<Locator> {
  await clickScrolledIntoView(fieldInput(sheet, name))
  await page.keyboard.press(key)
  await waitForTooltipText(page, hint, `${name} tooltip after ${key}`, 5_000)
  const tooltip = fieldTooltip(page, name)
  await expect(tooltip).toHaveText(hint)
  return tooltip
}

/** The switch warning dialog (FIELD-7). */
export function switchWarning(page: Page): Locator {
  return page.locator('[data-testid="switch-mode-dialog"]')
}

/** The switch warning's buttons, left to right. */
export function switchWarningButtons(dialog: Locator): Locator {
  return dialog.locator('[data-action-group] button')
}

/** Click a row's {x} toggle and return the switch warning it asks. */
export async function askSwitch(page: Page, sheet: Locator, name: string): Promise<Locator> {
  await expressionToggle(sheet, name).click()
  const dialog = switchWarning(page)
  await expect(dialog).toBeVisible()
  return dialog
}

/** Answer the switch warning by its button label and wait for it to close. */
export async function answerSwitch(
  page: Page,
  answer: 'Cancel' | 'Clear & Default' | 'Clear' | 'Clear & Empty',
): Promise<void> {
  const dialog = switchWarning(page)
  await dialog.getByRole('button', { name: answer, exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
