/**
 * V-ENV-EXPORT-01: Environment Export Dialog
 *
 * Design Decisions: SETTINGS-11 (Export in kebab), SETTINGS-17 (Import button)
 *
 * Main Purpose: Export dialog for environments shows format picker,
 * NO Secret values picker, correct buttons.
 *
 * Pass Criteria:
 * 1. Row kebab menu includes "Export" option
 * 2. Export opens dialog with title "Export Environment"
 * 3. Format picker: YAML (default) and JSON radio buttons
 * 4. No "Secret values" picker (environments have no secrets)
 * 5. Single export shows "Download" button
 * 6. Mass Action dropdown includes "Export" option
 * 7. Bulk selection + Export shows "Download ZIP" button
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

async function waitForSettingsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', { state: 'attached' })
}

async function navigateToEnvironmentsTab(page: import('@playwright/test').Page) {
  await page.goto('/settings/environments')
  await waitForSettingsPageLoad(page)
  await page.waitForSelector('[data-testid="environments-tab"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })
}

async function openExportDialogForFirstEnvironment(page: import('@playwright/test').Page) {
  const firstRow = page.locator('[data-testid="environment-row"]').first()
  const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
  await menuTrigger.click()
  // Wait for menu and click Export
  const exportItem = page.getByRole('menuitem', { name: 'Export' })
  await expect(exportItem).toBeVisible()
  await exportItem.click()
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/settings/v-set-01/01-seed.sh')
})

test.describe('V-ENV-EXPORT-01: Environment Export Dialog', () => {
  // Pass Criterion 1: Row kebab menu includes "Export"
  test('V-ENV-EXPORT-01-S1: row kebab menu includes Export option', async ({ page }) => {
    await navigateToEnvironmentsTab(page)

    const firstRow = page.locator('[data-testid="environment-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    const exportItem = page.getByRole('menuitem', { name: 'Export' })
    await expect(exportItem, 'Export should be in kebab menu').toBeVisible()
  })

  // Pass Criterion 2: Dialog title "Export Environment"
  test('V-ENV-EXPORT-01-S2: dialog title is "Export Environment"', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openExportDialogForFirstEnvironment(page)

    const dialog = page.locator('[data-testid="export-dialog"]')
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Export Environment"').toHaveText('Export Environment')
  })

  // Pass Criterion 3: Format picker with YAML and JSON, YAML default
  test('V-ENV-EXPORT-01-S3: format picker with YAML selected by default', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openExportDialogForFirstEnvironment(page)

    const formatPicker = page.locator('[data-testid="format-picker"]')
    await expect(formatPicker, 'Format picker should be visible').toBeVisible()

    const yamlRadio = page.locator('[data-testid="format-yaml"]')
    await expect(yamlRadio, 'YAML radio should be visible').toBeVisible()
    const yamlState = await yamlRadio.getAttribute('data-state')
    expect(yamlState, 'YAML should be checked by default').toBe('checked')

    const jsonRadio = page.locator('[data-testid="format-json"]')
    await expect(jsonRadio, 'JSON radio should be visible').toBeVisible()
    const jsonState = await jsonRadio.getAttribute('data-state')
    expect(jsonState, 'JSON should be unchecked by default').toBe('unchecked')
  })

  // Pass Criterion 4: No secret values picker
  test('V-ENV-EXPORT-01-S4: no secret values picker for environments', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openExportDialogForFirstEnvironment(page)

    const picker = page.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Secret values picker should NOT be present for environments').toHaveCount(0)
  })

  // Pass Criterion 5: "Download" button for single export
  test('V-ENV-EXPORT-01-S5: Download button for single environment', async ({ page }) => {
    await navigateToEnvironmentsTab(page)
    await openExportDialogForFirstEnvironment(page)

    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton, 'Export button should be visible').toBeVisible()
    await expect(exportButton, 'Button text should be "Download"').toHaveText('Download')
  })

  // Pass Criterion 6: Mass Action dropdown includes Export
  test('V-ENV-EXPORT-01-S6: Mass Action dropdown includes Export', async ({ page }) => {
    await navigateToEnvironmentsTab(page)

    // Enter selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Open the bulk actions dropdown
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await expect(selectionCounter).toBeVisible()
    await selectionCounter.click()

    const exportItem = page.locator('[data-testid="bulk-action-export"]')
    await expect(exportItem, 'Bulk Export option should be visible').toBeVisible()
  })

  // Pass Criterion 7: Bulk selection shows "Download ZIP"
  test('V-ENV-EXPORT-01-S7: bulk export shows Download ZIP button', async ({ page }) => {
    await navigateToEnvironmentsTab(page)

    // Enter selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Select all environments via header checkbox
    const selectAllCheckbox = page.locator('[data-testid="select-all-checkbox"]')
    await selectAllCheckbox.click()

    // Open bulk menu and click Export
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await selectionCounter.click()

    const exportItem = page.locator('[data-testid="bulk-action-export"]')
    await exportItem.click()

    // Verify dialog shows "Download ZIP"
    await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton, 'Bulk export button should say "Download ZIP"').toHaveText('Download ZIP')
  })
})
