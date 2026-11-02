/**
 * V-SUITE-DETAIL-02: Suite Detail Page - Edit Mode & Dialogs
 *
 * Phase: fixture-dark (requires seeded data)
 * Fixture: fixtures/suites/v-suite-detail-02/01-seed.sh
 * REQ: REQ-5.2.1.36 Suite management screen
 *
 * Seeds: 1 suite ("Authentication Suite") with 3 tests + 5 extra tests for picker.
 *
 * Pass Criteria:
 * 1. Clicking "Edit Tests" enters edit mode with Save/Cancel/Add Tests buttons
 * 2. Test picker modal opens with available tests list
 * 3. Edit details dialog shows name, description, tags fields
 * 4. Edit variables dialog shows variable editor
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SUITE_ID = 'c0000002-0001-0001-0001-000000000001'

async function waitForSuiteDetailLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
}

test.describe('V-SUITE-DETAIL-02: Suite Detail Edit Mode', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/suites/v-suite-detail-02/01-seed.sh')
  })

  test('V-SUITE-DETAIL-02-S1: edit tests mode shows Save/Cancel/Add buttons', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Enter edit mode
    const editTestsBtn = page.locator('[data-testid="edit-tests-btn"]')
    await editTestsBtn.click()

    // Save and Cancel buttons should appear
    const saveBtn = page.locator('[data-testid="save-tests-btn"]')
    await expect(saveBtn, 'Save button should be visible in edit mode').toBeVisible()

    const cancelBtn = page.locator('[data-testid="cancel-tests-btn"]')
    await expect(cancelBtn, 'Cancel button should be visible in edit mode').toBeVisible()

    // Add Tests button should be visible
    const addTestsBtn = page.locator('[data-testid="add-tests-button"]')
    await expect(addTestsBtn, 'Add Tests button should be visible in edit mode').toBeVisible()

    // Test rows should have grip handles for drag-and-drop
    const gripHandles = page.locator('[data-testid="dnd-grip-handle"]')
    await expect(gripHandles.first(), 'Grip handle should be visible in edit mode').toBeVisible()

    // Remove buttons should be visible on each row
    const removeBtn = page.locator('[data-testid="test-exclude-btn"]')
    await expect(removeBtn.first(), 'Remove button should be visible in edit mode').toBeVisible()
  })

  test('V-SUITE-DETAIL-02-S2: test picker modal opens with available tests', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Enter edit mode
    await page.locator('[data-testid="edit-tests-btn"]').click()

    // Open test picker
    await page.locator('[data-testid="add-tests-button"]').click()

    // Test picker modal should be visible
    const modal = page.locator('[data-testid="test-picker-modal"]')
    await expect(modal, 'Test picker modal should be visible').toBeVisible()

    // Search input should be visible
    const searchInput = page.locator('[data-testid="test-picker-search"]')
    await expect(searchInput, 'Search input should be visible').toBeVisible()

    // Should have test rows visible (some available, some excluded)
    const testRows = modal.locator('[data-testid="test-picker-test-row"]')
    await expect(testRows.first(), 'At least one test row should be visible').toBeVisible()

    // Add button should be visible
    const addBtn = page.locator('[data-testid="test-picker-add-btn"]')
    await expect(addBtn, 'Add button should be visible').toBeVisible()
  })

  test('V-SUITE-DETAIL-02-S3: edit details dialog shows form fields', async ({ page }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Open edit details dialog
    await page.locator('[data-testid="edit-details-btn"]').click()

    // Dialog should be visible (DialogContent rendered via portal)
    const dialog = page.locator('[data-testid="edit-details-dialog"]')
    await expect(dialog, 'Edit details dialog should be visible').toBeVisible()

    // Name input with current value
    const nameInput = dialog.locator('#edit-name')
    await expect(nameInput, 'Name input should be visible').toBeVisible()
    await expect(nameInput).toHaveValue('Authentication Suite')

    // Description input
    const descInput = dialog.locator('#edit-description')
    await expect(descInput, 'Description input should be visible').toBeVisible()

    // Tags section
    await expect(dialog.locator('label:has-text("Tags")')).toBeVisible()

    // Cancel and Save buttons
    await expect(dialog.locator('[data-testid="edit-dialog-cancel"]')).toBeVisible()
    await expect(dialog.locator('[data-testid="edit-dialog-save"]')).toBeVisible()
  })

  test('V-SUITE-DETAIL-02-S4: edit variables dialog shows variable editor', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await waitForSuiteDetailLoad(page)

    // Open edit variables dialog
    await page.locator('[data-testid="edit-variables-btn"]').click()

    // Dialog should be visible
    const dialog = page.locator('[data-testid="edit-variables-dialog"]')
    await expect(dialog, 'Edit variables dialog should be visible').toBeVisible()

    // Should have existing variable row(s)
    const variableRows = dialog.locator('[data-testid="variable-editor-row"]')
    await expect(variableRows.first(), 'At least one variable row should be visible').toBeVisible()

    // Add variable button
    const addBtn = dialog.locator('[data-testid="add-variable-btn"]')
    await expect(addBtn, 'Add variable button should be visible').toBeVisible()
  })
})
