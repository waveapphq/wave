/**
 * V-PLUGIN-HTTP-01: HTTP Client Plugin Config Modal
 *
 * Phase: no-data (parallel) - uses palette drag-drop only, no backend data needed
 * Design Decisions: REQ-3.4.2.2 (Expression toggle on every parameter widget)
 * REQ: REQ-3.4.1.4 (HTTP/HTTPS client operations)
 *
 * Pass Criteria:
 * 1. Ungrouped parameters render (url, method, headers, body_mode, query_params)
 * 2. Groups collapsed by default, expand on click
 * 3. Expression toggle ({x}) on integer, float, boolean, map, array types
 * 4. Output variables section shows all 9 outputs (incl. size, sha256, trace)
 * 5. Profile binding button visible, modal opens from footer
 * 6. Body field visible on ANY method while Body Mode is Text (HTTP-8)
 * 7. Method dropdown shows all 7 HTTP methods
 * 8. Map and list params are one value field whose expand opens the "Edit value" sheet (FIELD-1, FIELD-10)
 * 9. ca_cert is the one value field (no textarea); its expand opens the string editor
 * 10. Numeric fields show their default in gray as the field's text, with no reset icon (FIELD-2)
 * 11. Expression toggle works on string, float, enum, map, and array field types; a field holding a
 *     value (Method, Verify Server Certificate) asks the switch warning first (FIELD-7, FIELD-8)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import {
  answerSwitch,
  expandButton,
  expectTextMuted,
  fieldInput,
  resetButton,
  switchWarning,
  SWITCH_TO_EXPRESSION_TITLE,
} from '../../helpers/value-field'

// Helper to expand palette and search
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

// Helper to add an HTTP Client node and open its config modal
async function addHttpNodeAndOpenConfig(page: Page) {
  await setupPalette(page)
  await findItemBySearch(page, 'http')

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()

  await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
  await page.waitForTimeout(100)

  // Select the node
  const workflowNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]'
  )
  const firstNode = workflowNodes.first()
  await firstNode.locator('button').first().dispatchEvent('click')
  await expect(firstNode).toHaveAttribute('data-selected', 'true')

  // Click gear button to open config modal
  const gearButton = page.locator(
    '[data-testid="node-configure"]'
  )
  await gearButton.click()

  // Wait for modal
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-PLUGIN-HTTP-01: HTTP Client Config Modal', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage workbench state for a fresh canvas
    // NOTE: Do NOT delete /workbench/session - it's shared with fixture-phase tests
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })
  // No beforeAll seed needed - tests use palette drag-drop only (no-data phase)

  // ============================================================================
  // Ungrouped Parameters
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S1: shows ungrouped parameters (url, method, headers, query_params)', async ({
    page,
  }) => {
    // Per plan: 5 ungrouped params always visible (body conditional on method)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // url (required string)
    await expect(modal.locator('[data-testid="param-row-url"]')).toBeVisible()
    // method (required enum)
    await expect(modal.locator('[data-testid="param-row-method"]')).toBeVisible()
    // headers (map)
    await expect(modal.locator('[data-testid="param-row-headers"]')).toBeVisible()
    // query_params (map)
    await expect(modal.locator('[data-testid="param-row-query_params"]')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S2: body visible on GET while Body Mode is Text (HTTP-8)', async ({
    page,
  }) => {
    // Body is gated by body_mode (default text), not by method (HTTP-8)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // body_mode / body rows sit inside the collapsed Body card.
    await modal.locator('[data-testid="group-header-Body"]').click()

    // Default method GET + Body Mode Text - body row IS visible
    const modeTrigger = modal.locator(
      '[data-testid="param-row-body_mode"] button[role="combobox"]',
    )
    await expect(modeTrigger).toContainText('Text')
    await expect(modal.locator('[data-testid="param-row-body"]')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S3: body row is gated by Body Mode, not method (HTTP-8/9)', async ({
    page,
  }) => {
    // Switching body_mode hides Body and shows the
    // mode's own row; switching method leaves the body area untouched
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand the collapsed Body card first.
    await modal.locator('[data-testid="group-header-Body"]').click()

    // Change method to POST - body stays visible (no method gating either way)
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    await methodRow.locator('button[role="combobox"]').click()
    await page.locator('[role="option"]', { hasText: 'POST' }).click()
    await expect(modal.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Change Body Mode to Form (URL-encoded) - Body hides, Form Fields shows
    await modal.locator('[data-testid="param-row-body_mode"] button[role="combobox"]').click()
    await page.getByRole('option', { name: 'Form (URL-encoded)' }).click()
    await expect(modal.locator('[data-testid="param-row-body"]')).not.toBeVisible()
    await expect(modal.locator('[data-testid="param-row-form_fields"]')).toBeVisible()
  })

  // ============================================================================
  // Collapsible Groups
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S4: four group headers visible', async ({ page }) => {
    // Timeouts & Retries, Response, TLS / Certificates,
    // Connection - the "Security" decoy is gone
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await expect(modal.locator('[data-testid="group-header-Timeouts & Retries"]')).toBeVisible()
    await expect(modal.locator('[data-testid="group-header-Response"]')).toBeVisible()
    await expect(modal.locator('[data-testid="group-header-TLS / Certificates"]')).toBeVisible()
    await expect(modal.locator('[data-testid="group-header-Connection"]')).toBeVisible()
    await expect(modal.locator('[data-testid="group-header-Security"]')).toHaveCount(0)
  })

  test('V-PLUGIN-HTTP-01-S5: groups collapsed by default (grouped params not visible)', async ({
    page,
  }) => {
    // Per plan: All groups collapsed by default
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Grouped params should not be visible when collapsed
    await expect(modal.locator('[data-testid="param-row-timeout"]')).not.toBeVisible()
    await expect(modal.locator('[data-testid="param-row-verify_ssl"]')).not.toBeVisible()
    await expect(modal.locator('[data-testid="param-row-allow_redirects"]')).not.toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S6: clicking Timeouts & Retries group expands it', async ({
    page,
  }) => {
    // Per plan: Click to expand reveals grouped params
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Click group header
    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    // Params in this group should now be visible
    await expect(modal.locator('[data-testid="param-row-timeout"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-retry_count"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-retry_delay"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-retry_backoff_factor"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-retryable_status_codes"]')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S7: expanding TLS / Certificates shows TLS + mTLS rows', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await modal.locator('[data-testid="group-header-TLS / Certificates"]').click()

    await expect(modal.locator('[data-testid="param-row-verify_ssl"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-ca_cert"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-client_cert"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-client_key"]')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S8: expanding Connection group shows its params', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await modal.locator('[data-testid="group-header-Connection"]').click()

    await expect(modal.locator('[data-testid="param-row-allow_redirects"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-row-max_redirects"]')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S9: clicking group header again collapses it', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const groupHeader = modal.locator('[data-testid="group-header-Timeouts & Retries"]')

    // Expand
    await groupHeader.click()
    await expect(modal.locator('[data-testid="param-row-timeout"]')).toBeVisible()

    // Collapse
    await groupHeader.click()
    await expect(modal.locator('[data-testid="param-row-timeout"]')).not.toBeVisible()
  })

  // ============================================================================
  // Expression Toggle
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S10: expression toggle on integer field (timeout)', async ({
    page,
  }) => {
    // Per REQ-3.4.2.2: Expression toggle on every parameter widget
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand Timeouts & Retries to access timeout
    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    const timeoutRow = modal.locator('[data-testid="param-row-timeout"]')
    await expect(timeoutRow).toBeVisible()

    // In literal mode: numeric input is visible, CodeMirror editor is not
    await expect(timeoutRow.locator('input[inputmode="numeric"]')).toBeVisible()
    await expect(timeoutRow.locator('.cm-editor')).not.toBeVisible()

    // Should have expression toggle button
    const toggle = timeoutRow.locator('[data-testid="expression-toggle"]')
    await expect(toggle).toBeVisible()

    // Click toggle to switch to expression mode
    await toggle.click()

    // Toggle should now be pressed (aria-pressed="true")
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror expression editor should now be visible (replaces numeric input)
    await expect(timeoutRow.locator('.cm-editor')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S11: expression toggle on boolean field (verify_ssl)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand TLS / Certificates group
    await modal.locator('[data-testid="group-header-TLS / Certificates"]').click()

    const sslRow = modal.locator('[data-testid="param-row-verify_ssl"]')
    await expect(sslRow).toBeVisible()

    // In literal mode: checkbox is visible, CodeMirror editor is not
    await expect(sslRow.locator('button[role="checkbox"]')).toBeVisible()
    await expect(sslRow.locator('.cm-editor')).not.toBeVisible()

    // Should have expression toggle
    const toggle = sslRow.locator('[data-testid="expression-toggle"]')
    await expect(toggle).toBeVisible()

    // A true / false field always holds a value, so the switch asks first (FIELD-7, FIELD-8)
    await toggle.click()
    await expect(switchWarning(page)).toContainText(SWITCH_TO_EXPRESSION_TITLE)
    await answerSwitch(page, 'Clear & Default')

    // Toggle should now be pressed
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror expression editor should now be visible (replaces checkbox)
    await expect(sslRow.locator('.cm-editor')).toBeVisible()
    await expect(sslRow.locator('button[role="checkbox"]')).toHaveCount(0)
  })

  // ============================================================================
  // Output Variables
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S12: output variables section shows all 9 outputs', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Verify output rows exist
    await expect(modal.locator('[data-testid="output-row-status_code"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-body"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-headers"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-content_type"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-response_time"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-final_url"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-size"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-sha256"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-trace"]')).toBeVisible()
  })

  // ============================================================================
  // Profile Binding Button & Modal
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S13: Profiles button visible in footer', async ({ page }) => {
    // Per PROFILE-11: Blue accent Profiles button in element config footer
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await expect(profilesButton).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S14: clicking Profiles opens the profile binding sheet', async ({
    page,
  }) => {
    // Per PROFILE-13: the profile binding sheet opens
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Click Profiles button
    const profilesButton = modal.getByRole('button', { name: 'Profiles' })
    await profilesButton.click()

    const profileSheet = page.locator('[data-testid="profile-binding-sheet"]')
    await expect(profileSheet).toBeVisible({ timeout: 5000 })
    await expect(profileSheet).toContainText('Bind profiles')
  })

  // ============================================================================
  // Body Visibility for Additional Methods
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S15: body stays visible across method changes (HTTP-8)', async ({
    page,
  }) => {
    // Body is legal on every method - the row never method-gates (HTTP-8)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand the collapsed Body card first.
    await modal.locator('[data-testid="group-header-Body"]').click()

    // Visible under the GET default
    await expect(modal.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Change method to DELETE - still visible
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    const selectTrigger = methodRow.locator('button[role="combobox"]')
    await selectTrigger.click()
    const deleteOption = page.locator('[role="option"]', { hasText: 'DELETE' })
    await deleteOption.click()
    await expect(modal.locator('[data-testid="param-row-body"]')).toBeVisible()

    // And back to HEAD - still visible (body_mode owns the gating)
    await selectTrigger.click()
    await page.locator('[role="option"]', { hasText: 'HEAD' }).click()
    await expect(modal.locator('[data-testid="param-row-body"]')).toBeVisible()
  })

  // ============================================================================
  // Method Dropdown Options
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S16: method dropdown shows all 7 HTTP methods', async ({
    page,
  }) => {
    // Per control-parameters.ts: enumValues includes all 7 methods
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Open method dropdown
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    const selectTrigger = methodRow.locator('button[role="combobox"]')
    await selectTrigger.click()

    // All 7 methods should be listed
    const expectedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
    for (const method of expectedMethods) {
      await expect(page.locator('[role="option"]', { hasText: method })).toBeVisible()
    }
  })

  // ============================================================================
  // Map & Array Editor Modals
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S17: headers map param opens the map editor from its expand', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // The one value field, empty, with its expand (FIELD-1)
    await expect(fieldInput(modal, 'headers')).toHaveValue('')
    const expand = expandButton(modal, 'headers')
    await expect(expand).toHaveAccessibleName('Open editor for Headers')
    await expand.click()

    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('map')
  })

  test('V-PLUGIN-HTTP-01-S18: retryable_status_codes list param opens the list editor from its expand', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand Timeouts & Retries group
    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    // Not set: the default list shows in gray on one line (FIELD-2)
    const line = fieldInput(modal, 'retryable_status_codes')
    await expect(line).toHaveValue('["502", "503", "504"]')
    await expectTextMuted(line, 'the default list')
    await expect(resetButton(modal, 'retryable_status_codes')).toHaveCount(0)

    await expandButton(modal, 'retryable_status_codes').click()

    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
  })

  // ============================================================================
  // Textarea and Placeholder Rendering
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S19: ca_cert renders as Edit button (multiline)', async ({
    page,
  }) => {
    // A long string parameter is edited through the shared value-editor sheet.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand TLS / Certificates group
    await modal.locator('[data-testid="group-header-TLS / Certificates"]').click()

    // ca_cert row should be visible
    const caCertRow = modal.locator('[data-testid="param-row-ca_cert"]')
    await expect(caCertRow).toBeVisible()

    // The one value field, empty, and no textarea (FIELD-1)
    await expect(fieldInput(modal, 'ca_cert')).toHaveValue('')
    await expect(caCertRow.locator('textarea')).toHaveCount(0)

    // Its expand opens the shared "Edit value" sheet
    await expandButton(modal, 'ca_cert').click()
    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('string')
  })

  test('V-PLUGIN-HTTP-01-S20: numeric fields show their default in gray', async ({
    page,
  }) => {
    // A not-set number shows its default as the field's text in Text Muted, with no reset icon (FIELD-2)
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()
    await modal.locator('[data-testid="group-header-Connection"]').click()

    const defaults: Array<[string, string]> = [
      ['timeout', '30'],
      ['retry_count', '0'],
      ['retry_delay', '1'],
      ['retry_backoff_factor', '2'],
      ['max_redirects', '10'],
    ]
    for (const [name, shown] of defaults) {
      const box = modal.locator(`[data-testid="param-input-${name}"]`)
      await expect(box, `${name} shows its default`).toHaveValue(shown)
      await expectTextMuted(box, `${name} default`)
      await expect(resetButton(modal, name), `${name} has no reset icon`).toHaveCount(0)
    }
  })

  // ============================================================================
  // Expression Toggle on Various Field Types
  // ============================================================================

  test('V-PLUGIN-HTTP-01-S21: expression toggle on string field (url)', async ({
    page,
  }) => {
    // Per REQ-3.4.2.2: Expression toggle on every parameter widget
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await expect(urlRow).toBeVisible()

    // In literal mode: the one value field's text box, no inline CodeMirror
    await expect(fieldInput(modal, 'url')).toBeVisible()
    await expect(urlRow.locator('.cm-editor')).not.toBeVisible()

    // Click expression toggle
    const toggle = urlRow.locator('[data-testid="expression-toggle"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror expression editor should now be visible
    await expect(urlRow.locator('.cm-editor')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S22: expression toggle on float field (retry_delay)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand Timeouts & Retries
    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    const retryDelayRow = modal.locator('[data-testid="param-row-retry_delay"]')
    await expect(retryDelayRow).toBeVisible()

    // In literal mode: numeric input visible (inputMode="decimal" for float)
    await expect(retryDelayRow.locator('input[inputmode="decimal"]')).toBeVisible()
    await expect(retryDelayRow.locator('.cm-editor')).not.toBeVisible()

    // Click expression toggle
    const toggle = retryDelayRow.locator('[data-testid="expression-toggle"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror should appear
    await expect(retryDelayRow.locator('.cm-editor')).toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S23: expression toggle on enum field (method)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const methodRow = modal.locator('[data-testid="param-row-method"]')
    await expect(methodRow).toBeVisible()

    // In literal mode: select dropdown (combobox) is visible
    await expect(methodRow.locator('button[role="combobox"]')).toBeVisible()
    await expect(methodRow.locator('.cm-editor')).not.toBeVisible()

    // A choice list holds a value from creation, so the switch asks first (FIELD-7, FIELD-8)
    const toggle = methodRow.locator('[data-testid="expression-toggle"]')
    await toggle.click()
    await expect(switchWarning(page)).toContainText(SWITCH_TO_EXPRESSION_TITLE)
    await answerSwitch(page, 'Clear & Default')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror should replace the dropdown
    await expect(methodRow.locator('.cm-editor')).toBeVisible()
    await expect(methodRow.locator('button[role="combobox"]')).not.toBeVisible()
  })

  test('V-PLUGIN-HTTP-01-S24: expression toggle on map field (headers)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    const headersRow = modal.locator('[data-testid="param-row-headers"]')
    await expect(headersRow).toBeVisible()

    // In literal mode: the one value field and its expand
    await expect(fieldInput(modal, 'headers')).toBeVisible()
    await expect(expandButton(modal, 'headers')).toBeVisible()
    await expect(headersRow.locator('.cm-editor')).not.toBeVisible()

    // Click expression toggle
    const toggle = headersRow.locator('[data-testid="expression-toggle"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror replaces the one value field
    await expect(headersRow.locator('.cm-editor')).toBeVisible()
    await expect(fieldInput(modal, 'headers')).toHaveCount(0)
  })

  test('V-PLUGIN-HTTP-01-S25: expression toggle on array field (retryable_status_codes)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addHttpNodeAndOpenConfig(page)

    // Expand Timeouts & Retries
    await modal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    const arrayRow = modal.locator('[data-testid="param-row-retryable_status_codes"]')
    await expect(arrayRow).toBeVisible()

    // In literal mode: the one value field shows the default list in gray
    await expect(fieldInput(modal, 'retryable_status_codes')).toHaveValue('["502", "503", "504"]')
    await expect(arrayRow.locator('.cm-editor')).not.toBeVisible()

    // Click expression toggle
    const toggle = arrayRow.locator('[data-testid="expression-toggle"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // CodeMirror replaces the one value field
    await expect(arrayRow.locator('.cm-editor')).toBeVisible()
  })
})
