/**
 * V-PROF-EXPORT-01: Profile Export Dialog
 *
 * Design Decisions: PROFILE-5 (Mass Action: Export, Duplicate, Delete),
 *                   PROFILE-54 (Import button in header)
 *
 * Main Purpose: Export dialog for profiles shows format picker,
 * Secret values picker (present), correct buttons.
 *
 * Pass Criteria:
 * 1. Row kebab menu includes "Export" option
 * 2. Export opens dialog with title "Export Profile"
 * 3. Format picker: YAML (default) and JSON radio buttons
 * 4. "Secret values" picker IS present with Mask default
 * 5. Single export shows "Download" button
 * 6. Mass Action dropdown includes "Export" option
 * 7. Bulk selection + Export shows "Download ZIP" button
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

async function waitForProfilesPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="profile-row"]', { state: 'visible' })
}

async function openExportDialogForFirstProfile(page: import('@playwright/test').Page) {
  const firstRow = page.locator('[data-testid="profile-row"]').first()
  const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
  await menuTrigger.click()
  const exportItem = page.getByRole('menuitem', { name: 'Export' })
  await expect(exportItem).toBeVisible()
  await exportItem.click()
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/profiles/v-prof-01/01-seed.sh')
})

test.describe('V-PROF-EXPORT-01: Profile Export Dialog', () => {
  // Pass Criterion 1: Row kebab menu includes "Export"
  test('V-PROF-EXPORT-01-S1: row kebab menu includes Export option', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    const firstRow = page.locator('[data-testid="profile-row"]').first()
    const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
    await menuTrigger.click()

    const exportItem = page.getByRole('menuitem', { name: 'Export' })
    await expect(exportItem, 'Export should be in kebab menu').toBeVisible()
  })

  // Pass Criterion 2: Dialog title "Export Profile"
  test('V-PROF-EXPORT-01-S2: dialog title is "Export Profile"', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)
    await openExportDialogForFirstProfile(page)

    const dialog = page.locator('[data-testid="export-dialog"]')
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Export Profile"').toHaveText('Export Profile')
  })

  // Pass Criterion 3: Format picker with YAML default
  test('V-PROF-EXPORT-01-S3: format picker with YAML selected by default', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)
    await openExportDialogForFirstProfile(page)

    const formatPicker = page.locator('[data-testid="format-picker"]')
    await expect(formatPicker).toBeVisible()

    const yamlRadio = page.locator('[data-testid="format-yaml"]')
    const yamlState = await yamlRadio.getAttribute('data-state')
    expect(yamlState, 'YAML should be checked by default').toBe('checked')

    const jsonRadio = page.locator('[data-testid="format-json"]')
    const jsonState = await jsonRadio.getAttribute('data-state')
    expect(jsonState, 'JSON should be unchecked').toBe('unchecked')
  })

  // Pass Criterion 4: Secret values picker present with Mask default
  test('V-PROF-EXPORT-01-S4: secret values picker present with Mask default', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)
    await openExportDialogForFirstProfile(page)

    const picker = page.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Secret values picker should be visible for profiles').toBeVisible()

    // Exact labels + Mask preselected
    await expect(picker.getByRole('radio', { name: 'Mask', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-mask')
    await expect(picker.getByRole('radio', { name: 'Keep encrypted', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-encrypted')
    await expect(picker.getByRole('radio', { name: 'Decrypt', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-plaintext')
    await expect(page.locator('[data-testid="secrets-mode-mask"]')).toHaveAttribute('data-state', 'checked')
  })

  // Pass Criterion 5: "Download" button for single export
  test('V-PROF-EXPORT-01-S5: Download button for single profile', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)
    await openExportDialogForFirstProfile(page)

    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton).toBeVisible()
    await expect(exportButton, 'Button text should be "Download"').toHaveText('Download')
  })

  // Pass Criterion 6: Mass Action dropdown includes Export
  test('V-PROF-EXPORT-01-S6: Mass Action dropdown includes Export', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Enter selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Open bulk actions dropdown
    const selectionCounter = page.locator('[data-testid="selection-counter"]')
    await expect(selectionCounter).toBeVisible()
    await selectionCounter.click()

    const exportItem = page.locator('[data-testid="bulk-action-export"]')
    await expect(exportItem, 'Bulk Export option should be visible').toBeVisible()
  })

  // Pass Criterion 7: Bulk export shows "Download ZIP"
  test('V-PROF-EXPORT-01-S7: bulk export shows Download ZIP button', async ({ page }) => {
    await page.goto('/profiles')
    await waitForProfilesPageLoad(page)

    // Enter selection mode
    const massActionButton = page.getByRole('button', { name: /Mass Action/i })
    await massActionButton.click()

    // Select all profiles via header checkbox
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
    await expect(exportButton, 'Bulk button should say "Download ZIP"').toHaveText('Download ZIP')
  })
})
