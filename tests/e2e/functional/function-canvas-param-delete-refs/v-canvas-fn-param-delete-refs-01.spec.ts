/**
 * V-CANVAS-FN-PARAM-DELETE-REFS-01: delete confirmation dialog when refs exist
 *
 * Wireframes: none (existing ConfirmationDialog surface).
 * Design Decisions: none (Function scope, single shared dialog).
 * REQ: REQ-3.1.2.3 (delete-with-references confirmation).
 *
 * Deleting an input/output/variable inside a drilled-in Function checks references in
 * the inner workflow (`inputRefCounts`, `outputBoundVarSources`), so the row does not
 * delete silently when an inner Log plugin expression names the param/var.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Drilling into Function_1 reveals the input/output/variable rows.
 *   2. Clicking delete on the `fn_input` row opens the `Delete "fn_input"?`
 *      confirmation dialog (description: "The input parameter is used by 1
 *      block - references will become unresolved.").
 *   3. Same for the `fn_output` and `local_var` rows.
 *   4. Clicking Cancel keeps the row visible.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-PARAM-DELETE-REFS-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function drillIn(page: Page) {
  await page.locator('[data-testid="workflow-node-fn-1"] [data-testid="node-dig-in"]').click()
  await expect(page.locator('[data-testid="var-group-parameters"]')).toBeVisible()
}

async function clickRowDelete(page: Page, rowId: string) {
  const row = page.locator(`[data-testid="variable-row-${rowId}"]`)
  await expect(row).toBeVisible()
  await row.hover()
  await row.locator(`[data-testid="delete-button-${rowId}"]`).click()
}

async function expectConfirmDialogWithDescription(page: Page, descriptionFragment: string) {
  const dialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  await expect(dialog).toContainText(descriptionFragment)
  return dialog
}

async function cancelDialog(page: Page) {
  const dialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

test.describe('V-CANVAS-FN-PARAM-DELETE-REFS-01: delete confirmation for referenced rows', () => {
  test('input/output/variable delete prompts confirmation when inner workflow references them', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    // Seeded rows are present in their respective groups.
    const inputRow = page.locator('[data-testid="variable-row-param:input:fn_input"]')
    const outputRow = page.locator('[data-testid="variable-row-param:output:fn_output"]')
    const variablesGroup = page.locator('[data-testid="var-group-variables"]')
    const variableRow = variablesGroup.locator('[data-testid^="variable-row-"]').filter({ hasText: 'local_var' }).first()
    await expect(inputRow).toBeVisible()
    await expect(outputRow).toBeVisible()
    await expect(variableRow).toBeVisible()

    // Input row delete opens the confirmation
    // dialog because an inner Log plugin references `fn_input` in its
    // message expression.
    await clickRowDelete(page, 'param:input:fn_input')
    await expectConfirmDialogWithDescription(page, 'input parameter is used by 1')
    await cancelDialog(page)
    await expect(inputRow).toBeVisible()

    // Output row delete.
    await clickRowDelete(page, 'param:output:fn_output')
    await expectConfirmDialogWithDescription(page, 'output parameter is used by 1')
    await cancelDialog(page)
    await expect(outputRow).toBeVisible()

    // Function-local variable row delete.
    const variableRowTestId = (await variableRow.getAttribute('data-testid'))!
    const variableRowId = variableRowTestId.replace('variable-row-', '')
    await clickRowDelete(page, variableRowId)
    await expectConfirmDialogWithDescription(page, 'variable is used by 1')
    await cancelDialog(page)
    await expect(variableRow).toBeVisible()
  })
})
