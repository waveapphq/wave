/**
 * V-ENV-IMPORT-01: Environment Import Dialog
 *
 * Design Decisions: SETTINGS-17 (Import button in header)
 *
 * Main Purpose: Import dialog for environments shows drop zone,
 * file hint, and correct step progression.
 *
 * Pass Criteria:
 * 1. "Import" button visible in environments header
 * 2. Dialog title: "Import Environments"
 * 3. Drop zone visible with "Click or drop file here" text
 * 4. File hint: ".yaml, .json, or .zip"
 * 5. Validate button disabled when no file selected
 * 6. Cancel button visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'

async function waitForSettingsPage(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', { state: 'attached' })
}

async function navigateToEnvironmentsTab(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await waitForSettingsPage(page)
  const envNav = page.locator('[data-testid="settings-nav"]').getByText('Environments')
  await envNav.click()
  await page.waitForSelector('[data-testid="environments-tab"]', { state: 'visible' })
}

async function openImportDialog(page: import('@playwright/test').Page) {
  const importButton = page.locator('[data-testid="import-button"]')
  await importButton.click()
  await page.waitForSelector('[data-testid="import-dialog"]', { state: 'visible' })
}

test.describe('V-ENV-IMPORT-01: Environment Import Dialog', () => {
  // Pass Criterion 1: Import button visible
  test('V-ENV-IMPORT-01-S1: Import button visible in environments header', async ({ page }) => {
    await navigateToEnvironmentsTab(page)

    const importButton = page.locator('[data-testid="import-button"]')
    await expect(importButton, 'Import button should be visible').toBeVisible()
    await expect(importButton).toContainText('Import')
  })

  // Pass Criterion 2: Dialog title
  test('V-ENV-IMPORT-01-S2: dialog title is "Import Environments"', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openImportDialog(page)

    const dialog = page.locator('[data-testid="import-dialog"]')
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Import Environments"').toHaveText('Import Environments')
  })

  // Pass Criterion 3: Drop zone
  test('V-ENV-IMPORT-01-S3: drop zone with "Click or drop file here"', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone, 'Drop zone should be visible').toBeVisible()
    await expect(dropZone).toContainText('Click or drop file here')

    const hasDashed = await dropZone.evaluate((el) => el.classList.contains('border-dashed'))
    expect(hasDashed, 'Drop zone should have dashed border').toBeTruthy()
  })

  // Pass Criterion 4: File hint
  test('V-ENV-IMPORT-01-S4: file hint shows accepted formats', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone).toContainText('.yaml, .json, or .zip')
  })

  // Pass Criterion 5: Validate button disabled
  test('V-ENV-IMPORT-01-S5: Validate button disabled when no file selected', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openImportDialog(page)

    const validateButton = page.locator('[data-testid="validate-button"]')
    await expect(validateButton, 'Validate button should be visible').toBeVisible()
    await expect(validateButton, 'Validate button should be disabled').toBeDisabled()
    await expect(validateButton).toHaveText('Validate')
  })

  // Pass Criterion 6: Cancel button
  test('V-ENV-IMPORT-01-S6: Cancel button visible', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openImportDialog(page)

    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()
  })
})
