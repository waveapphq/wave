/**
 * V-CANVAS-FN-PARAM-DELETE-01: Delete input/output/variable rows inside drilled-in Function
 *
 * Wireframes: none (Var Manager row affordances).
 * Design Decisions: none (single shared dialog, drill-aware mutation)
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1
 *
 * `handleVariableDelete` routes param ids by prefix to removeInputParam / removeOutputParam,
 * looks rows up in displayVariables, and writes to the active subtree.
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   1. Seeded Function has 1 input + 1 output + 1 Function-local variable.
 *      Drilling reveals all three under PARAMETERS / INPUTS, PARAMETERS /
 *      OUTPUTS, and VARIABLES respectively.
 *   2. Clicking each row's delete button removes it from the panel.
 *   3. After deleting all three, PARAMETERS / INPUTS, PARAMETERS / OUTPUTS,
 *      and VARIABLES are all empty.
 *   4. Save the Test, reload, drill back in - all three rows are still gone
 *      (deletion persisted through `PUT /tests/{id}`).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-PARAM-DELETE-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
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

async function deleteRowById(page: Page, rowId: string) {
  const row = page.locator(`[data-testid="variable-row-${rowId}"]`)
  await expect(row).toBeVisible()
  // Hover the row so the action cluster is interactive.
  await row.hover()
  await row.locator(`[data-testid="delete-button-${rowId}"]`).click()
  // Every row delete - even unreferenced - opens the confirmation dialog.
  const dialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
}

test.describe('V-CANVAS-FN-PARAM-DELETE-01: delete inner param + var rows', () => {
  test('delete input + output + local; save; reload; rows stay gone', async ({ page, request }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)
    await drillIn(page)

    // Seeded rows are all present.
    await expect(page.locator('[data-testid="in-badge-param:input:user_id"]')).toBeVisible()
    await expect(page.locator('[data-testid="out-badge-param:output:result"]')).toBeVisible()
    const variablesGroup = page.locator('[data-testid="var-group-variables"]')
    await expect(variablesGroup).toBeVisible()
    const tmpRow = variablesGroup.locator('[data-testid^="variable-row-"]').filter({ hasText: 'tmp' }).first()
    await expect(tmpRow).toBeVisible()
    const tmpRowTestId = (await tmpRow.getAttribute('data-testid'))!
    const tmpRowId = tmpRowTestId.replace('variable-row-', '')

    // Deleting an Input row inside a drilled-in Function removes it.
    await deleteRowById(page, 'param:input:user_id')
    // Same for Output rows.
    await deleteRowById(page, 'param:output:result')
    // Same for Function-local Variable rows.
    await deleteRowById(page, tmpRowId)

    // All three groups are empty now.
    await expect(page.locator('[data-testid="in-badge-param:input:user_id"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="out-badge-param:output:result"]')).toHaveCount(0)
    await expect(variablesGroup.getByText('tmp', { exact: true })).toHaveCount(0)

    // Save the Test.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Reload + drill back in.
    await openTest(page, testId)
    await drillIn(page)

    await expect(page.locator('[data-testid="in-badge-param:input:user_id"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="out-badge-param:output:result"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="var-group-variables"]').getByText('tmp', { exact: true })).toHaveCount(0)
  })
})
