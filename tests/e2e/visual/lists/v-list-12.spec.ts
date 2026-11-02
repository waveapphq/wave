/**
 * V-LIST-12: Header Import Button + Row Export Action
 *
 * Main Purpose: Tests list page shows Import button in header and
 * Export action in per-row overflow menu.
 *
 * Pass Criteria:
 * 1. Import button visible in header area
 * 2. Import button has outline variant (secondary style)
 * 3. Import button has upload icon
 * 4. Import button is next to "New Test" button
 * 5. Row overflow menu contains "Export" action
 * 6. Export action has download icon
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// Helper to wait for tests page to fully load with data
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-01/01-seed.sh')
})

test.describe('V-LIST-12: Header Import + Row Export', () => {
  // Pass Criterion 1: Import button visible in header
  test('V-LIST-12-S1: Import button visible in header', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const importButton = page.locator('[data-testid="import-button"]')
    await expect(importButton, 'Import button should be visible').toBeVisible()
    await expect(importButton).toContainText('Import')
  })

  // Pass Criterion 2: Import button has outline variant
  test('V-LIST-12-S2: Import button has outline styling', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const importButton = page.locator('[data-testid="import-button"]')
    // Outline variant maps to btn-secondary class
    const hasOutline = await importButton.evaluate((el) => {
      return el.className.includes('btn-secondary')
    })
    expect(hasOutline, 'Import button should have outline variant styling (btn-secondary)').toBeTruthy()
  })

  // Pass Criterion 3: Import button has upload icon
  test('V-LIST-12-S3: Import button has upload icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const importButton = page.locator('[data-testid="import-button"]')
    // The button should contain an SVG icon (Upload from lucide-react)
    const icon = importButton.locator('svg')
    await expect(icon, 'Import button should have an icon').toBeVisible()
  })

  // Pass Criterion 4: Import button is next to New Test button
  test('V-LIST-12-S4: Import button positioned next to New Test button', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    const importButton = page.locator('[data-testid="import-button"]')
    const newTestButton = page.getByRole('button', { name: /New Test/i })

    const importBox = await importButton.boundingBox()
    const newTestBox = await newTestButton.boundingBox()

    expect(importBox).toBeTruthy()
    expect(newTestBox).toBeTruthy()

    // Import button should be to the left of New Test button
    expect(
      importBox!.x,
      'Import button should be to the left of New Test'
    ).toBeLessThan(newTestBox!.x)

    // They should be on the same line (similar y position)
    expect(
      Math.abs(importBox!.y - newTestBox!.y),
      'Import and New Test buttons should be on the same line'
    ).toBeLessThan(10)
  })

  // Pass Criterion 5: Row overflow menu contains Export action
  test('V-LIST-12-S5: row overflow menu contains Export action', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Open the overflow menu on the first row
    const firstRow = page.locator('[data-testid="test-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    // Export action should be in the dropdown
    const exportItem = page.locator('[data-testid="action-export"]')
    await expect(exportItem, 'Export action should be visible in overflow menu').toBeVisible()
    await expect(exportItem).toContainText('Export')
  })

  // Pass Criterion 6: Export action has download icon
  test('V-LIST-12-S6: Export action has download icon', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Open the overflow menu on the first row
    const firstRow = page.locator('[data-testid="test-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    const exportItem = page.locator('[data-testid="action-export"]')
    await expect(exportItem).toBeVisible()

    // Should contain an SVG icon (Download from lucide-react)
    const icon = exportItem.locator('svg')
    await expect(icon, 'Export action should have a download icon').toBeVisible()
  })
})
