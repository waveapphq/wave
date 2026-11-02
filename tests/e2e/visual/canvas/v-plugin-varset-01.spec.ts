/**
 * V-PLUGIN-VARSET-01: Var Setter Config Modal
 *
 * Phase: no-data (parallel) - control metadata is hardcoded, no backend data needed
 * Design Decisions: VARSET-1 through VARSET-10
 * REQ: REQ-3.4.1.14 Variable Setter Control
 *
 * Pass Criteria:
 * 1. Var Setter can be dropped from palette onto canvas
 * 2. Config modal opens with custom inline editor (not generic ParameterTable)
 * 3. Empty state: one empty row with name field (VARSET-10)
 * 4. Each row: Name, Type (defaults string), Value, Expression toggle, Delete (VARSET-1)
 * 5. "+ Add" button inserts new empty row (VARSET-2)
 * 6. No scope selector - scope is automatic
 * 7. No outputs section (var setter has no outputs)
 * 8. Version shows 1.0.0
 * 9. Per-variable expression toggle (VARSET-6)
 * 10. Details dialog shows documentation
 * 11. Changelog dialog shows entries
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-PLUGIN-VARSET-01: Var Setter Config Modal', () => {
  // No backend data needed - control metadata is hardcoded
  // Runs in parallel no-data phase

  // Helper to search palette
  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to drop Var Setter control on canvas and select it
  async function dropVarSetterAndSelect(page: import('@playwright/test').Page) {
    await expandPalette(page)
    await findItemBySearch(page, 'var setter')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(
      page,
      { term: 'var setter', testId: 'palette-item-variable-setter' },
      { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    )
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
  // V-PLUGIN-VARSET-01-S1: Empty state shows one empty row - VARSET-10
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S1: empty state shows inline variable editor with empty row', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Custom inline editor should be visible (not generic param-row-variables)
    // Per VARSET-10: modal opens with one empty row ready for input
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveValue('')

    // "Variables" header should be visible
    await expect(modal.getByText('Variables')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S2: Row contains all required elements - VARSET-1
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S2: each row has name, type, value, expression toggle, delete', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Per VARSET-1: Each row has Name, Type, Value editor, Expression toggle, Delete.
    // The default (string) row's value affordance is the Edit-value button that
    // opens the shared sheet.
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    const typeSelect = modal.locator('[data-testid="varset-type-select-0"]')
    const valueField = modal.locator('[data-testid="varset-edit-value-0"]')
    const exprToggle = modal.locator('[data-testid="varset-expression-toggle-0"]')
    const deleteBtn = modal.locator('[data-testid="varset-delete-0"]')

    await expect(nameInput).toBeVisible()
    await expect(typeSelect).toBeVisible()
    await expect(valueField).toBeVisible()
    await expect(exprToggle).toBeVisible()
    await expect(deleteBtn).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S3: Type defaults to string - VARSET-5
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S3: type selector defaults to string for new variables', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Per VARSET-5: defaults to "string" for new variables
    const typeSelect = modal.locator('[data-testid="varset-type-select-0"]')
    await expect(typeSelect).toContainText('String')
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S4: Add button inserts new row - VARSET-2
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S4: add button inserts a new empty row', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Per VARSET-2: "+ Add" inserts a new empty row inline
    const addButton = modal.locator('[data-testid="varset-add-button"]')
    await expect(addButton).toBeVisible()
    await addButton.click()

    // Now there should be two name inputs (row 0 and row 1)
    const nameInput1 = modal.locator('[data-testid="varset-name-input-1"]')
    await expect(nameInput1).toBeVisible()
    await expect(nameInput1).toHaveValue('')
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S5: No scope selector
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S5: no scope parameter in config modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Scope parameter row should NOT exist (scope is automatic)
    const scopeRow = modal.locator('[data-testid="param-row-scope"]')
    await expect(scopeRow).not.toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S6: No outputs section
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S6: no outputs section in config modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Outputs section should not be visible (variable setter has 0 outputs)
    const outputsSection = modal.locator('[data-testid="outputs-section"]')
    await expect(outputsSection).not.toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S7: Version shows 1.0.0
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S7: version selector shows 1.0.0', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Version selector should show 1.0.0
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toContainText('1.0.0')
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S8: Per-variable expression toggle - VARSET-6
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S8: per-variable expression toggle works', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Type a variable name first
    const nameInput = modal.locator('[data-testid="varset-name-input-0"]')
    await nameInput.fill('myvar')
    // Dismiss autocomplete by moving focus to a neutral control. Clicking the
    // string row's Edit button would open the value sheet; Escape cancels the modal.
    await modal.locator('[data-testid="varset-add-button"]').focus()

    // Per VARSET-6: expression toggle per variable
    const exprToggle = modal.locator('[data-testid="varset-expression-toggle-0"]')
    await exprToggle.click()

    // After toggle, the string row's Edit-value button is replaced by the inline
    // expression field (no {x} badge).
    await expect(modal.locator('[data-testid="varset-edit-value-0"]')).not.toBeVisible()
    await expect(modal.locator('[data-testid="param-input-myvar"]')).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S9: Details dialog shows documentation
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S9: details dialog opens and shows documentation', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Open details dialog
    const detailsBtn = modal.getByRole('button', { name: 'Details' })
    await expect(detailsBtn).toBeVisible()
    await detailsBtn.click()

    // Wait for details dialog
    const detailsDialog = page.locator('[role="dialog"]').first()
    await expect(detailsDialog).toBeVisible({ timeout: 10000 })

    // Should contain Var Setter-specific content
    await expect(detailsDialog.getByText('Set variables in the execution context')).toBeVisible()

    // Version badge should show 1.0.0
    const versionBadge = detailsDialog.getByText('1.0.0')
    await expect(versionBadge).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S10: Changelog dialog shows entries
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S10: changelog dialog opens with entries', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Open changelog dialog
    const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
    await changelogBtn.click()

    // Wait for changelog dialog
    const changelogDialog = page.locator('[role="dialog"]').first()
    await expect(changelogDialog).toBeVisible()

    // Should show changelog entries (5 items per control-metadata.ts)
    const changelogItems = changelogDialog.locator('li')
    await expect(changelogItems).toHaveCount(5)

    // Should contain key entry about setting variables
    await expect(
      changelogDialog.getByText(/Set variables in the execution context/)
    ).toBeVisible()

    // Should show release date
    await expect(changelogDialog.getByText(/Released:/)).toBeVisible()
  })

  // ==========================================================================
  // V-PLUGIN-VARSET-01-S11: No generic ParameterTable for variable setter
  // ==========================================================================

  test('V-PLUGIN-VARSET-01-S11: uses custom editor not generic param table', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await dropVarSetterAndSelect(page)
    const modal = await openConfigModal(page)

    // Generic param-row-variables should NOT be present (custom editor replaces it)
    const genericRow = modal.locator('[data-testid="param-row-variables"]')
    await expect(genericRow).not.toBeVisible()

    // Custom varset editor elements should be present instead
    const varsetAdd = modal.locator('[data-testid="varset-add-button"]')
    await expect(varsetAdd).toBeVisible()
  })
})
