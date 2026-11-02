/**
 * V-PLUGIN-XML-01: XML Parser Config Modal
 *
 * Phase: no-data (parallel) - control metadata is hardcoded, no backend data needed
 * REQ: REQ-3.4.1.11 XML processing with XPath support
 *
 * Pass Criteria:
 * 1. XML Parser can be dropped from palette onto canvas
 * 2. Config modal opens with XML Content, Output Mode, Queries
 * 3. Queries section uses custom inline editor (not generic ParameterTable)
 * 4. Empty state: one empty query row with XPath + alias fields
 * 5. Each query row has two lines: XPath + expr toggle, alias + test + delete
 * 6. "Add Query" button inserts new empty row
 * 7. Output Mode radio section shows Combined (default) / Individual (VMGR-92)
 * 8. Individual mode adds type dropdown per query row
 * 9. Delete button removes query row
 * 10. Expression toggle on XPath switches to expression editor
 * 11. Output section: success (boolean), errors (array), results (map)
 * 12. Version shows 1.0.0
 * 13. Details dialog shows documentation
 * 14. Changelog dialog shows entries
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-PLUGIN-XML-01: XML Parser Config Modal', () => {
  // No backend data needed - control metadata is hardcoded
  // Runs in parallel no-data phase

  // Every scenario bare-gotos /workbench; clear the recovered session so a prior spec's draft or finished run does not load.
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
  })

  // Helper to search palette
  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to drop XML Parser on canvas and select it
  async function dropXmlParserAndSelect(page: import('@playwright/test').Page) {
    await expandPalette(page)
    await findItemBySearch(page, 'xml')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'xml', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)

    // Select the node
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const firstNode = workflowNodes.first()
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    return firstNode
  }

  // Helper to open config modal for selected node
  async function openConfigModal(page: import('@playwright/test').Page) {
    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  // ==========================================================================
  // V-PLUGIN-XML-01-S1: Drop XML Parser from palette and open config
  // ==========================================================================

  test('V-PLUGIN-XML-01-S1: XML Parser can be dropped from palette and config modal opens', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Uniform "Edit Config" header (entity name moved to the Name input)
    await expect(modal.getByRole('heading', { level: 2 })).toContainText('Edit Config')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S2: Config modal shows XML Content parameter
  // ==========================================================================

  test('V-PLUGIN-XML-01-S2: XML Content parameter with its editor expand visible', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // XML Content should be shown as a multiline parameter with Edit button
    const xmlContentRow = modal.locator('[data-testid="param-row-xml_content"]')
    await expect(xmlContentRow).toBeVisible()

    // FIELD-1: the one value field with the expand that opens the full editor
    await expect(xmlContentRow.locator('[data-slot="input-group"] input')).toBeVisible()
    const editButton = xmlContentRow.locator('[data-testid="param-expand-xml_content"]')
    await expect(editButton).toBeVisible()
    await expect(editButton).toHaveAccessibleName('Open editor for XML Content')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S4: Output Mode radio section defaults to Combined (VMGR-92)
  // ==========================================================================

  test('V-PLUGIN-XML-01-S4: Output Mode radio section defaults to combined', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // VMGR-92: output_mode is not an Input Parameters row - it is its own
    // Output Mode radio section, defaulting to Combined.
    await expect(modal.locator('[data-testid="param-row-output_mode"]')).toHaveCount(0)
    const combined = modal.locator('#output-mode-combined')
    await expect(combined).toBeVisible()
    await expect(combined).toHaveAttribute('aria-checked', 'true')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S5: Queries section uses custom inline editor
  // ==========================================================================

  test('V-PLUGIN-XML-01-S5: Queries uses custom editor not generic param table', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Generic param-row-queries should NOT be present (custom editor replaces it)
    const genericRow = modal.locator('[data-testid="param-row-queries"]')
    await expect(genericRow).not.toBeVisible()

    // query_output_types should also be hidden
    const typesRow = modal.locator('[data-testid="param-row-query_output_types"]')
    await expect(typesRow).not.toBeVisible()

    // Custom xml-query editor should be present
    const addButton = modal.locator('[data-testid="xml-query-add-button"]')
    await expect(addButton).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S6: Empty state shows one empty query row
  // ==========================================================================

  test('V-PLUGIN-XML-01-S6: empty state shows one query row with XPath and alias fields', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Should have one query row
    const row = modal.locator('[data-testid="xml-query-row-0"]')
    await expect(row).toBeVisible()

    // XPath input should be empty
    const xpathInput = modal.locator('[data-testid="xml-query-xpath-0"]')
    await expect(xpathInput).toBeVisible()
    await expect(xpathInput).toHaveValue('')

    // Alias input should be empty
    const aliasInput = modal.locator('[data-testid="xml-query-alias-0"]')
    await expect(aliasInput).toBeVisible()
    await expect(aliasInput).toHaveValue('')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S7: Query row has two-line layout with all elements
  // ==========================================================================

  test('V-PLUGIN-XML-01-S7: query row has XPath + expr toggle on line 1, alias + test + delete on line 2', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Line 1: XPath input and expression toggle
    const xpathInput = modal.locator('[data-testid="xml-query-xpath-0"]')
    const exprToggle = modal.locator('[data-testid="xml-query-expr-toggle-0"]')
    await expect(xpathInput).toBeVisible()
    await expect(exprToggle).toBeVisible()

    // Line 2: alias, test button, delete button
    const aliasInput = modal.locator('[data-testid="xml-query-alias-0"]')
    const testBtn = modal.locator('[data-testid="xml-query-test-0"]')
    const deleteBtn = modal.locator('[data-testid="xml-query-delete-0"]')
    await expect(aliasInput).toBeVisible()
    await expect(testBtn).toBeVisible()
    await expect(deleteBtn).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S8: Add Query button creates new row
  // ==========================================================================

  test('V-PLUGIN-XML-01-S8: Add Query button inserts a new empty row', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Click Add Query
    const addButton = modal.locator('[data-testid="xml-query-add-button"]')
    await addButton.click()

    // Now there should be two query rows
    const row0 = modal.locator('[data-testid="xml-query-row-0"]')
    const row1 = modal.locator('[data-testid="xml-query-row-1"]')
    await expect(row0).toBeVisible()
    await expect(row1).toBeVisible()

    // Second row should have empty inputs
    const aliasInput1 = modal.locator('[data-testid="xml-query-alias-1"]')
    await expect(aliasInput1).toBeVisible()
    await expect(aliasInput1).toHaveValue('')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S9: Delete button removes query row
  // ==========================================================================

  test('V-PLUGIN-XML-01-S9: delete button removes query row', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Add a second row
    await modal.locator('[data-testid="xml-query-add-button"]').click()
    await expect(modal.locator('[data-testid="xml-query-row-1"]')).toBeVisible()

    // Fill first row so we can identify it
    await modal.locator('[data-testid="xml-query-alias-0"]').fill('first_query')

    // Delete first row
    await modal.locator('[data-testid="xml-query-delete-0"]').click()

    // Only one row should remain
    await expect(modal.locator('[data-testid="xml-query-row-0"]')).toBeVisible()
    await expect(modal.locator('[data-testid="xml-query-row-1"]')).not.toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S10: Expression toggle switches XPath to expression editor
  // ==========================================================================

  test('V-PLUGIN-XML-01-S10: expression toggle on XPath switches to expression editor', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Initially in literal mode: regular input visible
    const xpathInput = modal.locator('[data-testid="xml-query-xpath-0"]')
    await expect(xpathInput).toBeVisible()

    // Click expression toggle
    const exprToggle = modal.locator('[data-testid="xml-query-expr-toggle-0"]')
    await exprToggle.click()
    await expect(exprToggle).toHaveAttribute('aria-pressed', 'true')

    // Regular input should be replaced by expression editor (CodeMirror)
    await expect(xpathInput).not.toBeVisible()

    // Expression editor (CodeMirror) should appear within the row
    const row = modal.locator('[data-testid="xml-query-row-0"]')
    await expect(row.locator('.cm-editor')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S11: Output Mode radio can switch to Individual (VMGR-92)
  // ==========================================================================

  test('V-PLUGIN-XML-01-S11: switching output mode to individual shows type dropdown per query', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // In combined mode, type dropdown should not be visible
    const typeSelect = modal.locator('[data-testid="xml-query-type-0"]')
    await expect(typeSelect).not.toBeVisible()

    // Switch Output Mode to individual via the radio (VMGR-92 - not a dropdown).
    await modal.locator('#output-mode-individual').click()
    await expect(modal.locator('#output-mode-individual')).toHaveAttribute('aria-checked', 'true')

    // Now type dropdown should appear per query row
    await expect(typeSelect).toBeVisible()
    await expect(typeSelect).toContainText('String')

    // Results output should disappear in individual mode
    const resultsRow = modal.locator('[data-testid="output-row-results"]')
    await expect(resultsRow).not.toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S12: Output section shows success, errors, results
  // ==========================================================================

  test('V-PLUGIN-XML-01-S12: output section shows success, errors, and results in combined mode', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Output Variables section should exist in combined mode
    const successRow = modal.locator('[data-testid="output-row-success"]')
    const errorsRow = modal.locator('[data-testid="output-row-errors"]')
    const resultsRow = modal.locator('[data-testid="output-row-results"]')

    await expect(successRow).toBeVisible()
    await expect(errorsRow).toBeVisible()
    await expect(resultsRow).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S12a: Individual mode keeps the Queries section, hides Results (VMGR-92)
  // ==========================================================================

  test('V-PLUGIN-XML-01-S12a: individual mode keeps the Queries section and hides Results', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Switch to individual mode via the Output Mode radio (VMGR-92).
    await modal.locator('#output-mode-individual').click()
    await expect(modal.locator('#output-mode-individual')).toHaveAttribute('aria-checked', 'true')

    // Queries is its own section (VMGR-92) and stays present in individual mode.
    await expect(modal.locator('[data-testid="xml-query-add-button"]')).toBeVisible()

    // Results output should be hidden in individual mode
    await expect(modal.locator('[data-testid="output-row-results"]')).not.toBeVisible()

    // success and errors outputs should still be visible
    await expect(modal.locator('[data-testid="output-row-success"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-errors"]')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S12b: XML Content has the {} expression toggle
  // ==========================================================================

  test('V-PLUGIN-XML-01-S12b: xml_content parameter has the expression toggle', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // xml_content row should exist
    const xmlContentRow = modal.locator('[data-testid="param-row-xml_content"]')
    await expect(xmlContentRow).toBeVisible()

    // xml_content carries no noExpression, so the {} expression toggle
    // appears on its row (an expression body can drive the content).
    const exprToggle = xmlContentRow.locator('[data-testid="expression-toggle"]')
    await expect(exprToggle).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S13: Version shows 1.0.0
  // ==========================================================================

  test('V-PLUGIN-XML-01-S13: version selector shows 1.0.0', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toContainText('1.0.0')
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S14: Details dialog shows documentation
  // ==========================================================================

  test('V-PLUGIN-XML-01-S14: details dialog opens and shows XML Parser documentation', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Open details dialog
    const detailsBtn = modal.getByRole('button', { name: 'Details' })
    await detailsBtn.click()

    // Wait for details dialog
    const detailsDialog = page.locator('[role="dialog"]').first()
    await expect(detailsDialog).toBeVisible()

    // Should contain XML Parser-specific content
    await expect(detailsDialog.getByText('XPath').first()).toBeVisible()

    // Version badge should show 1.0.0
    await expect(detailsDialog.getByText('1.0.0')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S15: Changelog dialog shows entries
  // ==========================================================================

  test('V-PLUGIN-XML-01-S15: changelog dialog opens with entries', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Open changelog dialog
    const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
    await changelogBtn.click()

    // Wait for changelog dialog
    const changelogDialog = page.locator('[role="dialog"]').first()
    await expect(changelogDialog).toBeVisible()

    // Should show changelog entries (8 items per control-metadata.ts)
    const changelogItems = changelogDialog.locator('li')
    await expect(changelogItems).toHaveCount(8)

    // Should contain key entry about XPath
    await expect(
      changelogDialog.getByText(/XPath/).first()
    ).toBeVisible()

    // Should show release date
    await expect(changelogDialog.getByText(/Released:/)).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-01-S16: Alias uniqueness validation shows error
  // ==========================================================================

  test('V-PLUGIN-XML-01-S16: duplicate alias shows validation error', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Fill first row alias
    await modal.locator('[data-testid="xml-query-alias-0"]').fill('my_query')
    // Blur to trigger validation
    await modal.locator('[data-testid="xml-query-xpath-0"]').click()

    // Add second row with same alias
    await modal.locator('[data-testid="xml-query-add-button"]').click()
    await modal.locator('[data-testid="xml-query-alias-1"]').fill('my_query')
    // Blur to trigger validation
    await modal.locator('[data-testid="xml-query-xpath-1"]').click()

    // Validation error should appear (both rows show the alert, use first())
    const errorMsg = modal.locator('[role="alert"]', { hasText: 'Duplicate query name' }).first()
    await expect(errorMsg).toBeVisible()
  })
})
