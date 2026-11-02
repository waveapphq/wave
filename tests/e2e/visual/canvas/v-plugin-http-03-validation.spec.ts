/**
 * V-PLUGIN-HTTP-03-VALIDATION: HTTP Client - Validation, Conditionals, Template Mode
 *
 * Phase: no-data (parallel) - uses palette drag-drop only, no backend data needed
 * Design Decisions: REQ-3.4.2.2 (Expression toggle), REQ-3.4.1.4 (HTTP Client)
 *
 * Pass Criteria (body is gated by body_mode, and body-mode payloads are
 * draft-retained across mode switches):
 * 1. Save button disabled when required field (url) is empty
 * 2. body_mode gating hides Body in Form mode; the draft value is RETAINED
 *    when switching back to Text (HTTP-14 retainOnHide)
 * 3. Template mode in multiline fields persists after save/reopen
 * 4. Number inputs reject non-numeric characters
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { expectGrayDefault } from '../../helpers/default-rule'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

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
  const gearButton = page.locator(
    '[data-testid="node-configure"]'
  )
  await gearButton.click()
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

test.describe('V-PLUGIN-HTTP-03-VALIDATION: Validation, Conditionals, Template Mode', () => {
  test('V-PLUGIN-HTTP-03-S2: validation, conditionals, template mode, and input validation', async ({
    page,
  }) => {
    await clearSession(page)
    await waitForCanvasLoad(page)

    await addHttpNode(page, 0.5, 0.5)

    // ================================================================
    // PART A: Save button disabled when URL (required) is empty
    // ================================================================
    const modalA = await selectNodeAndOpenConfig(page, 0)

    // URL is empty by default - Save should be disabled
    const saveBtn = modalA.getByRole('button', { name: 'Save' }).last()
    await expect(saveBtn).toBeDisabled()

    // Fill URL - Save should become enabled (literal strings edit via the sheet)
    await setStringParam(modalA, page, 'url', 'https://example.com')
    await expect(saveBtn).toBeEnabled()

    // Clear URL - Save should be disabled again
    await setStringParam(modalA, page, 'url', '')
    await expect(saveBtn).toBeDisabled()

    // ================================================================
    // PART B: body_mode gating + draft retention (HTTP-14)
    // body_mode owns the gating and body-mode payloads are retained in the
    // draft across mode switches (retainOnHide).
    // ================================================================

    // Set URL so we can interact freely
    await setStringParam(modalA, page, 'url', 'https://example.com')

    // body_mode/body rows sit inside the collapsed Body card.
    await modalA.locator('[data-testid="group-header-Body"]').click()

    // Body is visible on the GET default (Body Mode = Text)
    await expect(modalA.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Set body content
    const bodyEditBtn = modalA.locator('[data-testid="param-expand-body"]')
    await bodyEditBtn.click()
    const textEditor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(textEditor).toBeVisible()
    const editorCm = textEditor.locator('.cm-content').first()
    await editorCm.click()
    await page.keyboard.type('test body content')
    await textEditor.locator('[data-testid="value-editor-save-button"]').click()
    await textEditor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(textEditor).not.toBeVisible({ timeout: 3000 })

    // Switch Body Mode to Form (URL-encoded) - Body hides, Form Fields shows
    const modeSelect = modalA.locator(
      '[data-testid="param-row-body_mode"] button[role="combobox"]',
    )
    await modeSelect.click()
    await page.getByRole('option', { name: 'Form (URL-encoded)' }).click()
    await expect(modalA.locator('[data-testid="param-row-body"]')).not.toBeVisible()
    await expect(modalA.locator('[data-testid="param-row-form_fields"]')).toBeVisible()

    // Switch back to Text - body reappears and the draft value SURVIVED
    await modeSelect.click()
    await page.getByRole('option', { name: 'Text' }).click()
    await expect(modalA.locator('[data-testid="param-row-body"]')).toBeVisible()

    // Open body editor - the draft was retained (retainOnHide exemption)
    await modalA.locator('[data-testid="param-expand-body"]').click()
    const reopenedEditor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(reopenedEditor).toBeVisible()
    const editorContent = reopenedEditor.locator('.cm-content').first()
    await expect(editorContent).toContainText('test body content')
    await reopenedEditor.locator('[data-testid="value-editor-cancel-button"]').click()

    // ================================================================
    // PART C: Template mode persistence
    // ================================================================

    // Open body editor, enable template mode, type template content
    await modalA.locator('[data-testid="param-expand-body"]').click()
    const templateEditor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(templateEditor).toBeVisible()

    // Select the Template kind (Template is a value KIND, not a Format entry)
    await templateEditor.locator('[data-testid="kind-dropdown"]').click()
    await page.getByRole('option', { name: 'Template', exact: true }).click()

    // Replace the retained draft with template content
    const templateCm = templateEditor.locator('.cm-content').first()
    await templateCm.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Hello {{user_name}}, status: {{status}}')

    // Save the sheet
    await templateEditor.locator('[data-testid="value-editor-save-button"]').click()
    await templateEditor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(templateEditor).not.toBeVisible({ timeout: 3000 })

    // Save the config
    await saveModal(modalA)

    // Reopen and verify the Template kind and content persisted
    const reopenedModal = await selectNodeAndOpenConfig(page, 0)
    // Contract 10b repin: expand the collapsed Body card on the reopened sheet.
    await reopenedModal.locator('[data-testid="group-header-Body"]').click()
    await reopenedModal.locator('[data-testid="param-expand-body"]').click()
    const verifyEditor = page.locator('[data-testid="value-editor-sheet"]')
    await expect(verifyEditor).toBeVisible()

    // Template kind should still be active
    await expect(verifyEditor.locator('[data-testid="kind-dropdown"]')).toContainText('Template')

    // Content should have the template text
    const verifyContent = verifyEditor.locator('.cm-content').first()
    await expect(verifyContent).toContainText('Hello {{user_name}}')

    await verifyEditor.locator('[data-testid="value-editor-cancel-button"]').click()

    // ================================================================
    // PART D: Number input validation (reject non-numeric)
    // ================================================================

    // Expand Timeouts & Retries
    await reopenedModal.locator('[data-testid="group-header-Timeouts & Retries"]').click()

    // Integer field over its gray default (FIELD-2): typed letters are refused and the default stays
    const timeoutField = reopenedModal.locator('[data-testid="param-input-timeout"]')
    await timeoutField.click()
    await timeoutField.pressSequentially('abc')
    await expectGrayDefault(reopenedModal, 'timeout', '30')

    // A valid number: its first digit replaces the gray default
    await timeoutField.type('45')
    await expect(timeoutField).toHaveValue('45')

    // Float field: typing multiple dots should be rejected
    const retryDelayField = reopenedModal.locator('[data-testid="param-input-retry_delay"]')
    await retryDelayField.fill('')
    await retryDelayField.type('1.5')
    await expect(retryDelayField).toHaveValue('1.5')

    // Verify a second dot is rejected: type '1.' then another '.' - second dot ignored
    await retryDelayField.fill('')
    await retryDelayField.type('1.')
    await expect(retryDelayField).toHaveValue('1.')
    // Now type another dot - should be rejected, value stays '1.'
    await retryDelayField.type('.')
    await expect(retryDelayField).toHaveValue('1.')
    // But digits after the first dot are accepted
    await retryDelayField.type('5')
    await expect(retryDelayField).toHaveValue('1.5')

    await closeModal(page, reopenedModal)
  })
})
