/**
 * The Edit Variables dialog of a Suite, a Regression and the System Variables page.
 */

import { BACKEND_URL } from './config'
import { valueEditorSheet } from './param-config'
import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'

export type EntityScope = 'suite' | 'regression'

const DETAIL_PAGE: Record<EntityScope, string> = {
  suite: 'suite-detail-page',
  regression: 'regression-detail-page',
}

/** The Edit Variables dialog. */
export const variablesDialog = (page: Page): Locator => page.locator('[data-testid="edit-variables-dialog"]')

/** POST a new Suite, Regression or Test and return its id. */
export async function createEntity(request: APIRequestContext, path: string, data: unknown): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}${path}`, { data })
  expect(resp.ok(), `POST ${path}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return (await resp.json()).data.id as string
}

/** Open a Suite's or a Regression's Edit Variables dialog from its detail page. */
export async function openEntityVariables(page: Page, scope: EntityScope, id: string): Promise<Locator> {
  await page.goto(`/${scope}s/${id}`)
  await expect(page.locator(`[data-testid="${DETAIL_PAGE[scope]}"]`)).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="edit-variables-btn"]').click()
  await expect(variablesDialog(page)).toBeVisible({ timeout: 10_000 })
  return variablesDialog(page)
}

async function gotoSystemVariables(page: Page): Promise<{ add: Locator; edit: Locator }> {
  await page.goto('/settings/variables')
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', { state: 'attached' })
  const add = page.locator('[data-testid="system-variables-add-btn"]')
  const edit = page.locator('[data-testid="system-variables-edit-btn"]')
  // An empty list shows only Add Variable, a filled one only Edit Variables.
  await expect(add.or(edit)).toBeVisible({ timeout: 10_000 })
  return { add, edit }
}

/** Open the System Variables dialog through Edit Variables (the list holds variables). */
export async function openSystemVariables(page: Page): Promise<Locator> {
  const { edit } = await gotoSystemVariables(page)
  await edit.click()
  await expect(variablesDialog(page)).toBeVisible({ timeout: 10_000 })
  return variablesDialog(page)
}

/** Open the System Variables dialog on one new row (the last), whether the list is empty or not. */
export async function openSystemVariablesOnNewRow(page: Page): Promise<Locator> {
  const { add, edit } = await gotoSystemVariables(page)
  if (await add.isVisible()) {
    await add.click()
    await expect(variablesDialog(page)).toBeVisible({ timeout: 10_000 })
  } else {
    await edit.click()
    await expect(variablesDialog(page)).toBeVisible({ timeout: 10_000 })
    await variablesDialog(page).locator('[data-testid="add-variable-btn"]').click()
  }
  return variablesDialog(page)
}

/** A dialog row by its variable name; the name field is a textarea, so its text is its input value. */
export async function entityVariableRow(dialog: Locator, name: string): Promise<Locator> {
  const rows = dialog.locator('[data-testid="variable-editor-row"]')
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  for (let i = 0; i < total; i++) {
    if ((await rows.nth(i).locator('[data-testid="variable-name-input"]').inputValue()) === name) {
      return rows.nth(i)
    }
  }
  throw new Error(`variable row "${name}" not found`)
}

/** The dialog's newest row: the one Add just put at the end. */
export const newEntityVariableRow = (dialog: Locator): Locator =>
  dialog.locator('[data-testid="variable-editor-row"]').last()

/** Pick a row's Type by its label and wait until the row shows it. */
export async function setEntityRowType(page: Page, row: Locator, typeLabel: string): Promise<void> {
  await row.locator('[data-testid="variable-type-select"]').click()
  await page.getByRole('option', { name: typeLabel, exact: true }).click()
  await expect(row.locator('[data-testid="variable-type-select"]')).toHaveText(typeLabel)
}

/** A row's value cell button that opens the "Edit value" sheet (its text is the value summary). */
export const entityValueCell = (row: Locator): Locator => row.locator('[data-testid^="entity-var-edit-"]')

/** Open a row's "Edit value" sheet from its value cell. */
export async function openEntityValue(page: Page, row: Locator): Promise<Locator> {
  await entityValueCell(row).click()
  await expect(valueEditorSheet(page)).toBeVisible()
  return valueEditorSheet(page)
}

/** Save the dialog; it closes only when every row is accepted. */
export async function saveVariablesDialog(dialog: Locator): Promise<void> {
  await dialog.locator('[data-testid="edit-dialog-save"]').click()
  await expect(dialog, 'the dialog accepts every row and closes').toBeHidden({ timeout: 10_000 })
}

/** Cancel a dialog that holds no change; it closes without asking. */
export async function cancelVariablesDialog(dialog: Locator): Promise<void> {
  await dialog.locator('[data-testid="edit-dialog-cancel"]').click()
  await expect(dialog).toBeHidden()
}
