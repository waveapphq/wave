/**
 * V-CRED-STORED-GATE-01: Variable Setter secret value field - stored-secret gate
 *
 * Phase: no-data (parallel) - self-seeds a Test via POST /tests, opens its Variable
 * Setter config sheet; no execution. Runs under dark + light projects.
 * Design Decisions: SECUI-9 shared-cell canon, VARSET-7
 * REQ: REQ-3.1.3.18
 *
 * Pass Criteria:
 * 1. The Variable Setter editor labels the Secret + Value columns.
 * 2. A SAVED (sealed) secret renders masked write-only via the same full-width field
 *    affordance a plugin credential input uses, named after its row
 *    (`saved_secret: Edit protected value`); the stored value never renders in cleartext.
 * 3. A secret value typed THIS session in the row's value box stays visible and editable;
 *    it masks write-only only AFTER the test is saved, WITHOUT a page reload (the nested
 *    config.values.variables resync).
 * 4. Cancel and Escape on "Edit Protected Value?" close the question, open no editor,
 *    leave exactly one masked field and put keyboard focus back on it; a config Save
 *    and a test Save after them keep the same sealed value in the saved test, and the
 *    reopened field is still masked (REQ-3.1.3.5).
 * 5. "Delete & Edit" on the text secret opens no editor: the row's value box is empty and
 *    holds keyboard focus. On the stored list secret it opens the empty "Edit value" sheet
 *    with focus inside; Escape closes it and focus is on that row's value box. Focus is
 *    never on the page body (REQ-3.1.3.5).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { configSheet, saveBtn } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const SETTER_NODE = 'setter'
const SECRET_NAME = 'saved_secret'
const SECRET_PLAINTEXT = 'saved-secret-abc123'
const SECRET_ROW = 0
// A stored list secret beside the text secret: its Delete & Edit opens a sheet.
const LIST_NAME = 'saved_list'
const LIST_PLAINTEXT = ['list-secret-a7f3', 'list-secret-b9e1']
const LIST_ROW = 1
const SEALED = /^wave:enc:v1:[A-Za-z0-9+/=_-]+$/
const SAVED_NOTE = 'Gate kept the secret'

interface GateFixture {
  workflow: {
    nodes: Array<{
      id: string
      data: { config: { values: { variables: Record<string, unknown> }; secretFields: string[] } }
    }>
  }
  variables: Record<string, unknown>
}

/** The shared gate fixture plus a stored list secret row. */
function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../fixtures/secrets/varset-gate.json'), 'utf-8'),
  ) as GateFixture
  const setter = fixture.workflow.nodes.find((node) => node.id === SETTER_NODE)
  if (!setter) throw new Error('the gate fixture holds no setter block')
  setter.data.config.values.variables[LIST_NAME] = [...LIST_PLAINTEXT]
  setter.data.config.secretFields.push(`variables.${LIST_NAME}`)
  fixture.variables[LIST_NAME] = { value: [], type: 'array', scope: 'test', secret: true }
  return fixture as unknown as Record<string, unknown>
}

// The masked control is named after its row (`<row>: Edit protected value`).
const maskedField = (sheet: Locator, row = SECRET_NAME): Locator =>
  sheet.getByRole('button', { name: `${row}: Edit protected value`, exact: true })

// The row's inline value box and its sheet's list editor.
const valueBox = (sheet: Locator, row: number): Locator => sheet.getByTestId(`param-input-varset-value-${row}`)
const listItems = (editor: Locator): Locator => editor.locator('[data-testid^="array-edit-input-"]')

const editQuestion = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Edit Protected Value?' })

const valueEditor = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')

/** True while no control holds keyboard focus. */
const focusIsOnPageBody = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement === null || document.activeElement === document.body)

const holdsFocusInside = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element.contains(document.activeElement))

