/**
 * V-TABLE-EXPR-OPS-01: the table type's query operations in the expression editor.
 *
 * Phase: no-data (parallel) - seeds its own Test via POST /tests, no DB reset.
 * REQ: REQ-3.1.3.13 (expressions over variables), REQ-3.4.1.13 / REQ-3.4.1.12
 *      (the converters whose tables these operations shape)
 *
 * The engine carries non-mutating filtering and ordering on the table type,
 * and the editor's method catalog lists them so the validator accepts them.
 * This spec covers the completion side; the "it validates clean and runs" side
 * lives in tests/e2e/functional/table-expression-guards/.
 *
 * Pass Criteria:
 *   1. a table variable offers its query operations (filter, order_by, col)
 *   2. naming a column offers that column's operators (equals, greater_than,
 *      contains, ...), which is the step a filter returns
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import fs from 'fs'
import path from 'path'

const FIXTURE = path.resolve(__dirname, '../../fixtures/canvas/v-table-expr-ops-01/fixture.json')
const MESSAGE_ROW = '[data-testid="param-row-message"]'

async function openMessageExpression(page: Page) {
  await page.locator('[data-testid="workflow-node-log-1"] button').first().dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await page.locator(`${MESSAGE_ROW} [data-testid="expression-toggle"]`).click()
  // FIELD-7: Message holds the seeded text, so the switch asks first; Clear empties the {x} box.
  const switchDialog = page.locator('[data-testid="switch-mode-dialog"]')
  await expect(switchDialog).toHaveAccessibleName('Switch the field to an expression?')
  await switchDialog.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(switchDialog).toHaveCount(0)
  await expect(page.locator(`${MESSAGE_ROW} .cm-content`).first()).toBeVisible()
}

async function typeExpression(page: Page, text: string): Promise<string[]> {
  const editor = page.locator(`${MESSAGE_ROW} .cm-content`).first()
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text, { delay: 20 })

  const autocomplete = page.locator('.cm-tooltip-autocomplete')
  await expect(autocomplete).toBeVisible({ timeout: 10_000 })
  return autocomplete.locator('.cm-completionLabel').allTextContents()
}

test.describe('V-TABLE-EXPR-OPS-01: table query operations in the expression editor', () => {
  test('a table offers its query operations, and naming a column offers that column operators', async ({
    page,
  }) => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8')) as Record<string, unknown>
    await importValidateAndNavigate(page, fixture)
    await openMessageExpression(page)

    // 1. The table type's own operations.
    const tableOps = await typeExpression(page, 'orders.')
    for (const op of ['filter', 'order_by', 'col']) {
      expect(
        tableOps.some((label) => label.includes(op)),
        `expected the table to offer '${op}'. Got: ${tableOps.join(', ')}`,
      ).toBeTruthy()
    }

    // 2. The step a filter returns: the named column's operators.
    const columnOps = await typeExpression(page, "orders.filter('qty').")
    for (const op of ['equals', 'greater_than', 'contains']) {
      expect(
        columnOps.some((label) => label.includes(op)),
        `expected the column step to offer '${op}'. Got: ${columnOps.join(', ')}`,
      ).toBeTruthy()
    }
  })
})
