/**
 * V-ENTITY-VARIABLE-EDITOR-FUNCTIONAL: Suite, System and Regression variable values edit on the shared bodies
 * REQ: REQ-3.1.3.1, REQ-3.1.3.11
 *
 * Pass Criteria:
 * 1. A Suite, System and Regression array is authored in the "Edit value" sheet's Visual body, its value cell
 *    reads `2 items`, and after a save and a reopen it still reads `2 items` with no one-line JSON error.
 * 2. A Suite secret is cleared and edited through the masked cell (Edit Protected Value? -> Delete & Edit); the
 *    typed value stays visible until the dialog is saved and is masked again on reopen.
 * 3. A Suite integer keeps its exact text (a 19-digit number) through save and reopen.
 *
 * Phase: functional-destructive (creates / clears its own suites, regressions, system vars).
 * Run: ./scripts/e2e-targeted-local.sh functional/entity-variable-editor/v-entity-variable-editor-functional.spec.ts
 */

import { test, expect, type Page, type Locator, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { valueEditorSheet } from '../../helpers/param-config'
import {
  createEntity,
  entityValueCell,
  entityVariableRow,
  newEntityVariableRow,
  openEntityValue,
  openEntityVariables,
  openSystemVariables,
  openSystemVariablesOnNewRow,
  saveVariablesDialog,
  setEntityRowType,
} from '../../helpers/entity-variables'

const clearSystemVariables = (request: APIRequestContext) =>
  request.delete(`${BACKEND_URL}/variables/system`).catch(() => {})

/** Add an array row, author two items in the sheet's Visual body, then name it; its cell reads `2 items`. */
async function addArrayVarViaUI(page: Page, dialog: Locator, name: string) {
  await dialog.locator('[data-testid="add-variable-btn"]').click()
  const newRow = newEntityVariableRow(dialog)
  await setEntityRowType(page, newRow, 'Array')

  const s = await openEntityValue(page, newRow)
  await expect(s.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
  await s.locator('[data-testid="array-add-item"]').click()
  await s.locator('[data-testid="array-edit-input-0"]').fill('alpha')
  await s.locator('[data-testid="array-add-item"]').click()
  await s.locator('[data-testid="array-edit-input-1"]').fill('beta')
  await s.locator('[data-testid="value-editor-save-button"]').click()
  await s.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(s).toBeHidden()
  await expect(entityValueCell(newRow)).toContainText('2 items')

  await newRow.locator('[data-testid="variable-name-input"]').fill(name)
}

/** After reopening, the array cell shows its summary and never a one-line JSON error. */
async function expectArrayRoundTrip(dialog: Locator, name: string) {
  const namedRow = await entityVariableRow(dialog, name)
  await expect(entityValueCell(namedRow)).toContainText('2 items')
  await expect(
    dialog.getByText(/Must be valid JSON format|Must be a JSON array/i),
    'the Visual body never surfaces the one-line JSON validation error',
  ).toHaveCount(0)
}

// ===========================================================================
// Suite
// ===========================================================================

test.describe('V-ENTITY-VARIABLE-EDITOR: entity-scope value editing on the shared bodies', () => {
  test('Suite: add array via Visual body; secret clear-and-edit; integer exact text', async ({
    page,
    request,
  }) => {
    const suiteId = await createEntity(request, '/suites', {
      name: `EVE Suite ${Date.now()}`,
      variables: {
        count: { type: 'integer', value: '5', secret: false },
        token: { type: 'string', value: 'old-secret', secret: true },
      },
    })

    const dialog = await openEntityVariables(page, 'suite', suiteId)

    // Integer numeric fidelity: re-enter a precision-exceeding integer inline.
    const BIG_INT = '1234567890123456789'
    const countInput = (await entityVariableRow(dialog, 'count')).locator('[data-testid="scalar-edit-input"]')
    await expect(countInput).toHaveValue('5')
    await countInput.fill(BIG_INT)

    // Secret string clear-and-edit: masked affordance -> confirm clears -> sheet -> new value.
    const tokenMask = (await entityVariableRow(dialog, 'token')).locator('button[aria-label="Edit protected value"]')
    await expect(tokenMask).toBeVisible()
    await expect(tokenMask).toContainText('•')
    await expect(tokenMask).not.toContainText('old-secret')
    await tokenMask.click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: /Delete & Edit/i }).click()
    const s = valueEditorSheet(page)
    await expect(s).toBeVisible()
    await s.locator('.cm-content').first().click()
    await page.keyboard.type('new-secret')
    await s.locator('[data-testid="value-editor-save-button"]').click()
    await s.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(s).toBeHidden()
    // A value typed before the dialog is saved stays visible; it masks again after the save.
    await expect(entityValueCell(await entityVariableRow(dialog, 'token'))).toContainText('new-secret')

    await addArrayVarViaUI(page, dialog, 'hosts')

    await saveVariablesDialog(dialog)

    // Reopen and confirm the round-trips: array preview + exact integer + still-masked secret.
    const reopened = await openEntityVariables(page, 'suite', suiteId)
    await expectArrayRoundTrip(reopened, 'hosts')
    const countRow = await entityVariableRow(reopened, 'count')
    await expect(
      countRow.locator('[data-testid="scalar-edit-input"]'),
      'integer kept exact text through save + reload',
    ).toHaveValue(BIG_INT)
    const tokenRow = await entityVariableRow(reopened, 'token')
    await expect(
      tokenRow.locator('button[aria-label="Edit protected value"]'),
      'edited secret still masked',
    ).toBeVisible()

    await request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // System Variables (settings): the same complex edit via the Visual body.
  // -------------------------------------------------------------------------
  test('System Variables: array authored in the Visual body round-trips', async ({ page, request }) => {
    await clearSystemVariables(request)

    const dialog = await openSystemVariablesOnNewRow(page)

    // The Add button opens the dialog on one new row; make it an array authored in the Visual body.
    const seeded = newEntityVariableRow(dialog)
    await setEntityRowType(page, seeded, 'Array')
    const s = await openEntityValue(page, seeded)
    await expect(s.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
    await s.locator('[data-testid="array-add-item"]').click()
    await s.locator('[data-testid="array-edit-input-0"]').fill('alpha')
    await s.locator('[data-testid="array-add-item"]').click()
    await s.locator('[data-testid="array-edit-input-1"]').fill('beta')
    await s.locator('[data-testid="value-editor-save-button"]').click()
    await s.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(s).toBeHidden()
    await seeded.locator('[data-testid="variable-name-input"]').fill('hosts')
    await expect(entityValueCell(seeded)).toContainText('2 items')

    await saveVariablesDialog(dialog)

    // Persisted as an actual array via the API (verbatim entity storage).
    const vars = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
    expect(Array.isArray(vars.hosts.value), `hosts stored as array: ${JSON.stringify(vars.hosts)}`).toBeTruthy()
    expect(vars.hosts.value).toEqual(['alpha', 'beta'])

    // Reopen and confirm the cell round-trips with no JSON error.
    const reopened = await openSystemVariables(page)
    await expectArrayRoundTrip(reopened, 'hosts')

    await clearSystemVariables(request)
  })

  // -------------------------------------------------------------------------
  // The same complex edit via the Visual body.
  // -------------------------------------------------------------------------
  test('Regression: array authored in the Visual body round-trips', async ({ page, request }) => {
    const regressionId = await createEntity(request, '/regressions', { name: `EVE Reg ${Date.now()}` })

    const dialog = await openEntityVariables(page, 'regression', regressionId)
    await addArrayVarViaUI(page, dialog, 'hosts')
    await saveVariablesDialog(dialog)

    const reopened = await openEntityVariables(page, 'regression', regressionId)
    await expectArrayRoundTrip(reopened, 'hosts')

    await request.delete(`${BACKEND_URL}/regressions/${regressionId}`).catch(() => {})
  })
})