/** The setter block as the saved test holds it, read back through the workflow route. */
async function savedSetter(
  page: Page,
  id: string,
): Promise<{ description: unknown; secret: unknown }> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${id}/workflow`)
  expect(resp.ok(), `GET /tests/${id}/workflow: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const nodes = (body?.data?.nodes ?? body?.nodes ?? []) as Array<{
    id: string
    data?: {
      description?: unknown
      config?: { values?: { variables?: Record<string, unknown> } }
    }
  }>
  const setter = nodes.find((node) => node.id === SETTER_NODE)
  expect(setter, 'the saved test holds the setter block').toBeTruthy()
  return {
    description: setter?.data?.description,
    secret: setter?.data?.config?.values?.variables?.[SECRET_NAME],
  }
}

/** The state both dismissals leave: no question, no editor, one masked field holding focus. */
async function expectStillMaskedAndFocused(page: Page, how: string): Promise<void> {
  const sheet = configSheet(page)
  await expect(editQuestion(page), `${how}: the question is gone`).toHaveCount(0)
  await expect(sheet, `${how}: the block dialog stays open`).toBeVisible()
  await expect(maskedField(sheet), `${how}: exactly one masked field`).toHaveCount(1)
  await expect(valueEditor(page), `${how}: no editor opened`).toHaveCount(0)
  await expect(maskedField(sheet), `${how}: focus is back on the masked field`).toBeFocused()
  expect(await focusIsOnPageBody(page), `${how}: focus is on the page body`).toBe(false)
}

/** Apply the config sheet (its own Save), then persist the workbench draft. */
async function applyConfigAndSave(page: Page): Promise<void> {
  const sheet = configSheet(page)
  const configSave = sheet.getByRole('button', { name: /^Save$/ }).last()
  await expect(configSave).toBeEnabled()
  await configSave.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const toolbarSave = saveBtn(page)
  await expect(toolbarSave).toBeEnabled()
  await toolbarSave.click()
  // The toolbar settles back to non-dirty only once the sealed-value resync has landed,
  // and the config sheet reads its values at mount, so reopening earlier reads pre-save.
  await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })
}

async function openSetterConfig(page: Page): Promise<void> {
  await page.locator('[data-testid="workflow-node-setter"]').locator('button').first().dblclick()
  await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
}

let testId = ''

