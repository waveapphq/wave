/**
 * V-VAR-CREATE-CYCLE-FUNCTIONAL: a self-referencing expression in the create
 * modal surfaces the cycle path inline and disables Create.
 *
 * Phase: functional-workflow (bare /workbench, no seed).
 * "+ Add" opens the floating create modal; the expression nature is a Kind
 * (Literal / Expression / Template), not the legacy `expression-toggle`. The
 * cycle gate is `useInspectCreate` -> `create-cycle-error` + Create disabled.
 *
 * Pass Criteria:
 * 1. Open the create modal. Name `selfvar`, type integer, Kind = Expression,
 *    expression `selfvar + 1`, blur.
 * 2. `create-cycle-error` shows exactly:
 *    "Circular reference detected for variable 'selfvar': selfvar -> selfvar".
 * 3. Create is disabled.
 * 4. Fix to `1 + 1`: the error clears and Create re-enables.
 * 5. Create succeeds; the row appears.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import {
  openCreateModal,
  setCreateName,
  setCreateType,
  setCreateKind,
  createModal,
  variableRow,
} from '../../helpers/variable-create'

test.describe('Create-variable cycle gate (V-VAR-CREATE-CYCLE-FUNCTIONAL)', () => {
  test('inline cycle error blocks Create until the expression is fixed', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const modal = await openCreateModal(page)
    await setCreateName(page, 'selfvar')
    await setCreateType(page, 'integer')
    await setCreateKind(page, 'Expression')

    const cm = modal.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('selfvar + 1')
    // Blur the expression editor (click the name input) so the cycle check runs.
    await modal.locator('[data-testid="create-variable-name"]').click()

    const cycleError = modal.locator('[data-testid="create-cycle-error"]')
    await expect(cycleError).toBeVisible()
    await expect(cycleError).toHaveText(
      "Circular reference detected for variable 'selfvar': selfvar -> selfvar",
    )
    await expect(cycleError).toHaveAttribute('role', 'alert')

    const createButton = modal.locator('[data-testid="create-submit-button"]')
    await expect(createButton).toBeDisabled()

    // Fix the expression - the error clears on edit and Create re-enables.
    await cm.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('1 + 1')
    await expect(cycleError).not.toBeVisible()
    await expect(createButton).toBeEnabled()

    await createButton.click()
    await expect(createModal(page)).toBeHidden()
    await expect(variableRow(page, 'selfvar')).toBeVisible()
  })
})
