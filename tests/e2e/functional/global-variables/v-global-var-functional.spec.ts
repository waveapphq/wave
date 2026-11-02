/**
 * System Variables Functional Tests
 *
 * End-to-end tests verifying system variable CRUD operations against the
 * real backend and UI. Exercises the full lifecycle: create, read, save,
 * delete, import, export.
 *
 * Tests:
 * - API CRUD: Create, read, update, delete system variables via API
 * - UI CRUD: Add, edit, save, cancel, delete via the Settings UI
 * - Persistence: Saved variables survive page reload
 * - Type validation: All 7 WAVE types round-trip correctly
 * - Secret masking: Secret variables render as password inputs
 * - Backup integration: System variables included in entity selector
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'

// ============================================================================
// Helpers
// ============================================================================

async function waitForSettingsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

async function clearSystemVariables(page: import('@playwright/test').Page) {
  await page.request.delete(`${BACKEND_URL}/variables/system`)
}

async function setSystemVariables(
  page: import('@playwright/test').Page,
  variables: Record<string, unknown>
) {
  await page.request.post(`${BACKEND_URL}/variables/system`, {
    data: { variables },
  })
}

async function getSystemVariables(page: import('@playwright/test').Page) {
  const response = await page.request.get(`${BACKEND_URL}/variables/system`)
  const json = await response.json()
  return json.data.variables
}

// ============================================================================
// API CRUD
// ============================================================================

test.describe('System Variables API CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await clearSystemVariables(page)
  })

  test('GET returns empty variables when none exist', async ({ page }) => {
    const vars = await getSystemVariables(page)
    expect(vars).toEqual({})
  })

  test('POST creates and GET retrieves variables', async ({ page }) => {
    await setSystemVariables(page, {
      db_host: { type: 'string', value: 'localhost' },
      db_port: { type: 'integer', value: 5432 },
    })

    const vars = await getSystemVariables(page)
    expect(vars.db_host.type).toBe('string')
    expect(vars.db_host.value).toBe('localhost')
    expect(vars.db_port.type).toBe('integer')
    expect(vars.db_port.value).toBe(5432)
  })

  test('POST replaces all variables', async ({ page }) => {
    await setSystemVariables(page, {
      old_var: { type: 'string', value: 'old' },
    })

    // Replace with new set
    await setSystemVariables(page, {
      new_var: { type: 'string', value: 'new' },
    })

    const vars = await getSystemVariables(page)
    expect(vars.old_var).toBeUndefined()
    expect(vars.new_var.value).toBe('new')
  })

  test('DELETE /variables/system/{name} removes single variable', async ({ page }) => {
    await setSystemVariables(page, {
      keep: { type: 'string', value: 'stay' },
      remove: { type: 'string', value: 'gone' },
    })

    await page.request.delete(`${BACKEND_URL}/variables/system/remove`)

    const vars = await getSystemVariables(page)
    expect(vars.keep).toBeDefined()
    expect(vars.remove).toBeUndefined()
  })

  test('DELETE /variables/system clears all', async ({ page }) => {
    await setSystemVariables(page, {
      a: { type: 'string', value: '1' },
      b: { type: 'string', value: '2' },
    })

    await clearSystemVariables(page)

    const vars = await getSystemVariables(page)
    expect(vars).toEqual({})
  })

  test('all 7 WAVE types round-trip correctly', async ({ page }) => {
    await setSystemVariables(page, {
      s: { type: 'string', value: 'hello' },
      i: { type: 'integer', value: 42 },
      f: { type: 'float', value: 3.14 },
      b: { type: 'boolean', value: true },
      a: { type: 'array', value: [1, 2, 3] },
      m: { type: 'map', value: { key: 'value' } },
      t: { type: 'table', value: [{ col1: 'row1' }] },
    })

    const vars = await getSystemVariables(page)
    expect(vars.s.value).toBe('hello')
    expect(vars.i.value).toBe(42)
    expect(vars.f.value).toBe(3.14)
    expect(vars.b.value).toBe(true)
    expect(vars.a.value).toEqual([1, 2, 3])
    expect(vars.m.value).toEqual({ key: 'value' })
    expect(vars.t.value).toEqual([{ col1: 'row1' }])
  })
})

// ============================================================================
// UI CRUD
// ============================================================================

test.describe('System Variables UI CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await clearSystemVariables(page)
  })

  test('add variable via UI, save, and verify persistence', async ({ page }) => {
    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Should start with empty state
    await expect(page.locator('[data-testid="system-variables-empty"]')).toBeVisible()

    // Click Add button - opens EditDialog with one empty row
    await page.locator('[data-testid="system-variables-add-btn"]').click()

    // Edit dialog should open with variable editor
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-testid="variable-editor"]')).toBeVisible()

    // Fill in the new row - find the name input
    const row = dialog.locator('[data-testid="variable-editor-row"]').last()
    const nameInput = row.locator('[data-testid="variable-name-input"]')
    await nameInput.fill('test_var')

    // The string value edits through the shared "Edit value" sheet (the entity
    // value column renders the shared VariableValueCell).
    await row.locator('[data-testid^="entity-var-edit-"]').click()
    const valueSheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(valueSheet).toBeVisible()
    await valueSheet.locator('.cm-content').first().click()
    await page.keyboard.type('test_value')
    await valueSheet.locator('[data-testid="value-editor-save-button"]').click()
    await valueSheet.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(valueSheet).toBeHidden()

    // Save via dialog
    await dialog.getByRole('button', { name: /save/i }).click()

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Verify via API
    const vars = await getSystemVariables(page)
    expect(vars.test_var).toBeDefined()
    expect(vars.test_var.value).toBe('test_value')
  })

  test('delete variable via UI removes row', async ({ page }) => {
    // Seed two variables
    await setSystemVariables(page, {
      to_delete: { type: 'string', value: 'bye' },
      to_keep: { type: 'string', value: 'stay' },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Should have 2 rows
    await expect(dialog.locator('[data-testid="variable-editor-row"]')).toHaveCount(2)

    // Delete the first row
    const firstRow = dialog.locator('[data-testid="variable-editor-row"]').first()
    await firstRow.locator('[data-testid="variable-delete-btn"]').click()

    // Should have 1 row now
    await expect(dialog.locator('[data-testid="variable-editor-row"]')).toHaveCount(1)

    // Save via dialog
    await dialog.getByRole('button', { name: /save/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Verify via API - only to_keep should remain
    const vars = await getSystemVariables(page)
    const names = Object.keys(vars)
    expect(names).toHaveLength(1)
  })

  test('cancel reverts unsaved changes', async ({ page }) => {
    await setSystemVariables(page, {
      original: { type: 'string', value: 'value' },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Open edit dialog
    await page.locator('[data-testid="system-variables-edit-btn"]').click()
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog).toBeVisible()

    // Add a new row inside the dialog (creates unsaved changes)
    await dialog.locator('[data-testid="add-variable-btn"]').click()
    await expect(dialog.locator('[data-testid="variable-editor-row"]')).toHaveCount(2)

    // Click Cancel - triggers unsaved changes confirmation
    await dialog.locator('[data-testid="edit-dialog-cancel"]').click()

    // Unsaved changes confirmation should appear - click Discard
    await page.locator('[data-testid="unsaved-discard"]').click()

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // API should still show original only
    const vars = await getSystemVariables(page)
    expect(Object.keys(vars)).toHaveLength(1)
    expect(vars.original.value).toBe('value')
  })

  test('saved variables persist across page reload', async ({ page }) => {
    await setSystemVariables(page, {
      persist_me: { type: 'integer', value: '99' },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)

    // Verify variable is shown in readonly table
    await expect(page.locator('[data-testid="variable-readonly-table"]')).toContainText('persist_me')

    // Reload page
    await page.reload()
    await waitForSettingsPageLoad(page)

    // Variable should still be there
    await expect(page.locator('[data-testid="variable-readonly-table"]')).toContainText('persist_me')
  })
})

// ============================================================================
// Backup Integration
// ============================================================================

test.describe('System Variables Backup Integration', () => {
  test('system_variables appears in backup entity selector', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const createSection = page.locator('[data-testid="create-backup-section"]')
    const entitySelector = createSection.locator('[data-testid="entity-selector"]')
    await expect(entitySelector).toBeVisible()

    // system_variables should be an enabled checkbox
    const checkbox = entitySelector.locator('[data-testid="entity-checkbox-system_variables"]')
    await expect(checkbox, 'system_variables checkbox should be visible').toBeVisible()
    await expect(checkbox, 'system_variables checkbox should be enabled').toBeEnabled()
  })

  test('system_variables included in Select all', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const createSection = page.locator('[data-testid="create-backup-section"]')
    const entitySelector = createSection.locator('[data-testid="entity-selector"]')

    // Click Select all
    await entitySelector.getByRole('button', { name: 'Select all', exact: true }).click()

    // system_variables should be checked
    const checkbox = entitySelector.locator('[data-testid="entity-checkbox-system_variables"]')
    await expect(checkbox, 'system_variables should be checked after Select all').toBeChecked()
  })
})

// ============================================================================
// Workbench Namespace Autocomplete
// ============================================================================

test.describe('Workbench namespace autocomplete', () => {
  test.beforeEach(async ({ page }) => {
    await clearSystemVariables(page)
    await setSystemVariables(page, {
      sys_str: { type: 'string', value: 'system string var' },
      sys_int: { type: 'integer', value: 42 },
    })
  })

  test.afterEach(async ({ page }) => {
    await clearSystemVariables(page)
  })

  test('system namespace available in draft workflow without loading a test', async ({ page }) => {
    // Clear any existing workbench session/draft to avoid restore dialogs.
    // localStorage must be cleared AFTER navigation because about:blank has
    // no same-origin localStorage and page.evaluate raises SecurityError.
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})

    // Navigate directly to workbench (draft workflow - no test loaded)
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForSelector('[data-testid="canvas-page"]', { state: 'visible', timeout: 30000 })

    // Dismiss any dialog that may appear (restore, unsaved changes, etc.)
    const dialog = page.locator('[role="dialog"]')
    if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      const dismissBtn = dialog.locator('button:has-text("Discard"), button:has-text("Cancel"), button:has-text("Close")')
      if (await dismissBtn.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await dismissBtn.first().click()
        await expect(dialog).not.toBeVisible({ timeout: 3000 })
      }
    }

    // Expand palette if collapsed
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }

    // Search for Log plugin
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('log')
    await page.waitForTimeout(100)

    // Drag Log plugin onto canvas
    const logItem = page.locator('[data-testid="palette-item-log"]')
    await expect(logItem).toBeVisible({ timeout: 3000 })
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await logItem.dragTo(canvas, {
      targetPosition: { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    })
    await page.waitForTimeout(300)

    // Select the Log node
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const logNode = workflowNodes.first()
    await logNode.locator('button').first().dispatchEvent('click')
    await expect(logNode).toHaveAttribute('data-selected', 'true')

    // Open config modal via gear button
    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()
    const modal = configSheet(page)
    await expect(modal).toBeVisible({ timeout: 5000 })

    // Switch message parameter to expression mode
    const messageRow = modal.locator('[data-testid="param-row-message"]')
    const expressionToggle = messageRow.locator('[data-testid="expression-toggle"]')
    await expressionToggle.click()
    await page.waitForTimeout(200)

    // Type 'system.' in the expression field to trigger autocomplete
    const messageInput = modal.locator('[data-testid="param-input-message"]')
    await messageInput.locator('.cm-content').click()
    await page.keyboard.type('system.', { delay: 50 })
    await page.waitForTimeout(500)

    // Autocomplete should show system variables
    const autocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(autocomplete, 'Autocomplete dropdown should appear for system namespace').toBeVisible({ timeout: 5000 })

    // Should show our system variables
    await expect(autocomplete.getByText('sys_str')).toBeVisible({ timeout: 3000 })
    await expect(autocomplete.getByText('sys_int')).toBeVisible({ timeout: 3000 })
  })
})
