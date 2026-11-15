/** Reads of a Block string row drawn on its Template face (a blank OpenSearch Query starts as a Template). */

import { expect, type Locator } from '../../helpers/playwright-fixtures'
import { expressionText } from '../../helpers/default-rule'
import {
  expectTextMuted,
  expressionBox,
  expressionHint,
  expressionToggle,
  fieldInput,
  resetButton,
} from '../../helpers/value-field'

/** Not set on the Template face: an empty code box under the gray default hint, no plain box and no reset icon. */
export async function expectBlankTemplate(sheet: Locator, name: string, hint: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: not {x}`).toHaveAttribute('aria-pressed', 'false')
  await expect(fieldInput(sheet, name), `${name}: the Template face draws no plain box`).toHaveCount(0)
  await expect(expressionBox(sheet, name), `${name}: the Template code box`).toBeVisible()
  await expect.poll(() => expressionText(sheet, name), { message: `${name}: the Template box is empty` }).toBe('')
  await expect(expressionHint(sheet, name), `${name}: the default as a Python literal`).toHaveText(hint)
  await expectTextMuted(expressionHint(sheet, name), `${name}: the gray hint`)
  await expect(resetButton(sheet, name), `${name}: no reset icon while not set`).toHaveCount(0)
}

/** The user's text on the Template face: the code box holds it with no hint, and the reset icon shows. */
export async function expectTemplateText(sheet: Locator, name: string, text: string): Promise<void> {
  await expect(expressionToggle(sheet, name), `${name}: not {x}`).toHaveAttribute('aria-pressed', 'false')
  await expect(fieldInput(sheet, name), `${name}: the Template face draws no plain box`).toHaveCount(0)
  await expect.poll(() => expressionText(sheet, name), { message: `${name}: the Template text` }).toBe(text)
  await expect(expressionHint(sheet, name), `${name}: no gray hint while set`).toHaveCount(0)
  await expect(resetButton(sheet, name), `${name}: the reset icon`).toHaveCount(1)
}
