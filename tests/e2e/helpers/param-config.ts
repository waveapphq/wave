/**
 * String rows on a Block config sheet (FIELD-1): the row's one value field shows the value, and its expand
 * (`param-expand-<name>`, `Open editor for <label>`) opens the shared "Edit value" sheet (`value-editor-sheet`),
 * where the Literal / Template kind dropdown lives.
 */

import { expect, type Locator, type Page } from './playwright-fixtures'

/** The shared "Edit value" sheet (a page-level overlay, not nested in the config sheet). */
export const valueEditorSheet = (page: Page): Locator =>
  page.locator('[data-testid="value-editor-sheet"]')

/** The text box of a row's one value field. */
export const stringParamBox = (scope: Locator, name: string): Locator =>
  scope.locator(`[data-testid="param-row-${name}"] [data-slot="input-group"] input`).first()

/** Open a string param's "Edit value" sheet through the row's expand. */
export async function openStringParamSheet(
  scope: Locator,
  page: Page,
  name: string,
): Promise<Locator> {
  await scope.locator(`[data-testid="param-expand-${name}"]`).click()
  const sheet = valueEditorSheet(page)
  await expect(sheet).toBeVisible()
  return sheet
}

/** Replace a literal string param's value through the shared sheet and Save it. */
export async function setStringParam(
  scope: Locator,
  page: Page,
  name: string,
  value: string,
): Promise<void> {
  const sheet = await openStringParamSheet(scope, page, name)
  const editor = sheet.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  if (value) await page.keyboard.type(value)
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  // Save is dead when the retyped text matches what is already stored.
  if (await save.isEnabled()) await save.click()
  // Save applies the value and keeps the sheet open; it goes dead once applied.
  await expect(save).toBeDisabled()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

/** The row's field holds a text containing `value`; a many-line text shows its first line and carries the whole in its title. */
export async function expectStringParamPreview(
  scope: Locator,
  name: string,
  value: string,
): Promise<void> {
  const box = stringParamBox(scope, name)
  await expect
    .poll(async () => (await box.getAttribute('title')) ?? (await box.inputValue()), {
      message: `${name} holds ${JSON.stringify(value)}`,
    })
    .toContain(value)
}
