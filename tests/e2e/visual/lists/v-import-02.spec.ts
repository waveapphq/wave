/**
 * V-IMPORT-02: Import Dialog Step 2 (ok/fixable)
 *
 * Main Purpose: Import dialog step 2 shows validation results for
 * ok and fixable statuses with appropriate icons and labels.
 *
 * Pass Criteria:
 * 1. Review step visible after validation
 * 2. Ok test: green check icon visible
 * 3. Fixable test: warning icon visible
 * 4. Fixable test: "Will auto-fix" label
 * 5. Import summary shows importable/blocked counts
 * 6. Description shows "N of M tests can be imported"
 * 7. Import button enabled (all tests importable)
 * 8. Back button visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'

// Mock validation response with ok and fixable results
const MOCK_VALIDATE_OK_FIXABLE = {
  tests: [
    {
      name: 'Clean Test',
      status: 'ok',
      fatal_errors: [],
      fixable_errors: [],
      warnings: [],
      existing_test_id: null,
    },
    {
      name: 'Fixable Test',
      status: 'fixable',
      fatal_errors: [],
      fixable_errors: [{ code: 'MISSING_VERSION', message: 'Version field missing, will default to 1.0.0' }],
      warnings: [],
      existing_test_id: null,
    },
  ],
  total: 2,
  importable: 2,
  blocked: 0,
}

// Helper to wait for tests page to load
async function waitForTestsPage(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
}

// Helper to open import dialog, set a file, mock API, and click Validate
async function navigateToReviewStep(page: import('@playwright/test').Page) {
  // Mock the validate endpoint (API wraps result in { data: ... })
  await page.route('**/tests/import/validate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: MOCK_VALIDATE_OK_FIXABLE }),
    })
  })

  // Open import dialog
  const importButton = page.locator('[data-testid="import-button"]')
  await importButton.click()
  await page.waitForSelector('[data-testid="import-dialog"]', { state: 'visible' })

  // Set a file via the hidden input
  const fileInput = page.locator('[data-testid="file-input"]')
  await fileInput.setInputFiles({
    name: 'test.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from('name: Test\nversion: "1.0.0"\n'),
  })

  // Click Validate
  const validateButton = page.locator('[data-testid="validate-button"]')
  await expect(validateButton).toBeEnabled()
  await validateButton.click()

  // Wait for review step to appear
  await page.waitForSelector('[data-testid="review-step"]', { state: 'visible' })
}

test.describe('V-IMPORT-02: Import Step 2 (ok/fixable)', () => {
  // Pass Criterion 1: Review step visible
  test('V-IMPORT-02-S1: review step visible after validation', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const reviewStep = page.locator('[data-testid="review-step"]')
    await expect(reviewStep, 'Review step should be visible').toBeVisible()
  })

  // Pass Criterion 2: Ok test has green check icon
  test('V-IMPORT-02-S2: ok test shows check icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const okRow = page.locator('[data-testid="item-result-Clean Test"]')
    await expect(okRow).toBeVisible()
    await expect(okRow).toContainText('Clean Test')

    // Check icon should be present (CheckCircle renders as svg with class text-success)
    const successIcon = okRow.locator('.icon.text-success')
    await expect(successIcon, 'Ok test should have success (green) icon').toBeVisible()
  })

  // Pass Criterion 3: Fixable test has warning icon
  test('V-IMPORT-02-S3: fixable test shows warning icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const fixableRow = page.locator('[data-testid="item-result-Fixable Test"]')
    await expect(fixableRow).toBeVisible()
    await expect(fixableRow).toContainText('Fixable Test')

    // Warning icon should be present (AlertTriangle with text-warning)
    const warningIcon = fixableRow.locator('.icon.text-warning')
    await expect(warningIcon, 'Fixable test should have warning icon').toBeVisible()
  })

  // Pass Criterion 4: Fixable test "Will auto-fix" label
  test('V-IMPORT-02-S4: fixable test shows "Will auto-fix" label', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const fixableRow = page.locator('[data-testid="item-result-Fixable Test"]')
    await expect(fixableRow).toContainText('Will auto-fix')
  })

  // Pass Criterion 5: Import summary
  test('V-IMPORT-02-S5: import summary shows importable and blocked counts', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const summary = page.locator('[data-testid="import-summary"]')
    await expect(summary, 'Import summary should be visible').toBeVisible()
    await expect(summary).toContainText('2 importable')
    await expect(summary).toContainText('0 blocked')
  })

  // Pass Criterion 6: Description shows counts
  test('V-IMPORT-02-S6: description shows importable count', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const description = page.locator('[data-testid="import-dialog"] p').first()
    await expect(description).toContainText('2 of 2 tests can be imported')
  })

  // Pass Criterion 7: Import button enabled
  test('V-IMPORT-02-S7: Import button enabled when all tests importable', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const importButton = page.locator('[data-testid="import-dialog"] [data-testid="import-button"]')
    await expect(importButton, 'Import button should be visible').toBeVisible()
    await expect(importButton, 'Import button should be enabled').toBeEnabled()
    await expect(importButton).toHaveText('Import')
  })

  // Pass Criterion 8: Back button visible
  test('V-IMPORT-02-S8: Back button visible in step 2', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page)

    const backButton = page.locator('[data-testid="back-button"]')
    await expect(backButton, 'Back button should be visible').toBeVisible()
    await expect(backButton).toHaveText('Back')
  })
})
