/**
 * V-EXPORT-01: Export Dialog Single Test
 *
 * The list uses the shared ExportDialog, whose title is
 * "Export {entityLabel}" = "Export test".
 *
 * Pass Criteria:
 * 1. Dialog title: "Export test" (shared-dialog entityLabel convention)
 * 2. Format picker radio group with YAML and JSON options
 * 3. YAML selected by default
 * 4. "Secret values" radio group (Mask / Keep encrypted / Decrypt), Mask
 *    default; selecting Decrypt reveals the plaintext warning
 * 5. "Download" button (not "Download ZIP")
 * 6. Cancel button visible
 * 7. Test name shown as dialog description
 * 8. Downloading with defaults yields a YAML file with secrets masked
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'

// Helper to wait for tests page to fully load with data
async function waitForTestsPageLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

// Helper to open export dialog for the first test via row action menu
async function openExportDialogForFirstTest(page: import('@playwright/test').Page) {
  const firstRow = page.locator('[data-testid="test-row"]').first()
  const menuTrigger = firstRow.locator('[data-testid="action-menu-trigger"]')
  await menuTrigger.click()
  // Wait for dropdown menu to appear and click Export
  const exportItem = page.locator('[data-testid="action-export"]')
  await expect(exportItem).toBeVisible()
  await exportItem.click()
  // Wait for export dialog to open
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/lists/v-list-01/01-seed.sh')
})

test.describe('V-EXPORT-01: Export Dialog Single Test', () => {
  // Pass Criterion 1: Dialog title "Export test"
  test('V-EXPORT-01-S1: dialog title is "Export test" for single test', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const dialog = page.locator('[data-testid="export-dialog"]')
    await expect(dialog).toBeVisible()

    // Title should be "Export test" (not "Export N tests")
    const title = dialog.getByRole('heading', { level: 2 })
    await expect(title, 'Dialog title should be "Export test"').toHaveText('Export test')
  })

  // Pass Criterion 2: Format picker with YAML and JSON
  test('V-EXPORT-01-S2: format picker shows YAML and JSON radio buttons', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const formatPicker = page.locator('[data-testid="format-picker"]')
    await expect(formatPicker, 'Format picker should be visible').toBeVisible()

    const yamlRadio = page.locator('[data-testid="format-yaml"]')
    await expect(yamlRadio, 'YAML radio button should be visible').toBeVisible()

    const jsonRadio = page.locator('[data-testid="format-json"]')
    await expect(jsonRadio, 'JSON radio button should be visible').toBeVisible()

    // Labels should be visible
    const yamlLabel = page.locator('label[for="format-yaml"]')
    await expect(yamlLabel).toHaveText('YAML')

    const jsonLabel = page.locator('label[for="format-json"]')
    await expect(jsonLabel).toHaveText('JSON')
  })

  // Pass Criterion 3: YAML selected by default
  test('V-EXPORT-01-S3: YAML is selected by default', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const yamlRadio = page.locator('[data-testid="format-yaml"]')
    const yamlState = await yamlRadio.getAttribute('data-state')
    expect(yamlState, 'YAML radio should be checked by default').toBe('checked')

    const jsonRadio = page.locator('[data-testid="format-json"]')
    const jsonState = await jsonRadio.getAttribute('data-state')
    expect(jsonState, 'JSON radio should be unchecked by default').toBe('unchecked')
  })

  // Pass Criterion 4: Secret values radio group (SecretsModePicker)
  test('V-EXPORT-01-S4: secret values picker shows 3 options, Mask default, Decrypt warning', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const picker = page.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Secret values picker should be visible').toBeVisible()

    // Three options with exact labels (Mask / Keep encrypted / Decrypt)
    await expect(picker.getByRole('radio', { name: 'Mask', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-mask')
    await expect(picker.getByRole('radio', { name: 'Keep encrypted', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-encrypted')
    await expect(picker.getByRole('radio', { name: 'Decrypt', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-plaintext')

    // Mask selected by default; the other two unchecked
    await expect(page.locator('[data-testid="secrets-mode-mask"]')).toHaveAttribute('data-state', 'checked')
    await expect(page.locator('[data-testid="secrets-mode-encrypted"]')).toHaveAttribute('data-state', 'unchecked')
    await expect(page.locator('[data-testid="secrets-mode-plaintext"]')).toHaveAttribute('data-state', 'unchecked')

    // No plaintext warning until Decrypt is chosen
    await expect(page.locator('[data-testid="secrets-plaintext-warning"]')).toHaveCount(0)

    // Selecting Decrypt reveals the amber warning with exact copy
    await page.locator('[data-testid="secrets-mode-plaintext"]').click()
    const warning = page.locator('[data-testid="secrets-plaintext-warning"]')
    await expect(warning, 'Decrypt reveals the plaintext warning').toBeVisible()
    await expect(warning).toContainText(
      'Secrets will be written in plain text. Handle the exported file securely.'
    )
  })

  // Pass Criterion 5: "Download" button (not "Download ZIP")
  test('V-EXPORT-01-S5: Download button for single test export', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const exportButton = page.locator('[data-testid="export-button"]')
    await expect(exportButton, 'Export button should be visible').toBeVisible()
    await expect(exportButton, 'Button text should be "Download" for single test').toHaveText('Download')
  })

  // Pass Criterion 6: Cancel button visible
  test('V-EXPORT-01-S6: Cancel button visible', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await openExportDialogForFirstTest(page)

    const cancelButton = page.getByRole('button', { name: /Cancel/i })
    await expect(cancelButton, 'Cancel button should be visible').toBeVisible()
  })

  // Pass Criterion 7: Test name in dialog description
  test('V-EXPORT-01-S7: test name shown in dialog description', async ({ page }) => {
    await page.goto('/tests')
    await waitForTestsPageLoad(page)

    // Get the first test's name before opening the dialog
    const firstName = await page.locator('[data-testid="test-name"]').first().textContent()
    expect(firstName).toBeTruthy()

    await openExportDialogForFirstTest(page)

    // Dialog description should contain the test name
    const description = page.locator('[data-testid="export-dialog"] p').first()
    await expect(
      description,
      'Dialog description should show the test name'
    ).toContainText(firstName!)
  })

  // Pass Criterion 8: the default dialog flow still
  // downloads a YAML file with secrets masked.
  test('V-EXPORT-01-S8: default export downloads YAML with masked secrets', async ({ page }) => {
    const testName = `Masked Export Guard ${Date.now()}`
    const createResponse = await page.request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: testName,
        version: '1.0.0',
        description: 'Secret-masking download guard for the shared export dialog',
        workflow: {
          nodes: [
            {
              id: 'log-guard-1',
              type: 'workflowNode',
              position: { x: 400, y: 100 },
              data: {
                label: 'Log',
                elementType: 'log',
                nodeType: 'plugin',
                category: 'system',
                version: '1.0.0',
                description: 'Guard marker',
                hasNewerVersion: false,
                expressionFields: [],
                templateFields: [],
                variableExpressionKeys: [],
                config: {
                  values: { message: 'masked export guard', level: 'INFO' },
                  outputBindings: {},
                  profileBindings: [],
                },
              },
              measured: { width: 120, height: 62 },
            },
          ],
          edges: [{ id: 'e1', source: 'start-node', target: 'log-guard-1', type: 'default' }],
        },
        variables: {
          plain_var: { type: 'string', value: 'visible_value', scope: 'test' },
          secret_var: { type: 'string', value: 'super_secret_password', scope: 'test', secret: true },
        },
      },
    })
    expect(createResponse.ok(), `POST /tests failed: ${createResponse.status()}`).toBeTruthy()
    const created = await createResponse.json()
    const testId = ((created.data ?? created) as Record<string, unknown>).id as string

    await page.goto('/tests')
    await waitForTestsPageLoad(page)
    await page.getByPlaceholder(/Search tests/i).fill(testName)
    await expect(page.locator('[data-testid="test-row"]')).toHaveCount(1)
    await openExportDialogForFirstTest(page)

    // Defaults untouched: YAML + mask secrets checked.
    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-testid="export-button"]').click()
    const download = await downloadPromise
    // The server names the download so a test carrying files can come down as a
    // zip; it hyphenates whitespace, the same rule a batch export has always used.
    expect(download.suggestedFilename()).toBe(`${testName.replace(/\s+/g, '-')}.yaml`)

    const content = fs.readFileSync(await download.path(), 'utf-8')
    expect(() => JSON.parse(content), 'export is YAML, not JSON').toThrow()
    expect(content).toContain(testName)
    expect(content, 'secret masked by default').toContain('********')
    expect(content, 'raw secret appears nowhere').not.toContain('super_secret_password')
    expect(content, 'plain values exported as-is').toContain('visible_value')

    await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
  })
})