test.describe('V-CRED-STORED-GATE-01: Variable Setter secret gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    testId = await importValidateAndNavigate(page, loadFixture())
    await page.locator('[data-testid="workflow-node-setter"]').locator('button').first().dblclick()
    await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
  })

  test.afterEach(async ({ page }) => {
    if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('column headers + a saved secret renders masked write-only (field affordance)', async ({ page }) => {
    const sheet = configSheet(page)

    // The Secret + Value columns are labeled.
    await expect(sheet.getByText('Secret', { exact: true }).first()).toBeVisible()
    await expect(sheet.getByText('Value', { exact: true }).first()).toBeVisible()

    // The saved secret masks write-only via the shared full-width
    // field affordance; the stored value / envelope never render in cleartext.
    const masked = maskedField(sheet)
    await expect(masked).toHaveCount(1)
    await expect(masked).toBeVisible()
    await expect(sheet.getByText(/saved-secret-abc123/)).toHaveCount(0)
    await expect(sheet.getByText(/wave:enc:v1:/)).toHaveCount(0)
  })

  test('a typed secret stays visible and masks write-only only after save (no reload)', async ({ page }) => {
    const sheet = () => configSheet(page)

    // Baseline: the saved secret is masked write-only.
    await expect(maskedField(sheet())).toHaveCount(1)

    // Clear-and-retype the saved secret through the write-only flow, in the row's own box.
    await maskedField(sheet()).click()
    const editConfirm = editQuestion(page)
    await expect(editConfirm).toBeVisible()
    await editConfirm.getByRole('button', { name: /Delete & Edit/i }).click()
    await expect(valueBox(sheet(), SECRET_ROW)).toBeFocused()
    await page.keyboard.type('fresh-typed-val')

    // Gate: the value typed this session stays visible + editable (no masked cell now).
    await expect(valueBox(sheet(), SECRET_ROW)).toHaveValue('fresh-typed-val')
    await expect(maskedField(sheet())).toHaveCount(0)

    // Apply the config (sheet Save) + persist the workbench (toolbar Save).
    await applyConfigAndSave(page)

    // Reopen the setter config WITHOUT a page reload: the nested setter secret re-masks
    // write-only (the config.values.variables resync), never showing the typed plaintext.
    await openSetterConfig(page)
    await expect(maskedField(sheet())).toHaveCount(1, {
      timeout: 10_000,
    })
    await expect(sheet().getByText(/fresh-typed-val/)).toHaveCount(0)
  })

  test('Cancel and Escape keep the saved secret masked, stored and focused', async ({ page }) => {
    test.setTimeout(90_000)
    const sheet = configSheet(page)
    const before = await savedSetter(page, testId)
    expect(String(before.secret), 'the import sealed the saved secret').toMatch(SEALED)

    await maskedField(sheet).click()
    await expect(editQuestion(page)).toBeVisible()
    await editQuestion(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectStillMaskedAndFocused(page, 'Cancel')

    await maskedField(sheet).click()
    await expect(editQuestion(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expectStillMaskedAndFocused(page, 'Escape')

    // The sheet's Save needs a change of its own; the note also proves the Save landed.
    await sheet.locator('[data-testid="element-description-input"]').fill(SAVED_NOTE)
    await applyConfigAndSave(page)

    await openSetterConfig(page)
    await expect(maskedField(configSheet(page))).toHaveCount(1, { timeout: 10_000 })
    await expect(configSheet(page).getByText(SECRET_PLAINTEXT)).toHaveCount(0)

    const after = await savedSetter(page, testId)
    expect(after.description, 'the Save reached the saved test').toBe(SAVED_NOTE)
    expect(after.secret, 'the saved test still holds the same sealed value').toBe(before.secret)
  })

  test('Delete & Edit puts keyboard focus on the row value box, never on the page body', async ({
    page,
  }) => {
    const sheet = configSheet(page)

    // The text secret: no editor opens; its emptied value box holds the focus.
    await maskedField(sheet).click()
    await expect(editQuestion(page)).toBeVisible()
    await editQuestion(page).getByRole('button', { name: 'Delete & Edit', exact: true }).click()
    await expect(editQuestion(page)).toHaveCount(0)

    await expect(valueEditor(page), 'a text secret opens no editor').toHaveCount(0)
    await expect(maskedField(sheet)).toHaveCount(0)
    await expect(valueBox(sheet, SECRET_ROW)).toHaveValue('')
    await expect(valueBox(sheet, SECRET_ROW), 'focus is in the emptied value box').toBeFocused()
    expect(await focusIsOnPageBody(page), 'text secret: focus is on the page body').toBe(false)

    // The list secret: the empty editor opens with the focus; Escape hands it to the row.
    await maskedField(sheet, LIST_NAME).click()
    await expect(editQuestion(page)).toBeVisible()
    await editQuestion(page).getByRole('button', { name: 'Delete & Edit', exact: true }).click()
    await expect(editQuestion(page)).toHaveCount(0)

    const editor = valueEditor(page)
    await expect(editor).toBeVisible()
    await expect(editor.locator('[data-testid="array-edit-body"]')).toBeVisible()
    await expect(listItems(editor)).toHaveCount(0)
    for (const item of LIST_PLAINTEXT) await expect(editor).not.toContainText(item)
    await expect(maskedField(sheet, LIST_NAME)).toHaveCount(0)
    await expect.poll(() => holdsFocusInside(editor), { message: 'focus is inside the editor' }).toBe(true)

    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(sheet, 'the block dialog stays open').toBeVisible()
    await expect(valueBox(sheet, LIST_ROW), "focus returns to the row's value box").toBeFocused()
    expect(await focusIsOnPageBody(page), 'list secret: focus is on the page body').toBe(false)
  })
})
