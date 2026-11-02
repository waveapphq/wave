/**
 * V-PLUGIN-VARSET-02: Variable Setter Functional Tests
 *
 * Phase: fixture (serial) - requires seeded test with multi-scope variables
 * Design Decisions: VARSET-1 through VARSET-10
 * REQ: REQ-3.4.1.14 Variable Setter Control
 *
 * Pass Criteria:
 * 1. New string variable: name typed, value entered, persists in row
 * 2. All variable types: string, integer, float, boolean, array, map, table
 * 3. Expression toggle: switches value field to expression editor
 * 4. Autocomplete: shows existing vars with type labels (string, integer, etc.)
 * 5. Type locking: existing variable from autocomplete has disabled type dropdown
 * 6. Delete: rows can be removed, last row deletion leaves empty row
 * 7. Save/reopen persistence: configured variables survive modal close/reopen
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { exec } from '../../helpers/exec'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_ID = 'a0020e00-0001-0001-0001-000000000001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load the seeded test workflow in the workbench */
async function loadTestWorkflow(page: Page) {
  // Clear backend session from prior test
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session`)
    .catch(() => {})

  // Clear localStorage and navigate
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${TEST_ID}`)
  await waitForCanvasLoad(page)

  // Wait for the variable setter node to appear
  const varsetNode = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
  await expect(varsetNode.first()).toBeVisible({ timeout: 10000 })
}

/** Select the variable setter node and open its config modal */
async function selectNodeAndOpenConfig(page: Page): Promise<Locator> {
  const workflowNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]'
  )
  // The varset node is the only workflowNode (start/end are different types)
  const varsetNode = workflowNodes.first()
  await varsetNode.scrollIntoViewIfNeeded()
  await varsetNode.locator('button').first().dispatchEvent('click')
  await expect(varsetNode).toHaveAttribute('data-selected', 'true')

  const gearButton = page.locator(
    '[data-testid="node-configure"]'
  )
  await gearButton.click()

  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

/** Save the config modal */
async function saveModal(_page: Page, modal: Locator) {
  const saveButton = modal.getByRole('button', { name: 'Save' }).last()
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(modal).not.toBeVisible({ timeout: 3000 })
}

/** Close modal without saving (dismiss unsaved dialog if needed) */
async function closeModal(page: Page, modal: Locator) {
  const cancelButton = modal.getByRole('button', { name: 'Cancel' })
  await cancelButton.click()
  // A dirty sheet routes Cancel through the Unsaved Changes dialog; wait for
  // whichever happens first (clean close OR the dialog), then drop the edits.
  const unsavedClose = page.getByTestId('unsaved-close')
  await Promise.race([
    modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {}),
    unsavedClose.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}),
  ])
  if (await unsavedClose.isVisible().catch(() => false)) {
    await unsavedClose.click()
  }
  await expect(modal).not.toBeVisible({ timeout: 3000 })
}

/** Type a variable name into a specific row (closes autocomplete via blur) */
async function typeName(page: Page, modal: Locator, index: number, name: string) {
  const nameInput = modal.locator(`[data-testid="varset-name-input-${index}"]`)
  await nameInput.fill(name)
  // Move focus to Add button to close autocomplete via handleNameBlur.
  // IMPORTANT: Do NOT press Escape here - it bubbles up to Radix Dialog
  // and triggers the unsaved changes confirmation dialog.
  await modal.locator('[data-testid="varset-add-button"]').focus()
  // Wait for layout to stabilize (validation messages, popover close)
  await page.waitForTimeout(300)
}

/** Select a variable type from the dropdown */
async function selectType(page: Page, modal: Locator, index: number, type: string) {
  const typeSelect = modal.locator(`[data-testid="varset-type-select-${index}"]`)
  // Wait for any prior layout shifts to settle
  await typeSelect.waitFor({ state: 'visible' })
  await page.waitForTimeout(100)
  await typeSelect.click()
  // Select from the dropdown
  const option = page.getByRole('option', { name: type, exact: true })
  await expect(option).toBeVisible()
  await option.click()
  // Wait for dropdown to close
  await page.waitForTimeout(100)
}

/**
 * Type an existing variable name to trigger handleNameChange's type-locking logic.
 * handleNameChange checks if the typed name matches an availableVariable and locks
 * the type if so. This avoids autocomplete popover interaction entirely.
 */
