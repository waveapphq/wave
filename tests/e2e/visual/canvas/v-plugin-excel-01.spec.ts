/**
 * V-PLUGIN-EXCEL-01: Excel Parser config sheet.
 *
 * Phase: no-data (parallel) - plugin metadata is hardcoded; the binding fixture
 * seeds its own Test via POST /tests and needs no DB reset.
 * REQ: REQ-3.4.1.13 Excel Parser plugin
 * Design Decisions: XLS-1 through XLS-15, FIELD-2
 *
 * Pass Criteria:
 *   E-a  the palette drops an Excel element carrying the grid Sheet icon in the
 *        Data category, distinct from the CSV element's icon
 *   E-b  Read shows one flat list - Operation, Workbook*, Sheet, Range, Has header
 *        row, Header row, Column types, Empty cells, On type mismatch - with no
 *        collapsible parameter group and a required marker on Workbook only
 *   E-c  Header row is a number field holding 1, shown only while Has header row
 *        is checked
 *   E-d  Column types = Schema reveals a required Schema source variable picker
 *        with no {} toggle
 *   E-e  Transform renders as the Sorts and Filters collapsibles, each with its
 *        (i) tooltip
 *   E-f  Write swaps the form: the read-only rows disappear, Table* / Write header
 *        row / Start cell (gray default A1, FIELD-2) / If the file exists appear, the Table row
 *        carries the {} toggle, and Transform is present
 *   E-g  outputs are operation-specific: Read = Table / Row Count / Schema /
 *        Sheets / Success / Errors; Write = File / Success / Errors
 *   E-h  the enum labels name the direction of conversion and the file policy
 *   E-i  Workbook and Range carry their guidance placeholders
 *   E-j  a saved Test whose Excel Read binds a schema source, whose Excel Write
 *        binds a table and whose CSV Serialize binds a table shows a clean canvas -
 *        no validation badge on any of them
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectGrayDefault } from '../../helpers/default-rule'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BINDINGS_FIXTURE = path.resolve(
  __dirname,
  '../../fixtures/canvas/v-plugin-excel-01/fixture.json',
)

const READ_ONLY_ROWS = [
  'range',
  'has_header',
  'header_row',
  'column_types',
  'empty_cells',
  'on_mismatch',
]
const WRITE_ONLY_ROWS = ['table', 'write_header', 'start_cell', 'if_exists']

async function openExcelConfig(page: Page): Promise<Locator> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'excel', testId: 'palette-item-excel-parser' },
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

test.describe('V-PLUGIN-EXCEL-01: Excel Parser config sheet', () => {
  test('E-a: the palette drops an Excel element with the grid Sheet icon, distinct from CSV', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    await dragPaletteItemToCanvas(
      page,
      { term: 'excel', testId: 'palette-item-excel-parser' },
      { x: box!.width / 3, y: box!.height / 2 },
    )

    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
    await expect(node).toBeVisible()
    // The lucide Sheet glyph renders as an svg carrying its icon class.
    await expect(node.locator('svg.lucide-sheet')).toHaveCount(1)
    // CSV keeps the spreadsheet-file glyph, so the two Data elements never collide.
    await expect(node.locator('svg.lucide-file-spreadsheet')).toHaveCount(0)
  })

  test('E-b/E-c/E-i: the Read form is one flat list with the header-row number field and its placeholders', async ({
    page,
  }) => {
    const modal = await openExcelConfig(page)

    // Field order, top to bottom, exactly as the Read wireframe draws it.
    const rows = modal.locator('[data-testid^="param-row-"]')
    await expect(rows).toHaveCount(9)
    const ids = await rows.evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('param-row-', '')),
    )
    expect(ids).toEqual([
      'operation',
      'workbook',
      'sheet',
      'range',
      'has_header',
      'header_row',
      'column_types',
      'empty_cells',
      'on_mismatch',
    ])

    // Flat list: no parameter group header inside the input section.
    await expect(modal.locator('[data-testid^="group-header-"]')).toHaveCount(0)

    // Required marker on Workbook only.
    await expect(
      modal.locator('[data-testid="param-row-workbook"]').getByText('*', { exact: true }),
    ).toHaveCount(1)
    await expect(
      modal.locator('[data-testid="param-row-operation"]').getByText('*', { exact: true }),
    ).toHaveCount(0)

    // E-i: the two guidance placeholders, shown while the field is empty.
    for (const [name, guidance] of [
      ['workbook', 'artifact://…, testdata://…, or /abs/path'],
      ['range', 'A1:F200'],
    ]) {
      const box = modal.locator(`[data-testid="param-row-${name}"] [data-slot="input-group"] input`)
      await expect(box, `${name} holds no value`).toHaveValue('')
      await expect(box).toHaveAttribute('placeholder', guidance)
    }

    // E-c: Header row is a number field showing its default 1 in gray (FIELD-2), and it follows the checkbox.
    await expectGrayDefault(modal, 'header_row', '1')

    await modal.locator('[data-testid="param-row-has_header"] button[role="checkbox"]').click()
    await expect(modal.locator('[data-testid="param-row-header_row"]')).toHaveCount(0)
    await modal.locator('[data-testid="param-row-has_header"] button[role="checkbox"]').click()
    await expectGrayDefault(modal, 'header_row', '1')
  })

  test('E-d: Column types = Schema reveals a required Schema source picker with no {} toggle', async ({
    page,
  }) => {
    const modal = await openExcelConfig(page)

    await expect(modal.locator('[data-testid="param-row-schema_source"]')).toHaveCount(0)

    await setEnum(page, modal, 'column_types', 'Schema')

    const row = modal.locator('[data-testid="param-row-schema_source"]')
    await expect(row).toBeVisible()
    await expect(row.getByText('*', { exact: true })).toHaveCount(1)
    await expect(row.locator('[data-testid="expression-toggle"]')).toHaveCount(0)
    await expect(row.getByRole('combobox')).toBeVisible()
  })

  test('E-e: Transform renders the Sorts and Filters collapsibles with their tooltips', async ({
    page,
  }) => {
    const modal = await openExcelConfig(page)

    await expect(modal.locator('[data-testid="csv-sorts-section-trigger"]')).toContainText('Sorts')
    await expect(modal.locator('[data-testid="csv-sorts-section-info"]')).toBeVisible()
    await expect(modal.locator('[data-testid="csv-filters-section-trigger"]')).toContainText(
      'Filters',
    )
    await expect(modal.locator('[data-testid="csv-filters-section-info"]')).toBeVisible()
  })

  test('E-f/E-h: Write swaps the rows, keeps Transform, and labels name the direction', async ({
    page,
  }) => {
    const modal = await openExcelConfig(page)

    // E-h: the Read label names the direction of conversion.
    await expect(modal.locator('[data-testid="param-row-operation"]')).toContainText(
      'Read (workbook → table)',
    )

    await setEnum(page, modal, 'operation', 'Write (table → workbook)')

    for (const name of READ_ONLY_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toHaveCount(0)
    }
    for (const name of WRITE_ONLY_ROWS) {
      await expect(modal.locator(`[data-testid="param-row-${name}"]`)).toBeVisible()
    }

    // Workbook stays required, and Table is required on Write.
    await expect(
      modal.locator('[data-testid="param-row-table"]').getByText('*', { exact: true }),
    ).toHaveCount(1)

    // FIELD-2: Start cell shows its default A1 in gray as real text, not as guidance.
    await expectGrayDefault(modal, 'start_cell', 'A1')
    await expect(modal.locator('[data-testid="param-row-start_cell"] [data-slot="input-group"] input')).not.toHaveAttribute(
      'placeholder',
      /./,
    )

    // E-h: the file policy labels.
    await expect(modal.locator('[data-testid="param-row-if_exists"]')).toContainText(
      'Keep other sheets',
    )

    // The written table can be shaped, so the
    // Table row takes an expression and Transform stays on the Write form.
    await expect(exprToggle(modal, 'table')).toBeVisible()
    await expect(modal.locator('[data-testid="csv-sorts-section-trigger"]')).toBeVisible()
    await expect(modal.locator('[data-testid="csv-filters-section-trigger"]')).toBeVisible()
  })

  test('E-g: outputs are operation-specific (Read vs Write)', async ({ page }) => {
    const modal = await openExcelConfig(page)

    for (const name of ['table', 'row_count', 'schema', 'sheets', 'success', 'errors']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toBeVisible()
    }
    await expect(modal.locator('[data-testid="output-row-file"]')).toHaveCount(0)

    await setEnum(page, modal, 'operation', 'Write (table → workbook)')

    for (const name of ['file', 'success', 'errors']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toBeVisible()
    }
    for (const name of ['table', 'row_count', 'schema', 'sheets']) {
      await expect(modal.locator(`[data-testid="output-row-${name}"]`)).toHaveCount(0)
    }
  })

  test('E-j: elements that bind a table variable carry no validation badge', async ({ page }) => {
    const fixture = JSON.parse(fs.readFileSync(BINDINGS_FIXTURE, 'utf-8')) as Record<
      string,
      unknown
    >
    await importValidateAndNavigate(page, fixture)

    for (const id of ['excel-read-schema', 'excel-write-table', 'csv-serialize-table']) {
      await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toBeVisible()
    }
    // A bound variable holds the variable's NAME, not its rows; it never reads as an
    // empty collection.
    await expect(page.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)
  })
})
