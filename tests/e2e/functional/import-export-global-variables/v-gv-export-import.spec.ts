/**
 * V-GV-EXPORT-IMPORT: System Variables server-side export/import round-trip
 *
 * REQ: REQ-5.2.4.9
 * System Variables export/import runs through the
 * server-side export/import endpoints, driven through the shared
 * ExportDialog / ImportDialog (no client-side serializer).
 *
 * Pass Criteria:
 * 1. The GV export dialog is the shared ExportDialog WITH the Secret values
 *    picker (hasSecrets=true, Mask default), a single "System Variables"
 *    identity, YAML default.
 * 2. The downloaded .yaml file is REAL YAML (not JSON): JSON.parse rejects it,
 *    and with the Mask default the secret values are masked (********).
 * 3. The JSON variant parses as JSON and carries the same collection.
 * 4. Re-importing the downloaded file through the shared ImportDialog surfaces
 *    conflicts whose resolution select offers ONLY Overwrite / Skip (initial
 *    Overwrite), and the import restores the exported values end-to-end
 *    (table + API reflect the file's values).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, FRONTEND_URL } from '../../helpers/config'
import { cancelVariablesDialog, variablesDialog } from '../../helpers/entity-variables'
import fs from 'fs'

type Page = import('@playwright/test').Page

async function clearSystemVariables(page: Page) {
  await page.request.delete(`${BACKEND_URL}/variables/system`)
}

async function setSystemVariables(page: Page, variables: Record<string, unknown>) {
  const response = await page.request.post(`${BACKEND_URL}/variables/system`, {
    data: { variables },
  })
  expect(response.ok(), `POST /variables/system failed: ${response.status()}`).toBeTruthy()
}

async function getSystemVariables(page: Page) {
  const response = await page.request.get(`${BACKEND_URL}/variables/system`)
  const json = await response.json()
  return json.data.variables
}

async function waitForSettingsPageLoad(page: Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

/** Open the Edit Variables dialog, select all rows, click the bulk Export button. */
async function openExportDialog(page: Page) {
  await page.locator('[data-testid="system-variables-edit-btn"]').click()
  const editDialog = variablesDialog(page)
  await expect(editDialog).toBeVisible()
  await editDialog.getByRole('checkbox', { name: 'Select all' }).click()
  await editDialog.locator('[data-testid="bulk-export-btn"]').click()
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
  return editDialog
}

/** Pick a format in the open export dialog, download, return filename + content. */
async function downloadExport(page: Page, format: 'yaml' | 'json') {
  await page.locator(`[data-testid="format-${format}"]`).click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-button"]').click()
  const download = await downloadPromise
  const content = fs.readFileSync(await download.path(), 'utf-8')
  return { filename: download.suggestedFilename(), content }
}

