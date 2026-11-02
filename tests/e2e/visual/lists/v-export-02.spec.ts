/**
 * V-EXPORT-02: Export Dialog Bulk
 *
 * Main Purpose: Bulk export dialog shows test count in title and
 * "Download ZIP" button.
 *
 * Pass Criteria:
 * 1. Dialog title: "Export N tests" (shows count; shared-dialog entityLabel
 *    convention)
 * 2. "Download ZIP" button (not "Download")
 * 3. Format picker visible (YAML/JSON)
 * 4. Secret values picker visible (SecretsModePicker)
 * 5. Description: "Select format and options for export."
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for tests page to fully load with data
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

// Helper to select tests and open bulk export dialog
async function openBulkExportDialog(page: import('@playwright/test').Page) {
  // Enter selection mode
  const massActionButton = page.getByText('Mass Action')
  await massActionButton.click()

  // Wait for checkboxes to appear
  await page.waitForSelector('[data-testid="row-checkbox"]', { state: 'visible' })

  // Select first two tests
  const checkboxes = page.locator('[data-testid="row-checkbox"]')
  await checkboxes.nth(0).click()
  await checkboxes.nth(1).click()

  // Open bulk actions dropdown
  const selectionCounter = page.locator('[data-testid="selection-counter"]')
  await selectionCounter.click()

  // Click Export in bulk dropdown
  const bulkExport = page.locator('[data-testid="bulk-action-export"]')
  await expect(bulkExport).toBeVisible()
  await bulkExport.click()

  // Wait for export dialog
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-01/01-seed.sh')
})

test.describe('V-EXPORT-02: Export Dialog Bulk', () => {
  // Pass Criterion 1: Dialog title shows count
  test('V-EXPORT-02-S1: dialog title shows "Export N tests" with count', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openBulkExportDialog(page)

    const dialog = page.locator('[data-testid="export-dialog"]')
    await expect(dialog).toBeVisible()

    // Title should show count (we selected 2 tests)
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should show test count').toHaveText('Export 2 tests')
  })

  // Pass Criterion 2: "Download ZIP" button
  test('V-EXPORT-02-S2: Download ZIP button for bulk export', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openBulkExportDialog(page)

    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton, 'Export button should be visible').toBeVisible()
    await expect(
      exportButton,
      'Button text should be "Download ZIP" for bulk export'
    ).toHaveText('Download ZIP')
  })

  // Pass Criterion 3: Format picker visible
  test('V-EXPORT-02-S3: format picker visible in bulk dialog', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openBulkExportDialog(page)

    const formatPicker = page.locator('[data-testid="format-picker"]')
    await expect(formatPicker, 'Format picker should be visible').toBeVisible()

    const yamlRadio = page.locator('[data-testid="format-yaml"]')
    await expect(yamlRadio, 'YAML radio should be visible').toBeVisible()

    const jsonRadio = page.locator('[data-testid="format-json"]')
    await expect(jsonRadio, 'JSON radio should be visible').toBeVisible()
  })

  // Pass Criterion 4: Secret values picker visible
  test('V-EXPORT-02-S4: secret values picker visible in bulk dialog', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openBulkExportDialog(page)

    const picker = page.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Secret values picker should be visible in bulk dialog').toBeVisible()
    await expect(
      page.locator('[data-testid="secrets-mode-mask"]'),
      'Mask selected by default in bulk dialog'
    ).toHaveAttribute('data-state', 'checked')
  })

  // Pass Criterion 5: Generic description for bulk export
  test('V-EXPORT-02-S5: description shows generic text for bulk export', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openBulkExportDialog(page)

    const description = page.locator('[data-testid="export-dialog"] p').first()
    await expect(
      description,
      'Description should show generic text for bulk export'
    ).toContainText('Select format and options for export')
  })
})
