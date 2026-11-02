/**
 * V-PLUGIN-HTTP-03: HTTP Client - Parameter Value Persistence
 *
 * Phase: no-data (parallel) - uses palette drag-drop only, no backend data needed
 * Design Decisions: FIELD-1, FIELD-2
 * REQ: REQ-3.4.2.2, REQ-3.1.1.5, REQ-3.1.3.14
 *
 * Pass Criteria:
 * 1. All parameter types accept values and persist across save/reopen
 * 2. String, enum, integer, float, boolean, map, array inputs work correctly: numbers are typed over their
 *    gray defaults, maps are filled in the editor their row's expand opens and show as one line, and a
 *    whole-number float keeps its typed digits (3.0)
 * 3. Expression mode persists after save/reopen
 * 4. Output variable bindings persist after save/reopen
 *
 * Strategy: Uses 3 HTTP nodes in a single workflow - each configured with
 * different parameter types - then saves and reopens to verify persistence.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openNodeSheet } from '../../helpers/workbench'
import { setStringParam, expectStringParamPreview } from '../../helpers/param-config'
import { openBlockEditor } from '../../helpers/entry-editors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupPalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
  }
}

async function findItemBySearch(page: Page, searchTerm: string) {
  const searchInput = page.locator('[data-testid="palette-search-input"]')
  await searchInput.fill(searchTerm)
  await page.waitForTimeout(100)
}

async function addHttpNode(page: Page, xOffset: number, yOffset: number) {
  await setupPalette(page)
  await findItemBySearch(page, 'http')
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width * xOffset, y: canvasBox!.height * yOffset })
  await page.waitForTimeout(200)
}

async function selectNodeAndOpenConfig(page: Page, index: number): Promise<Locator> {
  const workflowNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]'
  )
  const node = workflowNodes.nth(index)
  await node.scrollIntoViewIfNeeded()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  // The status bar is on every node, so scope the cog to the
  // currently-selected node rather than the page.
  await openNodeSheet(page, node)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function closeModal(page: Page, modal: Locator) {
  const cancelButton = modal.getByRole('button', { name: 'Cancel' })
  await cancelButton.click()
  const unsavedClose = page.getByTestId('unsaved-close')
  const isUnsavedDialog = await unsavedClose.isVisible({ timeout: 500 }).catch(() => false)
  if (isUnsavedDialog) {
    await unsavedClose.click()
  }
  await expect(modal).not.toBeVisible({ timeout: 3000 })
}

async function saveModal(modal: Locator) {
  const saveButton = modal.getByRole('button', { name: 'Save' }).last()
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(modal).not.toBeVisible({ timeout: 3000 })
}

/** The text box of a row's one value field (FIELD-1). */
const fieldBox = (modal: Locator, name: string): Locator =>
  modal.locator(`[data-testid="param-row-${name}"] [data-slot="input-group"] input`)

/** Type into a number row as a user does: the first key replaces a gray default (FIELD-2), else the selection. */
async function typeNumber(page: Page, modal: Locator, name: string, text: string): Promise<void> {
  const box = modal.locator(`[data-testid="param-input-${name}"]`)
  await box.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
  await expect(box).toHaveValue(text)
}

/** Add `entries` to a map row through its editor, which the row's expand opens, and Save them. */
async function addMapEntries(page: Page, modal: Locator, name: string, entries: Array<[string, string]>) {
  const mapSheet = await openBlockEditor(page, modal, name)
  const mapKeys = mapSheet.locator('input[data-testid^="map-edit-key-"]')
  const mapValues = mapSheet.locator('input[data-testid^="map-edit-value-"]')
  for (const [index, [key, value]] of entries.entries()) {
    await mapSheet.locator('[data-testid="map-add-entry"]').click()
    await mapKeys.nth(index).fill(key)
    await mapValues.nth(index).fill(value)
  }
  await mapSheet.locator('[data-testid="value-editor-save-button"]').click()
  await mapSheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(mapSheet).not.toBeVisible({ timeout: 3000 })
}

