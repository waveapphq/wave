/**
 * V-IMPORT-03: Import Dialog Step 2 (conflict/fatal)
 *
 * Main Purpose: Import dialog step 2 shows conflict resolution
 * dropdown and Blocked label for fatal errors.
 *
 * Pass Criteria:
 * 1. Conflict test: resolution dropdown visible
 * 2. Resolution dropdown default: "Auto-rename"
 * 3. Resolution dropdown options: Auto-rename, Overwrite, Skip
 * 4. Fatal test: "Blocked" label visible
 * 5. Fatal test: error icon visible (red)
 * 6. Conflict test: warning icon visible
 * 7. Import summary shows blocked count > 0
 * 8. Import button disabled when all tests blocked
 */

import { test, expect } from '../../helpers/playwright-fixtures'

// Mock validation response with conflict and fatal results
const MOCK_VALIDATE_CONFLICT_FATAL = {
  tests: [
    {
      name: 'Conflicting Test',
      status: 'conflict',
      fatal_errors: [],
      fixable_errors: [],
      warnings: [],
      existing_test_id: 'existing-test-id-1',
    },
    {
      name: 'Fatal Test',
      status: 'fatal',
      fatal_errors: [{ code: 'INVALID_SCHEMA', message: 'Schema validation failed' }],
      fixable_errors: [],
      warnings: [],
      existing_test_id: null,
    },
  ],
  total: 2,
  importable: 1,
  blocked: 1,
}

// Mock with ALL fatal tests (to test disabled Import button)
const MOCK_VALIDATE_ALL_FATAL = {
  tests: [
    {
      name: 'Bad Test 1',
      status: 'fatal',
      fatal_errors: [{ code: 'INVALID_SCHEMA', message: 'Schema validation failed' }],
      fixable_errors: [],
      warnings: [],
      existing_test_id: null,
    },
    {
      name: 'Bad Test 2',
      status: 'fatal',
      fatal_errors: [{ code: 'MISSING_NAME', message: 'Name field is required' }],
      fixable_errors: [],
      warnings: [],
      existing_test_id: null,
    },
  ],
  total: 2,
  importable: 0,
  blocked: 2,
}

// Helper to wait for tests page to load
async function waitForTestsPage(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
}

// Helper to navigate to review step with specific mock
async function navigateToReviewStep(
  page: import('@playwright/test').Page,
  mockResponse: typeof MOCK_VALIDATE_CONFLICT_FATAL
) {
  // Mock the validate endpoint
  // API wraps result in { data: ... }
  await page.route('**/tests/import/validate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: mockResponse }),
    })
  })

  // Open import dialog
  const importButton = page.locator('[data-testid="import-button"]')
  await importButton.click()
  await page.waitForSelector('[data-testid="import-dialog"]', { state: 'visible' })

  // Set a file
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

  // Wait for review step
  await page.waitForSelector('[data-testid="review-step"]', { state: 'visible' })
}

test.describe('V-IMPORT-03: Import Step 2 (conflict/fatal)', () => {
  // Pass Criterion 1: Conflict test has resolution dropdown
  test('V-IMPORT-03-S1: conflict test shows resolution dropdown', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const conflictRow = page.locator('[data-testid="item-result-Conflicting Test"]')
    await expect(conflictRow).toBeVisible()
    await expect(conflictRow).toContainText('Conflicting Test')

    // Resolution dropdown should be visible
    const resolutionDropdown = page.locator('[data-testid="resolution-Conflicting Test"]')
    await expect(resolutionDropdown, 'Resolution dropdown should be visible for conflict').toBeVisible()
  })

  // Pass Criterion 2: Default resolution is "Auto-rename"
  test('V-IMPORT-03-S2: resolution dropdown defaults to Auto-rename', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const resolutionDropdown = page.locator('[data-testid="resolution-Conflicting Test"]')
    await expect(resolutionDropdown).toContainText('Auto-rename')
  })

  // Pass Criterion 3: Resolution dropdown has all options
  test('V-IMPORT-03-S3: resolution dropdown has Auto-rename, Overwrite, Skip options', async ({
    page,
  }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    // Open the resolution dropdown
    const resolutionDropdown = page.locator('[data-testid="resolution-Conflicting Test"]')
    await resolutionDropdown.click()

    // Wait for dropdown options
    await page.waitForSelector('[role="option"]', { state: 'visible' })

    // Verify all three options
    const options = page.locator('[role="option"]')
    const optionTexts = await options.allTextContents()
    expect(optionTexts, 'Should have Auto-rename option').toContain('Auto-rename')
    expect(optionTexts, 'Should have Overwrite option').toContain('Overwrite')
    expect(optionTexts, 'Should have Skip option').toContain('Skip')
  })

  // Pass Criterion 4: Fatal test "Blocked" label
  test('V-IMPORT-03-S4: fatal test shows "Blocked" label', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const fatalRow = page.locator('[data-testid="item-result-Fatal Test"]')
    await expect(fatalRow).toBeVisible()
    await expect(fatalRow).toContainText('Fatal Test')
    await expect(fatalRow, 'Fatal test should show "Blocked" label').toContainText('Blocked')
  })

  // Pass Criterion 5: Fatal test error icon (red)
  test('V-IMPORT-03-S5: fatal test shows error (red) icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const fatalRow = page.locator('[data-testid="item-result-Fatal Test"]')
    const errorIcon = fatalRow.locator('.icon.text-error')
    await expect(errorIcon, 'Fatal test should have error (red) icon').toBeVisible()
  })

  // Pass Criterion 6: Conflict test warning icon
  test('V-IMPORT-03-S6: conflict test shows warning icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const conflictRow = page.locator('[data-testid="item-result-Conflicting Test"]')
    const warningIcon = conflictRow.locator('.icon.text-warning')
    await expect(warningIcon, 'Conflict test should have warning icon').toBeVisible()
  })

  // Pass Criterion 7: Import summary shows blocked count
  test('V-IMPORT-03-S7: import summary shows blocked count', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_CONFLICT_FATAL)

    const summary = page.locator('[data-testid="import-summary"]')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('1 importable')
    await expect(summary).toContainText('1 blocked')
  })

  // Pass Criterion 8: Import button disabled when all tests blocked
  test('V-IMPORT-03-S8: Import button disabled when all tests blocked', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPage(page)
    await navigateToReviewStep(page, MOCK_VALIDATE_ALL_FATAL)

    const importButton = page.locator('[data-testid="import-dialog"] [data-testid="import-button"]')
    await expect(importButton, 'Import button should be visible').toBeVisible()
    await expect(
      importButton,
      'Import button should be disabled when all tests are blocked'
    ).toBeDisabled()
  })
})
