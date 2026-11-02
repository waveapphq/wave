/**
 * V-TABLE-RUNTIME-FORMS: both runtime forms of a table reach every consumer.
 *
 * REQ: REQ-3.5.1.16 (For Each over a table), REQ-3.4.1.14 (Variable Setter),
 *      REQ-3.4.3.3 (table variables)
 *
 * A table reaches a consumer either as a live table produced by a converter, or
 * as the stored form of a variable declared in the Variable Manager. Each consumer
 * must handle both.
 *
 * Guards:
 *   - For Each over a converter's table output
 *   - Variable Setter storing a converter's table (and a derived table)
 *   - CSV Serialize of a declared table variable
 *   - CSV schema mode driven by a declared table variable
 *   - the collection row's type selector follows the variable it binds
 *
 * Assertions anchor on emitted console output, run status and the persisted
 * config surface - never on an element merely rendering.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/table-runtime-forms/v-table-runtime-forms-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment, configSheet } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `${name}.fixture.json`), 'utf-8'),
  ) as Record<string, unknown>
}

async function runToTerminal(page: Page): Promise<string> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

async function runAndExpectLines(page: Page, fixture: string, expected: string[]): Promise<void> {
  await importValidateAndNavigate(page, loadFixture(fixture))

  const status = await runToTerminal(page)
  const logs = await getLogTexts(page)
  if (status !== 'passed') {
    const lines = await getLogLines(page)
    test.info().annotations.push({
      type: 'error-logs',
      description: JSON.stringify(lines.slice(-20)),
    })
  }
  expect(status, `workflow ${fixture} must pass`).toBe('passed')

  const missing = expected.filter((line) => !logs.includes(line))
  expect(
    missing,
    `Missing expected console lines for ${fixture}:\n${JSON.stringify(missing, null, 2)}\n\nGot:\n${logs.join('\n')}`,
  ).toEqual([])
}

// ---------------------------------------------------------------------------
// For Each iterates the rows of a converter's table output.
// ---------------------------------------------------------------------------

test('For Each iterates a plugin-produced table row by row', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'loop-plugin-table', [
    'loop-row-A-1-3-at-0',
    'loop-row-B-2-7-at-1',
    'loop-done',
  ])
})

// ---------------------------------------------------------------------------
// The Variable Setter stores a converter's table and a derived table.
// ---------------------------------------------------------------------------

test('Variable Setter stores a plugin-produced table and a derived one', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'setter-plugin-table', [
    'stored-A-1-rows-2',
    'derived-B-2-rows-1',
  ])
})

// ---------------------------------------------------------------------------
// CSV Serialize accepts a table variable declared in the Variable Manager.
// ---------------------------------------------------------------------------

test('CSV Serialize accepts a declared table variable', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'csv-serialize-declared-table', [
    'declared-csv=sku,qty~A-1,3~B-2,7~',
  ])
})

// ---------------------------------------------------------------------------
// CSV schema mode accepts a declared table variable as its schema source.
// ---------------------------------------------------------------------------

test('CSV schema mode accepts a declared table variable as the schema source', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'csv-schema-declared-table', [
    'declared-schema=id:integer,name:string-rows-1',
  ])
})

// ---------------------------------------------------------------------------
// The collection row's type selector follows the variable it binds.
// ---------------------------------------------------------------------------

test('a bound table variable leaves the collection row consistent and runnable', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await importValidateAndNavigate(page, loadFixture('foreach-collection-type'))

  await page
    .locator('[data-testid="workflow-node-foreach-bound"]')
    .locator('button')
    .first()
    .dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })

  const collectionRow = sheet.locator('[data-testid="param-row-collection"]')
  await expect(collectionRow).toBeVisible()

  // The row describes the variable it binds instead of contradicting it.
  await expect(collectionRow.locator('[data-testid="type-select-collection"]')).toContainText(
    'table',
  )
  await expect(collectionRow.getByRole('alert')).toHaveCount(0)
  // A row-level mismatch blocks the whole form, so an enabled Save proves the
  // configuration is genuinely consistent and not merely silent. Save needs a
  // change to be alive at all, so the description carries one.
  await sheet.locator('[data-testid="element-description-input"]').fill('bound collection')
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()

  // Closing the config discards that edit, leaves the binding intact, and the
  // loop runs over the rows.
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByTestId('unsaved-close').click()
  await expect(sheet).toBeHidden()

  const status = await runToTerminal(page)
  const logs = await getLogTexts(page)
  expect(status, `bound-collection workflow must pass. Logs:\n${logs.join('\n')}`).toBe('passed')
  expect(logs).toContain('bound-row-A-1')
  expect(logs).toContain('bound-row-B-2')
  expect(logs).toContain('bound-loop-done')
})

// ---------------------------------------------------------------------------
// Shaping on the way out. Sorts and filters apply to the table a
// converter writes, and the table parameter accepts a fluent expression.
// The source variable must keep every row - shaping the output must never
// rewrite what the workflow holds.
// ---------------------------------------------------------------------------

test('Excel Write shapes the workbook without touching the source table', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'excel-write-transform', [
    // Multi-key sort (region asc, amount desc) with amount > 5 dropping east-5.
    'xlsx-regions=east,west,west amounts=[20, 30, 10]',
    'xlsx-source-rows=4',
  ])
})

test('CSV Serialize shapes the text without touching the source table', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'csv-serialize-transform', [
    'csv-shaped=region,amount~west,30~west,10~',
    'csv-source-rows=4',
  ])
})

test('the table parameter accepts a fluent filter/order_by chain', async ({ page }) => {
  test.setTimeout(120_000)

  await runAndExpectLines(page, 'table-field-expression', [
    'expr-csv=region,amount~west,30~east,20~west,10~',
    'xlsx-expr-regions=east,east amounts=[5, 20]',
  ])
})
