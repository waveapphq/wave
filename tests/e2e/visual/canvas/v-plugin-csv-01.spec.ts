/**
 * V-PLUGIN-CSV-01: CSV Parser config sheet.
 *
 * Phase: no-data (parallel) - plugin metadata is hardcoded, no backend data needed.
 * REQ: REQ-3.4.1.12 CSV Parser plugin
 *
 * Pins every config-modal decision:
 *   V-a  {} expression toggle appears ONLY on CSV Content + Delimiter
 *   V-b  Operation is a dropdown with no required * and no {} toggle
 *   V-c  Column types / Empty cells / On type mismatch / Has header row have no {} toggle
 *   V-d  Column types = Schema reveals a required Schema source variable picker (no {} toggle)
 *   V-e  Transform = two collapsibles (Sorts / Filters), each with an (i) tooltip + count
 *   V-f  Sort row: Name/Index + value + Ascending/Descending + reorder + delete; "Add Sort"
 *   V-g  Column ref: switching Name<->Index clears the value; Index mode takes digits only
 *   V-h  Filter block: [Name/Index][value] as [Type] + delete; conditions [operator][value][{}];
 *        Add Literal / Add Expression; a literal {} toggle swaps to an expression editor;
 *        the expression placeholder is `_cell != None`; two blocks show an AND pill
 *   V-i  Outputs are operation-specific: PARSE = Table/Row Count/Schema/Success/Errors;
 *        SERIALIZE = CSV Content/Success/Errors
 *   V-j  Every output Secret checkbox is enabled and checkable, including the boolean Success
 *   V-k  The Secrets collapsible is present for the CSV plugin
 *   V-l  The Schema output is named "Schema" (Array), never "headers"
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

async function openCsvConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'csv', testId: 'palette-item-csv-parser' },
    { x: box!.width / 2, y: box!.height / 2 },
  )

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function setEnum(
  page: Page,
  modal: Locator,
  paramName: string,
  optionLabel: string,
): Promise<void> {
  await modal.locator(`[data-testid="param-row-${paramName}"]`).getByRole('combobox').click()
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
}

const exprToggle = (modal: Locator, param: string) =>
  modal.locator(`[data-testid="param-row-${param}"] [data-testid="expression-toggle"]`)

async function expandSection(modal: Locator, testId: string): Promise<void> {
  const trigger = modal.locator(`[data-testid="${testId}-trigger"]`)
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click()
  }
}

test.describe('V-PLUGIN-CSV-01: CSV Parser config sheet', () => {
  test('V-a/b/c: expression toggle only on CSV Content + Delimiter; enums/boolean/operation have none', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)

    // V-a: the {} toggle appears on the free-text string inputs...
    await expect(exprToggle(modal, 'csv_content')).toBeVisible()
    await expect(exprToggle(modal, 'delimiter')).toBeVisible()

    // V-b + V-c: ...and NOT on the operation dropdown, the enums, or the boolean.
    for (const param of ['operation', 'column_types', 'empty_cells', 'on_mismatch', 'has_header']) {
      await expect(exprToggle(modal, param)).toHaveCount(0)
    }

    // V-b: Operation is a dropdown and is not required (no asterisk).
    await expect(
      modal.locator('[data-testid="param-row-operation"]').getByRole('combobox'),
    ).toBeVisible()
    await expect(
      modal.locator('[data-testid="param-row-operation"]').getByText('*', { exact: true }),
    ).toHaveCount(0)
  })

  test('V-d: Column types = Schema reveals a required Schema source picker with no {} toggle', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)

    // Hidden until schema mode is chosen.
    await expect(modal.locator('[data-testid="param-row-schema_source"]')).toHaveCount(0)

    await setEnum(page, modal, 'column_types', 'Schema')

    const row = modal.locator('[data-testid="param-row-schema_source"]')
    await expect(row).toBeVisible()
    await expect(row.getByText('*', { exact: true })).toHaveCount(1) // required
    await expect(row.locator('[data-testid="expression-toggle"]')).toHaveCount(0) // no {}
    // Existing-only variable picker (a combobox), not a free-text literal input.
    await expect(row.getByRole('combobox')).toBeVisible()
  })

  test('V-e/f: Transform shows Sorts + Filters collapsibles with (i) + count; sort row anatomy', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)

    // V-e: two labeled collapsibles, each with an (i).
    await expect(modal.locator('[data-testid="csv-sorts-section-trigger"]')).toContainText('Sorts')
    await expect(modal.locator('[data-testid="csv-sorts-section-info"]')).toBeVisible()
    await expect(modal.locator('[data-testid="csv-filters-section-trigger"]')).toContainText('Filters')
    await expect(modal.locator('[data-testid="csv-filters-section-info"]')).toBeVisible()

    // (i) tooltip renders fully on hover (portaled; not clipped by the collapsible overflow).
    await modal.locator('[data-testid="csv-sorts-section-info"]').hover()
    await expect(
      page.getByText('Order the rows by one or more columns.', { exact: false }),
    ).toBeVisible()

    // V-f: expand Sorts, add a row, assert its anatomy + the count.
    await expandSection(modal, 'csv-sorts-section')
    const addSort = modal.locator('[data-testid="sort-add-button"]')
    await expect(addSort).toContainText('Add Sort')
    await addSort.click()

    const sortRow = modal.locator('[data-testid^="sort-row-"]').first()
    await expect(sortRow.locator('[data-testid="column-ref-mode"]')).toBeVisible()
    await expect(sortRow.locator('[data-testid="column-ref-value"]')).toBeVisible()
    await expect(sortRow.locator('[data-testid^="sort-direction-"]')).toContainText('Ascending')
    await expect(sortRow.locator('[data-testid^="sort-move-up-"]')).toBeVisible()
    await expect(sortRow.locator('[data-testid^="sort-move-down-"]')).toBeVisible()
    await expect(sortRow.locator('[data-testid^="sort-delete-"]')).toBeVisible()

    // V-e: the count reflects the one key.
    await expect(modal.locator('[data-testid="csv-sorts-section-count"]')).toHaveText('1 keys')
  })

  test('V-g: column ref clears the value on a Name<->Index switch and Index mode takes digits only', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)
    await expandSection(modal, 'csv-sorts-section')
    await modal.locator('[data-testid="sort-add-button"]').click()

    const sortRow = modal.locator('[data-testid^="sort-row-"]').first()
    const value = sortRow.locator('[data-testid="column-ref-value"]')
    await value.fill('score')
    await expect(value).toHaveValue('score')

    // Switch Name -> Index: the value clears (a name and an index are not interchangeable).
    await sortRow.locator('[data-testid="column-ref-mode"]').click()
    await page.getByRole('option', { name: 'Index', exact: true }).click()
    await expect(value).toHaveValue('')

    // Index mode takes digits only: each letter, minus and dot is refused as it is typed (one number rule).
    await value.click()
    await value.pressSequentially('a1b2c3')
    await expect(value).toHaveValue('123')
    await value.pressSequentially('-.4')
    await expect(value).toHaveValue('1234')
  })

  test('V-h: filter block anatomy, Add Literal/Expression, {} swaps to expression editor, AND pill', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)
    await expandSection(modal, 'csv-filters-section')

    await modal.locator('[data-testid="filter-add-block"]').click()
    const block = modal.locator('[data-testid^="filter-block-"]').first()
    await expect(block.locator('[data-testid="column-ref-mode"]')).toBeVisible()
    await expect(block.locator('[data-testid^="filter-astype-"]')).toBeVisible()
    await expect(block.locator('[data-testid^="filter-delete-block-"]')).toBeVisible()

    // Add a literal condition: operator + value + {} toggle.
    await block.locator('[data-testid^="filter-add-literal-"]').click()
    const cond = modal.locator('[data-testid^="filter-condition-operator-"]').first()
    await expect(cond).toBeVisible()
    const condValue = modal.locator('[data-testid^="filter-condition-value-"]').first()
    await expect(condValue).toBeVisible()
    const condExprToggle = modal.locator('[data-testid^="filter-condition-expr-toggle-"]').first()
    await expect(condExprToggle).toBeVisible()

    // The {} toggle swaps the literal value into an expression editor (CodeMirror).
    await condExprToggle.click()
    await expect(block.locator('.cm-editor')).toBeVisible()

    // Add Expression: a per-row predicate over `_cell` with the placeholder.
    await block.locator('[data-testid^="filter-add-expression-"]').click()
    await expect(block.getByText('_cell != None')).toBeVisible()

    // Two blocks AND together (inter-block AND pill).
    await modal.locator('[data-testid="filter-add-block"]').click()
    await expect(
      modal.locator('[data-testid="csv-filters-section-count"]'),
    ).toHaveText('2 columns')
    await expect(modal.locator('[data-testid^="filter-block-"]').nth(1)).toBeVisible()
    await expect(modal.getByText('AND', { exact: true }).first()).toBeVisible()
  })

  test('V-i: outputs are operation-specific (Parse vs Serialize)', async ({ page }) => {
    const modal = await openCsvConfig(page)

    // Parse: the table trio + success/errors, and NO csv_content.
    for (const name of ['table', 'row_count', 'schema', 'success', 'errors']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toBeVisible()
    }
    await expect(modal.locator('[data-testid="output-row-csv_content"]')).toHaveCount(0)

    // Flip to Serialize: csv_content + success/errors, and NO table trio.
    await setEnum(page, modal, 'operation', 'Serialize')
    for (const name of ['csv_content', 'success', 'errors']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toBeVisible()
    }
    for (const name of ['table', 'row_count', 'schema']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toHaveCount(0)
    }
  })

  test('V-j/k/l: every output Secret checkbox is enabled (incl. boolean Success); Secrets present; Schema not "headers"', async ({
    page,
  }) => {
    const modal = await openCsvConfig(page)

    // V-j: every output's Secret checkbox is enabled, and the boolean Success one is checkable.
    for (const name of ['table', 'row_count', 'schema', 'success', 'errors']) {
      await expect(modal.locator(`[data-testid="output-secret-${name}"]`)).toBeEnabled()
    }
    const successSecret = modal.locator('[data-testid="output-secret-success"]')
    await successSecret.click()
    await expect(successSecret).toBeChecked()

    // V-k: the Secrets collapsible is present for the CSV plugin.
    await expect(modal.locator('[data-testid="secrets-section-trigger"]')).toBeVisible()

    // V-l: the Schema output is named "Schema" (array type), never "headers".
    const schemaRow = modal.locator('[data-testid="output-row-schema"]')
    await expect(schemaRow).toContainText('Schema')
    await expect(schemaRow).toContainText('array') // Type cell renders the type lowercase
    await expect(modal.locator('[data-testid="output-row-headers"]')).toHaveCount(0)
  })
})
