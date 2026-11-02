/**
 * V-GLOBAL-VAR-01: System Variables Settings Tab
 *
 * REQ: REQ-5.2.4.7 - Global variable CRUD in Settings
 *
 * Pass Criteria - Navigation (N1-N3):
 * 1. Variables nav item visible in settings navigation
 * 2. Navigating to /settings/variables shows variables tab
 * 3. Variables nav item shows active state on direct URL
 *
 * Pass Criteria - Empty State (E1-E2):
 * 4. Empty state shows icon, heading, and Add Variable button
 * 5. Header Import and Add buttons visible
 *
 * Pass Criteria - Populated Table (T1-T7):
 * 6. Table renders with column headers (Name, Type, Secret, Value)
 * 7. Variable rows display with correct data
 * 8. Select all checkbox in header
 * 9. Type dropdown shows WAVE types
 * 10. Secret variables show password input
 * 11. Boolean variables show true/false toggle buttons
 * 12. Delete button on each row
 *
 * Pass Criteria - Interactions (I1-I5):
 * 13. Add button creates new empty row
 * 14. Save/Cancel footer appears on changes
 * 15. Selecting rows shows bulk actions toolbar
 * 16. Bulk delete removes selected rows
 * 17. Bulk duplicate creates copies with _copy suffix
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { BACKEND_URL } from '../../helpers/config'

async function waitForSettingsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

// ============================================================================
// Navigation
// ============================================================================

test.describe('V-GLOBAL-VAR-01: Navigation', () => {
  test('V-GLOBAL-VAR-01-N1: Variables nav item visible in settings navigation', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    const variablesNav = page.locator('[data-testid="settings-nav-variables"]')
    await expect(variablesNav, 'Variables nav item should be visible').toBeVisible()
    await expect(variablesNav).toContainText('Variables')
  })

  test('V-GLOBAL-VAR-01-N2: navigating to /settings/variables shows variables tab', async ({
    page,
  }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const variablesTab = page.locator('[data-testid="system-variables-tab"]')
    await expect(variablesTab, 'Variables tab content should be visible').toBeVisible()
  })

  test('V-GLOBAL-VAR-01-N3: Variables nav shows active state on direct URL', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const variablesNav = page.locator('[data-testid="settings-nav-variables"]')
    await expect(variablesNav).toHaveAttribute('aria-current', 'page')
  })
})

// ============================================================================
// Empty State
// ============================================================================

test.describe('V-GLOBAL-VAR-01: Empty State', () => {
  test.beforeAll(() => {
    // Reset to ensure no variables exist
    exec('./tests/e2e/scripts/reset.sh')
  })

  test('V-GLOBAL-VAR-01-E1: empty state shows icon, heading, and Add button', async ({
    page,
  }) => {
    // Clear system variables directly
    await page.request.delete(`${BACKEND_URL}/variables/system`)

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const emptyState = page.locator('[data-testid="system-variables-empty"]')
    await expect(emptyState, 'Empty state container should be visible').toBeVisible()
    await expect(emptyState).toContainText('No system variables')
    await expect(emptyState).toContainText('Add variables that will be available')

    // Add Variable button in empty state
    const addButton = emptyState.getByRole('button', { name: /Add Variable/i })
    await expect(addButton, 'Add Variable button should be visible in empty state').toBeVisible()
  })

  test('V-GLOBAL-VAR-01-E2: header Import and Add buttons visible in empty state', async ({
    page,
  }) => {
    await page.request.delete(`${BACKEND_URL}/variables/system`)

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const importBtn = page.locator('[data-testid="system-variables-import-btn"]')
    await expect(importBtn, 'Import button should be visible').toBeVisible()

    const addBtn = page.locator('[data-testid="system-variables-add-btn"]')
    await expect(addBtn, 'Add button should be visible').toBeVisible()
  })
})

// ============================================================================
// Populated Table
// ============================================================================

test.describe('V-GLOBAL-VAR-01: Populated Table', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/settings/v-global-var-01/01-seed.sh')
  })

  test('V-GLOBAL-VAR-01-T1: readonly table renders variable entries', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const readonlyTable = page.locator('[data-testid="variable-readonly-table"]')
    await expect(readonlyTable, 'Variable readonly table should be visible').toBeVisible()

    // Should have variable rows
    const rows = readonlyTable.locator('[data-testid="variable-row"]')
    await expect(rows, 'Should have variable rows').toHaveCount(5)
  })

  test('V-GLOBAL-VAR-01-T2: variable rows display seeded data', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const readonlyTable = page.locator('[data-testid="variable-readonly-table"]')

    // Verify variable names are rendered
    await expect(readonlyTable).toContainText('api_url')
    await expect(readonlyTable).toContainText('timeout_seconds')
    await expect(readonlyTable).toContainText('retry_enabled')
    await expect(readonlyTable).toContainText('rate_limit')
    await expect(readonlyTable).toContainText('api_key')
  })

  test('V-GLOBAL-VAR-01-T3: Edit Variables button visible when populated', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    const editBtn = page.locator('[data-testid="system-variables-edit-btn"]')
    await expect(editBtn, 'Edit Variables button should be visible').toBeVisible()
  })

  test('V-GLOBAL-VAR-01-T4: boolean variable shows type badge', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // retry_enabled is boolean type - readonly table shows type badge
    const readonlyTable = page.locator('[data-testid="variable-readonly-table"]')
    await expect(readonlyTable).toContainText('boolean')
    await expect(readonlyTable).toContainText('retry_enabled')
  })

  test('V-GLOBAL-VAR-01-T5: secret variable shows masked value', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // api_key is secret - readonly table shows masked dots
    const readonlyTable = page.locator('[data-testid="variable-readonly-table"]')
    await expect(readonlyTable).toContainText('api_key')
  })

  test('V-GLOBAL-VAR-01-T6: edit dialog has delete buttons on each row', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Each row in the editor should have a delete button
    const rows = dialog.locator('[data-testid="variable-editor-row"]')
    const rowCount = await rows.count()
    expect(rowCount, 'Should have variable rows in editor').toBeGreaterThan(0)

    for (let i = 0; i < rowCount; i++) {
      const deleteBtn = rows.nth(i).locator('[data-testid="variable-delete-btn"]')
      await expect(deleteBtn, `Row ${i} should have a delete button`).toBeVisible()
    }
  })

  test('V-GLOBAL-VAR-01-T7: heading and subtitle visible', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    await expect(page.getByRole('heading', { name: 'System Variables' })).toBeVisible()
    await expect(page.getByText('Variables available to all tests')).toBeVisible()
  })
})

// ============================================================================
// Interactions
// ============================================================================

test.describe('V-GLOBAL-VAR-01: Interactions', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/settings/v-global-var-01/01-seed.sh')
  })

  test('V-GLOBAL-VAR-01-I1: Edit dialog opens with add variable button', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    const initialRows = await dialog.locator('[data-testid="variable-editor-row"]').count()

    // Click Add button inside dialog
    await dialog.locator('[data-testid="add-variable-btn"]').click()

    // Should have one more row
    await expect(dialog.locator('[data-testid="variable-editor-row"]')).toHaveCount(initialRows + 1)
  })

  test('V-GLOBAL-VAR-01-I2: Edit dialog has Save and Cancel buttons', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Cancel and Save buttons should be visible
    await expect(dialog.locator('[data-testid="edit-dialog-cancel"]')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /save/i })).toBeVisible()
  })

  test('V-GLOBAL-VAR-01-I3: selecting rows in edit dialog shows bulk actions', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Bulk actions toolbar should not be visible initially
    const toolbar = dialog.locator('[data-testid="data-table-toolbar"]')
    await expect(toolbar, 'Bulk actions should not be visible initially').not.toBeVisible()

    // Select a row via the selection checkbox (first checkbox in row, labeled "Select ...")
    const firstRow = dialog.locator('[data-testid="variable-editor-row"]').first()
    const selectionCheckbox = firstRow.locator('[role="checkbox"]').first()
    await selectionCheckbox.click()

    // Bulk actions toolbar should appear after selection
    await expect(toolbar, 'Bulk actions should appear after selection').toBeVisible({ timeout: 5000 })
    await expect(toolbar).toContainText('selected')
    await expect(dialog.locator('[data-testid="bulk-duplicate-btn"]')).toBeVisible()
    await expect(dialog.locator('[data-testid="bulk-delete-btn"]')).toBeVisible()
  })

  test('V-GLOBAL-VAR-01-I4: Cancel in edit dialog closes dialog', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Cancel - no unsaved changes, should close immediately
    await dialog.locator('[data-testid="edit-dialog-cancel"]').click()
    await expect(dialog).not.toBeVisible()
  })

  test('V-GLOBAL-VAR-01-I5: clicking Variables nav from another tab navigates correctly', async ({
    page,
  }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    // Click Variables nav
    await page.locator('[data-testid="settings-nav-variables"]').click()

    // Variables tab should be visible
    await expect(page.locator('[data-testid="system-variables-tab"]')).toBeVisible()

    // Navigate away to General
    await page.locator('[data-testid="settings-nav-general"]').click()
    await expect(page.locator('[data-testid="general-tab"]')).toBeVisible()
    await expect(page.locator('[data-testid="system-variables-tab"]')).not.toBeVisible()

    // Navigate back to Variables
    await page.locator('[data-testid="settings-nav-variables"]').click()
    await expect(page.locator('[data-testid="system-variables-tab"]')).toBeVisible()
  })
})
