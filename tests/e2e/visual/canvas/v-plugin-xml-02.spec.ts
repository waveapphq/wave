/**
 * V-PLUGIN-XML-02: XPath Testing Feature
 *
 * Phase: no-data (parallel) - uses client-side XPath evaluation, no backend needed
 * REQ: REQ-3.4.1.11 XML processing with XPath support
 *
 * Pass Criteria:
 * 1. Enter literal XML via TextEditorModal, add query with XPath, click test
 * 2. Successful query: result dialog shows type + value
 * 3. Invalid XPath: result dialog shows error + detail
 * 4. Test button disabled when XPath is in expression mode
 * 5. Test button disabled when xml_content is empty
 * 6. Test button enabled with valid XML content and literal XPath
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-PLUGIN-XML-02: XPath Testing', () => {
  // No backend data needed - uses client-side XPath evaluation
  // Runs in parallel no-data phase

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

    const item = page.locator('[data-testid="palette-item-xml-parser"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'xml', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)

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

  // Helper to enter XML content via TextEditorModal
  async function enterXmlContent(
    page: import('@playwright/test').Page,
    modal: import('@playwright/test').Locator,
    xmlContent: string
  ) {
    // The row's expand opens the full editor (FIELD-1)
    const editButton = modal.locator('[data-testid="param-expand-xml_content"]')
    await editButton.click()

    // Wait for the shared "Edit value" sheet to appear
    const textEditorSheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(textEditorSheet).toBeVisible()

    // Clear and insert the XML content into CodeMirror
    // Use insertText (not type) to avoid CodeMirror's auto-close mangling tags
    const cmEditor = textEditorSheet.locator('.cm-content').first()
    await cmEditor.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(xmlContent)

    // Save the sheet by firing the button's onClick directly. The syntax-highlighted
    // XML editor leaves the floating sheet jittering sub-pixel under headless Chromium
    // (a position-based click lands on stale coordinates); dispatchEvent is immune to it.
    const saveBtn = textEditorSheet.locator('[data-testid="value-editor-save-button"]')
    await expect(saveBtn).toBeVisible()
    await saveBtn.dispatchEvent('click')

    // Save applies without closing; Close dismisses the sheet.
    await textEditorSheet
      .locator('[data-testid="value-editor-cancel-button"]')
      .dispatchEvent('click')
    await expect(textEditorSheet).not.toBeVisible()
  }

  // ==========================================================================
  // V-PLUGIN-XML-02-S1: Test button disabled when xml_content is empty
  // ==========================================================================

  test('V-PLUGIN-XML-02-S1: test button disabled when xml_content is empty', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter an XPath expression
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//item/text()')

    // Test button should be disabled because xml_content is empty
    const testBtn = modal.locator('[data-testid="xml-query-test-0"]')
    await expect(testBtn).toBeDisabled()
  })

  // ==========================================================================
  // V-PLUGIN-XML-02-S2: Test button disabled when XPath is in expression mode
  // ==========================================================================

  test('V-PLUGIN-XML-02-S2: test button disabled when XPath is in expression mode', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter XML content first
    await enterXmlContent(page, modal, '<root><item>Hello</item></root>')

    // Enter an XPath
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//item/text()')

    // Toggle to expression mode
    await modal.locator('[data-testid="xml-query-expr-toggle-0"]').click()

    // Test button should be disabled in expression mode
    const testBtn = modal.locator('[data-testid="xml-query-test-0"]')
    await expect(testBtn).toBeDisabled()
  })

  // ==========================================================================
  // V-PLUGIN-XML-02-S3: Test button enabled with valid XML and literal XPath
  // ==========================================================================

  test('V-PLUGIN-XML-02-S3: test button enabled with valid XML and literal XPath', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter XML content
    await enterXmlContent(page, modal, '<root><item>Hello</item></root>')

    // Enter XPath expression
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//item/text()')

    // Test button should now be enabled
    const testBtn = modal.locator('[data-testid="xml-query-test-0"]')
    await expect(testBtn).toBeEnabled()
  })

  // ==========================================================================
  // V-PLUGIN-XML-02-S4: Successful XPath test shows result dialog
  // ==========================================================================

  test('V-PLUGIN-XML-02-S4: successful XPath test shows result with type and value', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter XML content
    await enterXmlContent(page, modal, '<root><item>Hello</item></root>')

    // Enter query alias and XPath
    await modal.locator('[data-testid="xml-query-alias-0"]').fill('greeting')
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//item/text()')

    // Click test button
    await modal.locator('[data-testid="xml-query-test-0"]').click()

    // Result dialog should appear (new dialog on top of config modal)
    const resultDialog = page.locator('[role="dialog"]').first()
    await expect(resultDialog).toBeVisible()

    // Should show query name
    await expect(resultDialog.getByText('greeting')).toBeVisible()

    // Should show type
    await expect(resultDialog.getByText('Type:')).toBeVisible()

    // Should show value
    await expect(resultDialog.getByText('Value:')).toBeVisible()
    await expect(resultDialog.getByText('"Hello"')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-02-S5: Invalid XPath shows error dialog
  // ==========================================================================

  test('V-PLUGIN-XML-02-S5: invalid XPath shows error in result dialog', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter XML content
    await enterXmlContent(page, modal, '<root><item>Hello</item></root>')

    // Enter invalid XPath
    await modal.locator('[data-testid="xml-query-alias-0"]').fill('bad_query')
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//[invalid')

    // Click test button
    await modal.locator('[data-testid="xml-query-test-0"]').click()

    // Result dialog should show error
    const resultDialog = page.locator('[role="dialog"]').first()
    await expect(resultDialog).toBeVisible()

    // Should show error label
    await expect(resultDialog.getByText('Error:')).toBeVisible()

    // Description should indicate failure
    await expect(resultDialog.getByText('XPath evaluation failed')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-XML-02-S6: Array result shows indexed items
  // ==========================================================================

  test('V-PLUGIN-XML-02-S6: array result shows indexed items in dialog', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropXmlParserAndSelect(page)
    const modal = await openConfigModal(page)

    // Enter XML with multiple items
    await enterXmlContent(page, modal, '<root><item>Hello</item><item>World</item></root>')

    // Enter XPath that returns multiple results
    await modal.locator('[data-testid="xml-query-alias-0"]').fill('items')
    await modal.locator('[data-testid="xml-query-xpath-0"]').fill('//item/text()')

    // Click test button
    await modal.locator('[data-testid="xml-query-test-0"]').click()

    // Result dialog should show array type
    const resultDialog = page.locator('[role="dialog"]').first()
    await expect(resultDialog).toBeVisible()

    // Should show indexed items [0] and [1]
    await expect(resultDialog.getByText('[0]')).toBeVisible()
    await expect(resultDialog.getByText('[1]')).toBeVisible()
  })
})
