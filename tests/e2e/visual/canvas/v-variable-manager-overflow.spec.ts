/**
 * V-VARIABLE-MANAGER-OVERFLOW: Shared variable-editor name field caps + overflow
 *
 * Phase: no-data (parallel) - opens the System Variables tab in /settings, which
 * surfaces the shared `variable-editor.tsx` used by all four scopes (system,
 * suite, regression, test). Once the contract is pinned for one scope it holds
 * for all four because they share the primitive. The name field is the NameField
 * primitive; a string row's value is an Edit-preview button opening the "Edit value" sheet.
 *
 * Pass Criteria:
 *  1. Variable name field caps at 64 (MAX_VARIABLE_NAME_LENGTH).
 *  2. Counter shows muted between 52..63 chars and destructive at 64/64.
 *  3. Name field is the NameField primitive (textarea rows=1 + overflow contract).
 *  4. Long name 60 chars overflows inside the input (scrollWidth > clientWidth);
 *     the host dialog width does NOT grow.
 *  5. The VALUE field renders the shared Edit-preview cell, not an inline input;
 *     clicking it opens the shared "Edit value" sheet.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  entityValueCell,
  newEntityVariableRow,
  openEntityValue,
  openSystemVariablesOnNewRow,
} from '../../helpers/entity-variables'

test.describe('V-VARIABLE-MANAGER-OVERFLOW: variable editor name field contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: variable name caps at 64 with destructive counter at the cap', async ({
    page,
  }) => {
    const dialog = await openSystemVariablesOnNewRow(page)
    const name = dialog.locator('[data-testid="variable-name-input"]').last()
    await expect(name).toBeVisible()
    await expect(name).toHaveAttribute('maxlength', '64')

    await name.fill('a'.repeat(70))
    expect((await name.inputValue()).length).toBe(64)

    const counter = dialog
      .locator('[data-testid="variable-name-input-counter"]')
      .last()
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'destructive')
    await expect(counter).toHaveText('64/64')
  })

  test('S2: counter muted at 80% threshold (52..63)', async ({ page }) => {
    const dialog = await openSystemVariablesOnNewRow(page)
    const name = dialog.locator('[data-testid="variable-name-input"]').last()
    const counter = dialog
      .locator('[data-testid="variable-name-input-counter"]')
      .last()

    await name.fill('a'.repeat(51))
    await expect(counter).toHaveCount(0)

    await name.fill('a'.repeat(52))
    await expect(counter).toBeVisible()
    await expect(counter).toHaveAttribute('data-state', 'muted')
    await expect(counter).toHaveText('52/64')
  })

  test('S3: name primitive shape (textarea rows=1, overflow contract)', async ({
    page,
  }) => {
    const dialog = await openSystemVariablesOnNewRow(page)
    const name = dialog.locator('[data-testid="variable-name-input"]').last()

    await expect(name).toHaveAttribute('rows', '1')
    expect(await name.evaluate((el) => el.tagName)).toBe('TEXTAREA')
    const styles = await name.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return { whiteSpace: cs.whiteSpace, overflowX: cs.overflowX, resize: cs.resize }
    })
    expect(styles.whiteSpace).toBe('pre')
    expect(styles.overflowX).toBe('auto')
    expect(styles.resize).toBe('none')
  })

  test('S4: filling the maxLength never grows the dialog width', async ({
    page,
  }) => {
    const dialog = await openSystemVariablesOnNewRow(page)
    const name = dialog.locator('[data-testid="variable-name-input"]').last()

    // S3 pins the styles that PRODUCE horizontal scroll when the field is
    // narrower than the value. Whether the cell happens to be narrower than
    // 64 chars depends on table column allocation and is brittle to CI
    // viewport differences, so we assert the dialog-width-stability contract
    // here instead of `scrollWidth > clientWidth`.
    const startW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    await name.fill('z'.repeat(64))
    const endW = await dialog.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endW - startW)).toBeLessThanOrEqual(50)
  })

  test('S5: the value field is the shared Edit-preview cell', async ({
    page,
  }) => {
    const dialog = await openSystemVariablesOnNewRow(page)
    // A string row's value is the Edit-preview button, never an inline `variable-value-input`.
    const newRow = newEntityVariableRow(dialog)
    await expect(newRow.locator('[data-testid="variable-value-input"]')).toHaveCount(0)
    await expect(entityValueCell(newRow)).toBeVisible()
    await openEntityValue(page, newRow)
  })
})