async function typeExistingVarName(page: Page, modal: Locator, index: number, varName: string) {
  const nameInput = modal.locator(`[data-testid="varset-name-input-${index}"]`)
  await nameInput.fill(varName)
  // Move focus to close autocomplete via handleNameBlur (no Escape - see typeName)
  await modal.locator('[data-testid="varset-add-button"]').focus()
  await page.waitForTimeout(300)
}

// ---------------------------------------------------------------------------
// Value affordance helpers
// ---------------------------------------------------------------------------

/**
 * The value cell of a row. The inline scalar bodies (scalar-edit-input,
 * scalar-edit-bool-*) share their testids across rows, so they are scoped via
 * the row's value cell - the immediate preceding sibling of the row's
 * expression toggle (name | type | VALUE | {} toggle | delete).
 */
function valueCell(modal: Locator, index: number): Locator {
  return modal
    .locator(`[data-testid="varset-expression-toggle-${index}"]`)
    .locator('xpath=preceding-sibling::*[1]')
}

/** The inline numeric input for an integer/float row. */
function scalarInput(modal: Locator, index: number): Locator {
  return valueCell(modal, index).locator('[data-testid="scalar-edit-input"]')
}

/** The inline boolean segment (true/false) for a boolean row. */
function boolSegment(modal: Locator, index: number, value: 'true' | 'false'): Locator {
  return valueCell(modal, index).locator(`[data-testid="scalar-edit-bool-${value}"]`)
}

/** A string/complex row's Edit-value button (opens the shared sheet). */
function editValueButton(modal: Locator, index: number): Locator {
  return modal.locator(`[data-testid="varset-edit-value-${index}"]`)
}