const HEADERS_LINE = '{"Content-Type": "application/json", "Authorization": "Bearer token123"}'
const QUERY_LINE = '{"page": "1"}'

async function clearSession(page: Page) {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session`)
    .catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-HTTP-03: Parameter Value Persistence', () => {
  /**
   * Uses 3 HTTP nodes in one workflow:
   * - Node 0: string (url), enum (method), map (headers), map (query_params), multiline (body)
   * - Node 1: integer (timeout), float (retry_delay, retry_backoff_factor),
   *           boolean (verify_ssl, allow_redirects), integer (max_redirects)
   * - Node 2: expression mode (url, timeout) + output bindings (status_code, body)
   */
  test('V-PLUGIN-HTTP-03-S1: parameter values persist across save and reopen', async ({
    page,
  }) => {
    await clearSession(page)
    await waitForCanvasLoad(page)

    // --- Add 3 HTTP nodes at different positions ---
    await addHttpNode(page, 0.3, 0.3)
    await addHttpNode(page, 0.5, 0.3)
    await addHttpNode(page, 0.7, 0.3)

    // ================================================================
    // NODE 0: String, Enum, Map, Multiline
    // ================================================================
    const modal0 = await selectNodeAndOpenConfig(page, 0)

    // Set URL (required string) - literal strings edit via the shared sheet.
    await setStringParam(modal0, page, 'url', 'https://api.example.com/v1/users')

    // Change method to POST (enum dropdown)
    const methodRow0 = modal0.locator('[data-testid="param-row-method"]')
    const methodSelect0 = methodRow0.locator('button[role="combobox"]')
    await methodSelect0.click()
    await page.locator('[role="option"]', { hasText: 'POST' }).click()

    // Contract 10b repin: the body row sits inside the collapsed Body card.
    await modal0.locator('[data-testid="group-header-Body"]').click()

    // Body is visible (body_mode defaults to text; method never gates it)
    await expect(modal0.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Open body text editor from the row's expand and type JSON content
    const bodyEditBtn = modal0.locator('[data-testid="param-expand-body"]')
    await bodyEditBtn.click()

    const textEditorSheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(textEditorSheet).toBeVisible()

    // Type JSON body into the shared sheet's CodeMirror editor
    const editorCm = textEditorSheet.locator('.cm-content').first()
    await editorCm.click()
    await page.keyboard.type('{"name": "test_user", "active": true}')

    // Save the sheet
    await textEditorSheet.locator('[data-testid="value-editor-save-button"]').click()
    await textEditorSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(textEditorSheet).not.toBeVisible({ timeout: 3000 })

    // Headers: 2 entries through the map editor; the one-line field shows them (FIELD-1)
    await addMapEntries(page, modal0, 'headers', [
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer token123'],
    ])
    await expect(fieldBox(modal0, 'headers')).toHaveValue(HEADERS_LINE)

    // Query params: 1 entry
    await addMapEntries(page, modal0, 'query_params', [['page', '1']])
    await expect(fieldBox(modal0, 'query_params')).toHaveValue(QUERY_LINE)

    // Save Node 0 config
    await saveModal(modal0)

    // ================================================================
    // NODE 1: Integer, Float, Boolean (grouped parameters)
    // ================================================================
    const modal1 = await selectNodeAndOpenConfig(page, 1)

    // Set URL (required) so we can save later
    await setStringParam(modal1, page, 'url', 'https://api.example.com/health')

    // Expand Timeouts & Retries group
    await modal1.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    // Numbers typed over their gray defaults: timeout 60, retry_delay 2.5, retry_backoff_factor 3.0, retry_count 3
    await typeNumber(page, modal1, 'timeout', '60')
    await typeNumber(page, modal1, 'retry_delay', '2.5')
    await typeNumber(page, modal1, 'retry_backoff_factor', '3.0')
    await typeNumber(page, modal1, 'retry_count', '3')

    // Expand TLS / Certificates group
    await modal1.locator('[data-testid="group-header-TLS / Certificates"]').click()

    // Toggle verify_ssl OFF (default is true/checked)
    const sslRow = modal1.locator('[data-testid="param-row-verify_ssl"]')
    const sslCheckbox = sslRow.locator('button[role="checkbox"]')
    await expect(sslCheckbox).toHaveAttribute('data-state', 'checked')
    await sslCheckbox.click()
    await expect(sslCheckbox).toHaveAttribute('data-state', 'unchecked')

    // Expand Connection group
    await modal1.locator('[data-testid="group-header-Connection"]').click()

    // Toggle allow_redirects OFF (default is true/checked)
    const redirectsRow = modal1.locator('[data-testid="param-row-allow_redirects"]')
    const redirectsCheckbox = redirectsRow.locator('button[role="checkbox"]')
    await expect(redirectsCheckbox).toHaveAttribute('data-state', 'checked')
    await redirectsCheckbox.click()
    await expect(redirectsCheckbox).toHaveAttribute('data-state', 'unchecked')

    // Set max_redirects (integer) = 5
    await typeNumber(page, modal1, 'max_redirects', '5')

    // Save Node 1 config
    await saveModal(modal1)

    // ================================================================
    // NODE 2: Expression mode + Output bindings
    // ================================================================
    const modal2 = await selectNodeAndOpenConfig(page, 2)

    // Toggle URL to expression mode
    const urlRow2 = modal2.locator('[data-testid="param-row-url"]')
    const urlExprToggle = urlRow2.locator('[data-testid="expression-toggle"]')
    await urlExprToggle.click()
    await expect(urlExprToggle).toHaveAttribute('aria-pressed', 'true')

    // Type a Python expression in the CodeMirror editor
    const urlCmEditor = urlRow2.locator('.cm-content')
    await urlCmEditor.click()
    await page.keyboard.type('base_url + "/api/v1"')

    // Expand Timeouts & Retries, toggle timeout to expression mode
    await modal2.locator('[data-testid="group-header-Timeouts & Retries"]').click()
    const timeoutRow2 = modal2.locator('[data-testid="param-row-timeout"]')
    const timeoutExprToggle = timeoutRow2.locator('[data-testid="expression-toggle"]')
    await timeoutExprToggle.click()
    await expect(timeoutExprToggle).toHaveAttribute('aria-pressed', 'true')

    const timeoutCmEditor = timeoutRow2.locator('.cm-content')
    await timeoutCmEditor.click()
    await page.keyboard.type('default_timeout * 2')

    // Set output bindings
    const statusOutput = modal2.locator('[data-testid="output-row-status_code"]')
    const statusInput = statusOutput.locator("textarea")
    await statusInput.fill('resp_status')

    const bodyOutput = modal2.locator('[data-testid="output-row-body"]')
    const bodyInput = bodyOutput.locator("textarea")
    await bodyInput.fill('resp_body')

    const headersOutput = modal2.locator('[data-testid="output-row-headers"]')
    const headersInput = headersOutput.locator("textarea")
    await headersInput.fill('resp_headers')

    // Save Node 2 config
    await saveModal(modal2)

    // ================================================================
    // VERIFY: Reopen each node and check all values persisted
    // ================================================================

    // --- Verify Node 0 ---
    const reopened0 = await selectNodeAndOpenConfig(page, 0)

    // URL persisted
    await expectStringParamPreview(reopened0, 'url', 'https://api.example.com/v1/users')

    // Method persisted as POST
    const methodTrigger0 = reopened0
      .locator('[data-testid="param-row-method"]')
      .locator('button[role="combobox"]')
    await expect(methodTrigger0).toContainText('POST')

    // Contract 10b repin: expand the collapsed Body card on the reopened sheet.
    await reopened0.locator('[data-testid="group-header-Body"]').click()

    // Body should be visible (method=POST)
    await expect(reopened0.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Body content persisted - open the text editor to verify
    await reopened0.locator('[data-testid="param-expand-body"]').click()
    const reopenedTextEditor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(reopenedTextEditor).toBeVisible()
    const bodyContent = reopenedTextEditor.locator('.cm-content').first()
    await expect(bodyContent).toContainText('"name": "test_user"')
    await reopenedTextEditor.locator('[data-testid="value-editor-cancel-button"]').click()

    // Headers and query params persisted
    await expect(fieldBox(reopened0, 'headers')).toHaveValue(HEADERS_LINE)
    await expect(fieldBox(reopened0, 'query_params')).toHaveValue(QUERY_LINE)

    await closeModal(page, reopened0)

    // --- Verify Node 1 ---
    const reopened1 = await selectNodeAndOpenConfig(page, 1)

    // URL persisted
    await expectStringParamPreview(reopened1, 'url', 'https://api.example.com/health')

    // Expand all groups to check values
    await reopened1.locator('[data-testid="group-header-Timeouts & Retries"]').click()
    await expect(reopened1.locator('[data-testid="param-input-timeout"]')).toHaveValue('60')
    await expect(reopened1.locator('[data-testid="param-input-retry_delay"]')).toHaveValue('2.5')
    // REQ-3.1.3.14: a whole-number float keeps the digits it was typed with.
    await expect(reopened1.locator('[data-testid="param-input-retry_backoff_factor"]')).toHaveValue(
      '3.0'
    )
    await expect(reopened1.locator('[data-testid="param-input-retry_count"]')).toHaveValue('3')

    await reopened1.locator('[data-testid="group-header-TLS / Certificates"]').click()
    const reopenedSslCheckbox = reopened1
      .locator('[data-testid="param-row-verify_ssl"]')
      .locator('button[role="checkbox"]')
    await expect(reopenedSslCheckbox).toHaveAttribute('data-state', 'unchecked')

    await reopened1.locator('[data-testid="group-header-Connection"]').click()
    const reopenedRedirectsCheckbox = reopened1
      .locator('[data-testid="param-row-allow_redirects"]')
      .locator('button[role="checkbox"]')
    await expect(reopenedRedirectsCheckbox).toHaveAttribute('data-state', 'unchecked')
    await expect(reopened1.locator('[data-testid="param-input-max_redirects"]')).toHaveValue('5')

    await closeModal(page, reopened1)

    // --- Verify Node 2 ---
    const reopened2 = await selectNodeAndOpenConfig(page, 2)

    // URL should be in expression mode
    const reopenedUrlRow = reopened2.locator('[data-testid="param-row-url"]')
    const reopenedUrlToggle = reopenedUrlRow.locator('[data-testid="expression-toggle"]')
    await expect(reopenedUrlToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(reopenedUrlRow.locator('.cm-content')).toContainText('base_url + "/api/v1"')

    // Timeout should be in expression mode
    await reopened2.locator('[data-testid="group-header-Timeouts & Retries"]').click()
    const reopenedTimeoutRow = reopened2.locator('[data-testid="param-row-timeout"]')
    const reopenedTimeoutToggle = reopenedTimeoutRow.locator('[data-testid="expression-toggle"]')
    await expect(reopenedTimeoutToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(reopenedTimeoutRow.locator('.cm-content')).toContainText('default_timeout * 2')

    // Output bindings persisted
    await expect(
      reopened2.locator('[data-testid="output-row-status_code"]').locator("textarea")
    ).toHaveValue('resp_status')
    await expect(
      reopened2.locator('[data-testid="output-row-body"]').locator("textarea")
    ).toHaveValue('resp_body')
    await expect(
      reopened2.locator('[data-testid="output-row-headers"]').locator("textarea")
    ).toHaveValue('resp_headers')

    await closeModal(page, reopened2)
  })
})
