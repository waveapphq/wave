/**
 * V-VARSET-VALUE-FIELD-OVERFLOW: Variable Setter string value field truncates a long
 * value instead of spilling onto its sibling controls.
 *
 * The Variable Setter row and the Profile parameter cell share the SAME value
 * affordance (`components/shared/variable-bodies/value-field.tsx`) - a plain truncating
 * <button>, NOT the shadcn Button. A long
 * string preview must therefore truncate with an ellipsis INSIDE its bounded value field
 * and never push onto the sibling `{}` expression toggle or the trash button. The profile
 * half of this contract is asserted in profiles/v-prof-param-cell.spec.ts (S2); together
 * they prove the extracted shared component cannot drift on either surface.
 *
 * Phase: no-data (parallel) - drops a Var Setter; no backend data needed.
 * Design Decisions: none (setter parity, shared ValueField extraction).
 *
 * Pass Criteria:
 * 1. After setting a 60+ char string value via the "Edit value" sheet, the row's value
 *    field (`varset-edit-value-0`) shows a truncating preview (span.truncate).
 * 2. The value field's right edge does NOT overlap the `{}` expression toggle.
 * 3. The value field's right edge stays inside the config sheet (no spill outside).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

const LONG_VALUE = '{{ s1 * 2 }} ' + 't'.repeat(60)

async function dropVarSetterAndOpenConfig(page: Page): Promise<Locator> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'var setter', testId: 'palette-item-variable-setter' },
    { x: cb!.width / 2, y: cb!.height / 2 },
  )
  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function rightEdge(loc: Locator): Promise<number> {
  return loc.evaluate((el) => el.getBoundingClientRect().right)
}
async function leftEdge(loc: Locator): Promise<number> {
  return loc.evaluate((el) => el.getBoundingClientRect().left)
}

test.describe('V-VARSET-VALUE-FIELD-OVERFLOW: long string value truncates inside the setter row', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await waitForCanvasLoad(page)
  })

  test('S1: a long string value truncates inside the value field, not onto the {} toggle or trash', async ({
    page,
  }) => {
    const modal = await dropVarSetterAndOpenConfig(page)

    // Default row 0 is a string -> open the shared "Edit value" sheet and enter a
    // long single-token value, then save it back into the row.
    await modal.locator('[data-testid="varset-edit-value-0"]').click()
    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()
    await sheet.locator('.cm-content').first().click()
    await page.keyboard.type(LONG_VALUE)
    await sheet.locator('[data-testid="value-editor-save-button"]').click()
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).toBeHidden()

    const editBtn = modal.locator('[data-testid="varset-edit-value-0"]')
    await expect(editBtn).toBeVisible()
    await expect(editBtn).toContainText('{{ s1 * 2 }}')

    // (1) The preview span truncates (ellipsis) rather than stretching the row.
    await expect(editBtn.locator('span.truncate')).toHaveCount(1)

    // (2) The value field does not overlap the sibling `{}` expression toggle.
    const btnRight = await rightEdge(editBtn)
    const toggleLeft = await leftEdge(modal.locator('[data-testid="varset-expression-toggle-0"]'))
    expect(btnRight, 'value field must not spill onto the {} toggle').toBeLessThanOrEqual(toggleLeft + 1)

    // (3) The value field stays inside the config sheet (no spill outside the modal).
    const modalRight = await rightEdge(modal)
    expect(btnRight).toBeLessThanOrEqual(modalRight + 1)
  })
})
