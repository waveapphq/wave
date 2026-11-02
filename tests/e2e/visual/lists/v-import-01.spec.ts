/**
 * V-IMPORT-01: Import Dialog Step 1
 *
 * Main Purpose: Import dialog step 1 shows drop zone, file hint,
 * and disabled Validate button.
 *
 * Pass Criteria:
 * 1. Dialog title: "Import Tests"
 * 2. Description mentions upload format (YAML, JSON, ZIP)
 * 3. Drop zone visible with upload icon
 * 4. Drop zone text: "Click or drop file here"
 * 5. File hint: ".yaml, .json, or .zip"
 * 6. Validate button disabled when no file selected
 * 7. Cancel button visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'

// Helper to wait for tests page to load (any state)
async function waitForTestsPage(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
}

// Helper to open import dialog
async function openImportDialog(page: import('@playwright/test').Page) {
  const importButton = page.locator('[data-testid="import-button"]')
  await importButton.click()
  await page.waitForSelector('[data-testid="import-dialog"]', { state: 'visible' })
}

test.describe('V-IMPORT-01: Import Dialog Step 1', () => {
  // Pass Criterion 1: Dialog title "Import Tests"
  test('V-IMPORT-01-S1: dialog title is "Import Tests"', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const dialog = page.locator('[data-testid="import-dialog"]')
    await expect(dialog).toBeVisible()

    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Import Tests"').toHaveText('Import Tests')
  })

  // Pass Criterion 2: Description mentions accepted formats
  test('V-IMPORT-01-S2: description mentions upload formats', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const description = page.locator('[data-testid="import-dialog"] p').first()
    await expect(description).toContainText('YAML')
    await expect(description).toContainText('JSON')
    await expect(description).toContainText('ZIP')
  })

  // Pass Criterion 3: Drop zone visible with upload icon
  test('V-IMPORT-01-S3: drop zone visible', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone, 'Drop zone should be visible').toBeVisible()

    // Should have dashed border (border-dashed class)
    const hasDesign = await dropZone.evaluate((el) => el.classList.contains('border-dashed'))
    expect(hasDesign, 'Drop zone should have dashed border').toBeTruthy()
  })

  // Pass Criterion 4: Drop zone text
  test('V-IMPORT-01-S4: drop zone shows "Click or drop file here"', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone).toContainText('Click or drop file here')
  })

  // Pass Criterion 5: File hint
  test('V-IMPORT-01-S5: file hint shows ".yaml, .json, or .zip"', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone).toContainText('.yaml, .json, or .zip')
  })

  // Pass Criterion 6: Validate button disabled
  test('V-IMPORT-01-S6: Validate button disabled when no file selected', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const validateButton = page.locator('[data-testid="validate-button"]')
    await expect(validateButton, 'Validate button should be visible').toBeVisible()
    await expect(validateButton, 'Validate button should be disabled').toBeDisabled()
    await expect(validateButton).toHaveText('Validate')
  })

  // Pass Criterion 7: Cancel button visible
  test('V-IMPORT-01-S7: Cancel button visible', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await openImportDialog(page)

    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()
  })
})