test.describe('V-GV-EXPORT-IMPORT: System Variables export/import round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await clearSystemVariables(page)
  })

  test('export dialog downloads real YAML with fence-masked secrets', async ({ page }) => {
    await setSystemVariables(page, {
      gv_alpha: { type: 'string', value: 'alpha-original' },
      gv_beta: { type: 'integer', value: 42 },
      gv_secret: { type: 'string', value: 'gv-secret-value', secret: true },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)
    await openExportDialog(page)

    // Shared ExportDialog with the single "System Variables" identity
    // and the Secret values picker (GVs carry the secrets choice).
    const dialog = page.locator('[data-testid="export-dialog"]')
    await expect(
      dialog.getByRole('heading', { level: 2 }),
      'single-collection title',
    ).toHaveText('Export System Variables')
    await expect(dialog.locator('p').first(), 'single-entity description').toHaveText(
      'System Variables',
    )
    await expect(
      dialog.locator('[data-testid="secrets-mode-picker"]'),
      'GV export dialog now has the Secret values picker',
    ).toBeVisible()
    await expect(
      dialog.locator('[data-testid="secrets-mode-mask"]'),
      'Mask selected by default on the GV export dialog',
    ).toHaveAttribute('data-state', 'checked')
    await expect(dialog.locator('[data-testid="format-yaml"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
    await expect(dialog.locator('[data-testid="export-button"]')).toHaveText('Download')

    const { filename, content } = await downloadExport(page, 'yaml')
    expect(filename).toBe('system-variables.yaml')

    // Real YAML, not JSON-in-a-.yaml-file.
    expect(() => JSON.parse(content), 'YAML export must not be JSON').toThrow()
    expect(content).toContain('variables:')
    expect(content).toContain('gv_alpha')
    expect(content).toContain('alpha-original')

    // Secret fence: values arrive pre-masked; the raw secret appears nowhere.
    expect(content).toContain('********')
    expect(content).not.toContain('gv-secret-value')
  })

  test('export JSON variant parses and carries the collection', async ({ page }) => {
    await setSystemVariables(page, {
      gv_alpha: { type: 'string', value: 'alpha-original' },
      gv_secret: { type: 'string', value: 'gv-secret-value', secret: true },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)
    await openExportDialog(page)

    const { filename, content } = await downloadExport(page, 'json')
    expect(filename).toBe('system-variables.json')

    const parsed = JSON.parse(content)
    expect(parsed.variables.gv_alpha.value).toBe('alpha-original')
    expect(parsed.variables.gv_alpha.type).toBe('string')
    expect(parsed.variables.gv_secret.value).toBe('********')
  })

  test('downloaded YAML re-imports via the dialog: overwrite conflict restores values', async ({
    page,
    browser,
  }) => {
    await setSystemVariables(page, {
      gv_alpha: { type: 'string', value: 'alpha-original' },
      gv_beta: { type: 'integer', value: 42 },
    })

    await page.goto('/settings/variables')
    await waitForSettingsPageLoad(page)
    await openExportDialog(page)
    const { content } = await downloadExport(page, 'yaml')
    await cancelVariablesDialog(variablesDialog(page))

    // Drift the live collection so the import has something to restore:
    // gv_alpha mutated (-> conflict + overwrite) and gv_beta dropped (-> ok).
    await setSystemVariables(page, {
      gv_alpha: { type: 'string', value: 'alpha-mutated' },
    })

    // GET /variables/system is served with Cache-Control: max-age=60, so the
    // first context's browser cache still holds the pre-drift collection. The
    // import flow runs in a FRESH context (empty HTTP cache) - a new user
    // session - so the drifted state is what the page genuinely renders.
    const contextB = await browser.newContext({ baseURL: FRONTEND_URL })
    const pageB = await contextB.newPage()
    await pageB.goto('/settings/variables')
    await waitForSettingsPageLoad(pageB)
    const table = pageB.locator('[data-testid="variable-readonly-table"]')
    await expect(table, 'fresh session sees the drifted state').toContainText('alpha-mutated')
    await expect(table).not.toContainText('gv_beta')

    // Re-import the exact downloaded bytes through the shared ImportDialog.
    await pageB.locator('[data-testid="system-variables-import-btn"]').click()
    const importDialog = pageB.locator('[data-testid="import-dialog"]')
    await expect(importDialog).toBeVisible()
    await pageB.setInputFiles('[data-testid="file-input"]', {
      name: 'system-variables.yaml',
      mimeType: 'application/x-yaml',
      buffer: Buffer.from(content),
    })
    await pageB.locator('[data-testid="validate-button"]').click()
    await expect(importDialog.locator('[data-testid="review-step"]')).toBeVisible()

    // gv_alpha conflicts; its resolution select starts at Overwrite and
    // offers ONLY Overwrite / Skip - Auto-rename would break references.
    const alphaResolution = importDialog.locator('[data-testid="resolution-gv_alpha"]')
    await expect(alphaResolution).toContainText('Overwrite')
    await alphaResolution.click()
    const options = pageB.getByRole('option')
    await expect(options).toHaveCount(2)
    await expect(options.filter({ hasText: 'Overwrite' })).toBeVisible()
    await expect(options.filter({ hasText: 'Skip' })).toBeVisible()
    await expect(options.filter({ hasText: 'Auto-rename' })).toHaveCount(0)
    await pageB.keyboard.press('Escape')

    // gv_beta no longer exists, so it validates as importable (no select).
    await expect(importDialog.locator('[data-testid="item-result-gv_beta"]')).toBeVisible()
    await expect(importDialog.locator('[data-testid="resolution-gv_beta"]')).toHaveCount(0)

    await importDialog.locator('[data-testid="import-button"]').click()
    await expect(importDialog).not.toBeVisible()

    // The table the user is looking at reflects the imported values...
    await expect(table).toContainText('alpha-original')
    await expect(table).not.toContainText('alpha-mutated')
    await expect(table).toContainText('gv_beta')

    // ...and so does the persisted collection.
    const vars = await getSystemVariables(page)
    expect(vars.gv_alpha.value).toBe('alpha-original')
    expect(vars.gv_beta.type).toBe('integer')
    expect(vars.gv_beta.value).toBe(42)

    await contextB.close()
  })
})