/** Set a string row's value through the shared "Edit value" sheet. */
async function setStringViaSheet(page: Page, modal: Locator, index: number, value: string) {
  await editValueButton(modal, index).click()
  const sheet = page.locator('[data-testid="value-editor-sheet"]')
  await expect(sheet).toBeVisible()
  const cm = sheet.locator('.cm-content').first()
  await cm.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(value)
  await sheet.locator('[data-testid="value-editor-save-button"]').click()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).not.toBeVisible()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-VARSET-02: Variable Setter Functional Tests', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/canvas/v-plugin-varset-02/01-seed.sh')
  })

  // ========================================================================
  // S1: Add a new string variable - enter name and value
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S1: add new string variable with value', async ({ page }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Row 0 is pre-populated from seed (init_var = "hello")
    const nameInput0 = modal.locator('[data-testid="varset-name-input-0"]')
    await expect(nameInput0).toHaveValue('init_var')

    // Add a new row for the test
    await modal.locator('[data-testid="varset-add-button"]').click()

    // Row 1 should be empty
    const nameInput1 = modal.locator('[data-testid="varset-name-input-1"]')
    await expect(nameInput1).toHaveValue('')

    // Type a variable name in the new row
    await typeName(page, modal, 1, 'greeting')

    // Default type should be String
    const typeSelect = modal.locator('[data-testid="varset-type-select-1"]')
    await expect(typeSelect).toContainText('String')

    // String value edits through the shared "Edit value" sheet.
    await setStringViaSheet(page, modal, 1, 'hello world')
    // The row's Edit-value preview reflects the saved string.
    await expect(editValueButton(modal, 1)).toContainText('hello world')

    await closeModal(page, modal)
  })

  // ========================================================================
  // S2: All scalar variable types - integer, float, boolean
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S2: integer, float, and boolean variable types', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // --- Row 0: Integer (inline scalar edit body, exact text) ---
    await typeName(page, modal, 0, 'my_int')
    await selectType(page, modal, 0, 'Integer')

    const intInput = scalarInput(modal, 0)
    await expect(intInput).toBeVisible()
    await intInput.fill('42')
    await expect(intInput).toHaveValue('42')

    // --- Row 1: Float (inline scalar edit body, exact text) ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 1, 'my_float')
    await selectType(page, modal, 1, 'Float')

    const floatInput = scalarInput(modal, 1)
    await expect(floatInput).toBeVisible()
    await floatInput.fill('3.14')
    await expect(floatInput).toHaveValue('3.14')

    // --- Row 2: Boolean (inline true/false segmented control) ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 2, 'my_bool')
    await selectType(page, modal, 2, 'Boolean')

    // Default is false after type change.
    await expect(boolSegment(modal, 2, 'false')).toHaveAttribute('aria-pressed', 'true')

    // Change to true.
    await boolSegment(modal, 2, 'true').click()
    await expect(boolSegment(modal, 2, 'true')).toHaveAttribute('aria-pressed', 'true')
    await expect(boolSegment(modal, 2, 'false')).toHaveAttribute('aria-pressed', 'false')

    await closeModal(page, modal)
  })

  // ========================================================================
  // S3: Complex variable types - array, map, table
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S3: array, map, and table edit through the shared sheet (no legacy modals)', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    const sheet = page.locator('[data-testid="value-editor-sheet"]')

    // --- Row 0: Array ---
    await typeName(page, modal, 0, 'my_array')
    await selectType(page, modal, 0, 'Array')

    // The complex value affordance is the Edit-value button with a shape summary.
    const arrayEditBtn = editValueButton(modal, 0)
    await expect(arrayEditBtn).toBeVisible()
    await expect(arrayEditBtn).toContainText('0 items') // empty array

    // It opens the shared "Edit value" sheet, NOT the legacy array-editor-modal.
    await arrayEditBtn.click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
    await expect(page.locator('[data-testid="array-editor-modal"]')).toHaveCount(0)
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).not.toBeVisible()

    // --- Row 1: Map ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 1, 'my_map')
    await selectType(page, modal, 1, 'Map')

    const mapEditBtn = editValueButton(modal, 1)
    await expect(mapEditBtn).toBeVisible()
    await expect(mapEditBtn).toContainText('0 pairs') // empty map

    await mapEditBtn.click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('map')
    await expect(page.locator('[data-testid="map-editor-modal"]')).toHaveCount(0)
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).not.toBeVisible()

    // --- Row 2: Table ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 2, 'my_table')
    await selectType(page, modal, 2, 'Table')

    const tableEditBtn = editValueButton(modal, 2)
    await expect(tableEditBtn).toBeVisible()
    await expect(tableEditBtn).toContainText('0 rows x 0 col') // empty table

    // The table edits in the sheet.
    await tableEditBtn.click()
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('table')
    await expect(page.locator('[data-testid="table-editor-modal"]')).toHaveCount(0)
    await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet).not.toBeVisible()

    await closeModal(page, modal)
  })

  // ========================================================================
  // S4: Expression mode toggle
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S4: expression toggle switches value field', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Type a name first (required for expression toggle)
    await typeName(page, modal, 0, 'computed_val')

    // The default (string) row's value affordance is the Edit-value button.
    const editBtn = editValueButton(modal, 0)
    await expect(editBtn).toBeVisible()

    // Toggle expression mode
    const exprToggle = modal.locator('[data-testid="varset-expression-toggle-0"]')
    await exprToggle.click()

    // Edit button is replaced by the inline expression field (CodeMirror).
    await expect(editBtn).not.toBeVisible()
    const exprField = modal.locator('[data-testid="param-input-computed_val"]')
    await expect(exprField).toBeVisible()

    // Type an expression into the CodeMirror editor
    const cmContent = exprField.locator('.cm-content')
    await cmContent.click()
    await page.keyboard.type('len("hello")')

    // Toggle back to literal mode - the Edit button returns.
    await exprToggle.click()
    await expect(editBtn).toBeVisible()
    await expect(exprField).not.toBeVisible()

    await closeModal(page, modal)
  })

  // ========================================================================
  // S5: Autocomplete shows existing variables with type labels
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S5: autocomplete shows variables with type labels', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Row 0 is pre-populated from seed (init_var). Clear it so autocomplete
    // shows all available variables instead of filtering to "init_var".
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    await nameInput.fill('')
    // Blur away and re-focus to reliably trigger autocomplete
    await modal.locator('[data-testid="varset-add-button"]').focus()
    await page.waitForTimeout(200)
    await nameInput.focus()
    await page.waitForTimeout(300)

    // The autocomplete popover renders via Radix Popover portal.
    // Wait for role="option" items (cmdk CommandItem elements).
    const firstOption = page.getByRole('option').first()
    await expect(firstOption).toBeVisible({ timeout: 5000 })

    // Verify variables appear as options with name and type label.
    // Use getByRole('option') to target individual items, avoiding strict mode
    // violations from duplicate type labels like "integer".
    const suiteTimeoutOption = page.getByRole('option', { name: /suite_timeout/ })
    await expect(suiteTimeoutOption).toBeVisible()
    await expect(suiteTimeoutOption).toContainText('integer')

    const regEnvOption = page.getByRole('option', { name: /reg_env/ })
    await expect(regEnvOption).toBeVisible()
    await expect(regEnvOption).toContainText('string')

    const testNameOption = page.getByRole('option', { name: /test_name/ })
    await expect(testNameOption).toBeVisible()
    await expect(testNameOption).toContainText('string')

    // Filter by typing partial name
    await nameInput.fill('suite')
    await page.waitForTimeout(300)
    // Should show only suite-prefixed variables
    await expect(page.getByRole('option', { name: /suite_timeout/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /suite_retries/ })).toBeVisible()
    // Regression and test vars should be filtered out
    await expect(page.getByRole('option', { name: /reg_env/ })).not.toBeVisible()

    // Close autocomplete by moving focus (no Escape - bubbles to Radix Dialog)
    await modal.locator('[data-testid="varset-add-button"]').focus()
    await closeModal(page, modal)
  })

  // ========================================================================
  // S7: Type locking for existing variables from autocomplete
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S7: type is locked when selecting existing variable', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Type an existing suite variable name - handleNameChange locks the type
    await typeExistingVarName(page, modal, 0, 'suite_timeout')

    // Name should be filled
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    await expect(nameInput).toHaveValue('suite_timeout')

    // Type should be locked (disabled) showing "Integer"
    const typeSelect = modal.locator('[data-testid="varset-type-select-0"]')
    await expect(typeSelect).toHaveAttribute('aria-disabled', 'true')
    await expect(typeSelect).toContainText('Integer')

    // The value starts on the integer default, not the variable's current 30 (VARSET-9).
    await expect(scalarInput(modal, 0)).toHaveValue('0')

    await closeModal(page, modal)
  })

  // ========================================================================
  // S8: Delete rows and multi-row management
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S8: delete rows and manage multiple rows', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Add 3 rows total (one exists by default). This test exercises row
    // add/delete management; string values edit via the sheet and are not
    // asserted here, so only names are set.
    await typeName(page, modal, 0, 'var_a')

    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 1, 'var_b')

    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 2, 'var_c')

    // All 3 rows should be visible
    await expect(modal.locator('[data-testid="varset-name-input-0"]')).toHaveValue('var_a')
    await expect(modal.locator('[data-testid="varset-name-input-1"]')).toHaveValue('var_b')
    await expect(modal.locator('[data-testid="varset-name-input-2"]')).toHaveValue('var_c')

    // Delete middle row (var_b)
    await modal.locator('[data-testid="varset-delete-1"]').click()

    // Now row 0 should still be var_a, row 1 should be var_c
    await expect(modal.locator('[data-testid="varset-name-input-0"]')).toHaveValue('var_a')
    await expect(modal.locator('[data-testid="varset-name-input-1"]')).toHaveValue('var_c')
    // Row 2 should no longer exist
    await expect(modal.locator('[data-testid="varset-name-input-2"]')).not.toBeVisible()

    // Delete all rows - should leave one empty row
    await modal.locator('[data-testid="varset-delete-0"]').click()
    await modal.locator('[data-testid="varset-delete-0"]').click()

    // One empty row should remain
    const emptyRow = modal.locator('[data-testid="varset-name-input-0"]')
    await expect(emptyRow).toBeVisible()
    await expect(emptyRow).toHaveValue('')

    await closeModal(page, modal)
  })

  // ========================================================================
  // S9: Save and reopen - variables persist in modal
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S9: variables persist after save and reopen', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // --- Configure row 0: string variable (via the shared sheet) ---
    await typeName(page, modal, 0, 'persist_str')
    await setStringViaSheet(page, modal, 0, 'persisted value')

    // --- Configure row 1: integer variable (inline scalar) ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 1, 'persist_int')
    await selectType(page, modal, 1, 'Integer')
    await scalarInput(modal, 1).fill('99')

    // --- Configure row 2: boolean variable (inline segmented) ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 2, 'persist_bool')
    await selectType(page, modal, 2, 'Boolean')
    await boolSegment(modal, 2, 'true').click()

    // --- Configure row 3: expression variable ---
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 3, 'persist_expr')
    // Toggle expression mode
    await modal.locator('[data-testid="varset-expression-toggle-3"]').click()
    // Type expression into CodeMirror
    const exprField = modal.locator('[data-testid="param-input-persist_expr"]')
    await expect(exprField).toBeVisible()
    const cmContent = exprField.locator('.cm-content')
    await cmContent.click()
    await page.keyboard.type('42 + 1')

    // --- Save ---
    await saveModal(page, modal)

    // --- Reopen modal ---
    const modal2 = await selectNodeAndOpenConfig(page)

    // Verify row 0: string (Edit-value preview reflects the saved value)
    await expect(modal2.locator('[data-testid="varset-name-input-0"]')).toHaveValue(
      'persist_str'
    )
    await expect(editValueButton(modal2, 0)).toContainText('persisted value')

    // Verify row 1: integer (exact text preserved)
    await expect(modal2.locator('[data-testid="varset-name-input-1"]')).toHaveValue(
      'persist_int'
    )
    const type1 = modal2.locator('[data-testid="varset-type-select-1"]')
    await expect(type1).toContainText('Integer')
    await expect(scalarInput(modal2, 1)).toHaveValue('99')

    // Verify row 2: boolean (true segment pressed)
    await expect(modal2.locator('[data-testid="varset-name-input-2"]')).toHaveValue(
      'persist_bool'
    )
    const type2 = modal2.locator('[data-testid="varset-type-select-2"]')
    await expect(type2).toContainText('Boolean')
    await expect(boolSegment(modal2, 2, 'true')).toHaveAttribute('aria-pressed', 'true')

    // Verify row 3: expression (should still be in expression mode)
    await expect(modal2.locator('[data-testid="varset-name-input-3"]')).toHaveValue(
      'persist_expr'
    )
    // Expression mode: the inline expression field is visible (no Edit button).
    await expect(editValueButton(modal2, 3)).not.toBeVisible()
    const exprField2 = modal2.locator('[data-testid="param-input-persist_expr"]')
    await expect(exprField2).toBeVisible()

    await closeModal(page, modal2)
  })

  // ========================================================================
  // S10: Validation - duplicate names and invalid names
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S10: validation for duplicate and invalid names', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Add two rows with the same name
    await typeName(page, modal, 0, 'dup_var')
    await modal.locator('[data-testid="varset-add-button"]').click()
    await typeName(page, modal, 1, 'dup_var')

    // Both rows should show duplicate error (both have 'dup_var')
    const dupErrors = modal.getByText('Duplicate variable name in this setter')
    await expect(dupErrors.first()).toBeVisible()

    // Fix the duplicate
    await modal.locator('[data-testid="varset-name-input-1"]').fill('unique_var')
    await modal.locator('[data-testid="varset-add-button"]').focus()
    await expect(dupErrors.first()).not.toBeVisible()

    // Test Python keyword
    await modal.locator('[data-testid="varset-name-input-1"]').fill('class')
    await modal.locator('[data-testid="varset-add-button"]').focus()

    const kwError = modal.getByText("'class' is a Python keyword")
    await expect(kwError).toBeVisible()

    // Test invalid identifier (starts with number)
    await modal.locator('[data-testid="varset-name-input-1"]').fill('1bad_name')
    await modal.locator('[data-testid="varset-add-button"]').focus()

    const formatError = modal.getByText('Name must start with a letter or underscore')
    await expect(formatError).toBeVisible()

    await closeModal(page, modal)
  })

  // ========================================================================
  // S11: Select existing var from autocomplete and change its value
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S11: select existing variable and set new value', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Type an existing test variable name - handleNameChange locks the type
    await typeExistingVarName(page, modal, 0, 'test_name')

    // Name should be filled
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    await expect(nameInput).toHaveValue('test_name')

    // Value should start empty (VARSET-9) - the string Edit-value button shows
    // the "Edit…" placeholder for an empty value.
    await expect(editValueButton(modal, 0)).toContainText('Edit…')

    // Enter a new value through the shared sheet.
    await setStringViaSheet(page, modal, 0, 'new test name')
    await expect(editValueButton(modal, 0)).toContainText('new test name')

    await closeModal(page, modal)
  })

  // ========================================================================
  // S12: Boolean from regression scope - type locked, value editable
  // ========================================================================

  test('V-PLUGIN-VARSET-02-S12: regression boolean var has locked type', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    const modal = await selectNodeAndOpenConfig(page)

    // Type an existing regression variable name - handleNameChange locks the type
    await typeExistingVarName(page, modal, 0, 'reg_debug')

    // Type should be locked to Boolean
    const typeSelect = modal.locator('[data-testid="varset-type-select-0"]')
    await expect(typeSelect).toHaveAttribute('aria-disabled', 'true')
    await expect(typeSelect).toContainText('Boolean')

    // Boolean value renders as the inline true/false segmented control.
    await expect(boolSegment(modal, 0, 'true')).toBeVisible()
    await expect(boolSegment(modal, 0, 'false')).toBeVisible()

    await closeModal(page, modal)
  })
})
