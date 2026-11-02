/**
 * V-PROF-IMPORT-01: Profile Import Dialog
 *
 * Design Decisions: PROFILE-54 (Import button in header)
 *
 * Main Purpose: Import dialog for profiles shows drop zone,
 * file hint, and correct step progression.
 *
 * Pass Criteria:
 * 1. "Import" button visible in profiles header
 * 2. Dialog title: "Import Profiles"
 * 3. Description mentions YAML, JSON, ZIP
 * 4. Drop zone with "Click or drop file here"
 * 5. File hint: ".yaml, .json, or .zip"
 * 6. Validate button disabled when no file selected
 * 7. Cancel button visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'

async function waitForProfilesPage(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
}

async function openImportDialog(page: import('@playwright/test').Page) {
  const importButton = page.locator('[data-testid="import-button"]')
  await importButton.click()
  await page.waitForSelector('[data-testid="import-dialog"]', { state: 'visible' })
}

test.describe('V-PROF-IMPORT-01: Profile Import Dialog', () => {
  // Pass Criterion 1: Import button visible
  test('V-PROF-IMPORT-01-S1: Import button visible in profiles header', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)

    const importButton = page.locator('[data-testid="import-button"]')
    await expect(importButton, 'Import button should be visible').toBeVisible()
    await expect(importButton).toContainText('Import')
  })

  // Pass Criterion 2: Dialog title
  test('V-PROF-IMPORT-01-S2: dialog title is "Import Profiles"', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const dialog = page.locator('[data-testid="import-dialog"]')
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Import Profiles"').toHaveText('Import Profiles')
  })

  // Pass Criterion 3: Description mentions formats
  test('V-PROF-IMPORT-01-S3: description mentions upload formats', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const description = page.locator('[data-testid="import-dialog"] p').first()
    await expect(description).toContainText('YAML')
    await expect(description).toContainText('JSON')
    await expect(description).toContainText('ZIP')
  })

  // Pass Criterion 4: Drop zone
  test('V-PROF-IMPORT-01-S4: drop zone with "Click or drop file here"', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone, 'Drop zone should be visible').toBeVisible()
    await expect(dropZone).toContainText('Click or drop file here')
  })

  // Pass Criterion 5: File hint
  test('V-PROF-IMPORT-01-S5: file hint shows accepted formats', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const dropZone = page.locator('[data-testid="drop-zone"]')
    await expect(dropZone).toContainText('.yaml, .json, or .zip')
  })

  // Pass Criterion 6: Validate button disabled
  test('V-PROF-IMPORT-01-S6: Validate button disabled when no file selected', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const validateButton = page.locator('[data-testid="validate-button"]')
    await expect(validateButton).toBeVisible()
    await expect(validateButton, 'Validate button should be disabled').toBeDisabled()
  })

  // Pass Criterion 7: Cancel button
  test('V-PROF-IMPORT-01-S7: Cancel button visible', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPage(page)
    await openImportDialog(page)

    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()
  })
})
