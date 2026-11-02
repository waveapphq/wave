/**
 * V-EXPORT-SECRETS (functional): the per-export "Secret values" choice end-to-end.
 *
 * REQ: REQ-4.5.1, REQ-5.2.4.9
 *
 * Proves the shared SecretsModePicker drives the emitted secret form on real
 * exports, that the new surfaces (functions, global variables) carry the mode,
 * and that importing a secret sealed by another WAVE instance warns per entity
 * without blocking the import.
 *
 * Pass Criteria:
 * 1. Tests export via the UI dialog in each mode: Mask -> ******** + masked:true
 *    (raw never present); Keep encrypted -> wave:enc:v1: envelope (never the
 *    plaintext); Decrypt -> the real value, only after the amber warning shows.
 * 2. The /functions export dialog carries the Secret values picker (3 options,
 *    Mask default). The functions transform across all three modes + version
 *    history is unit-covered in backend/tests/functions/test_import_export_export.py.
 * 3. Global Variables encrypted export emits the sealed envelope (raw store read).
 * 4. Importing a Global Variable whose secret is sealed by another instance shows
 *    the per-secret foreign-encrypted warning (EXPORT-5); the import still completes and the
 *    imported secret is stored null and stays secret, so it is owed (EXPORT-5): an
 *    encrypted export reads null. V-IMPORT-FOREIGN-SECRETS reads the owed item.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importSystemVariables } from '../../helpers/fixture-import'
import { FOREIGN_ENVELOPE } from '../../helpers/secret-canary'
import fs from 'fs'

type SecretsMode = 'mask' | 'encrypted' | 'plaintext'

const RAW_SECRET = 'top-secret-value'
const PLAIN_VALUE = 'plain-visible'

async function waitForTestsPageLoad(page: Page) {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

/** Create a test carrying one secret + one plain variable; return its id. */
async function createSecretTest(page: Page, name: string): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'export-secrets seed',
      workflow: {
        nodes: [
          {
            id: 'log-1',
            type: 'workflowNode',
            position: { x: 400, y: 100 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              description: 'seed marker',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: {
                values: { message: 'export secrets seed', level: 'INFO' },
                outputBindings: {},
                profileBindings: [],
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [{ id: 'e1', source: 'start-node', target: 'log-1', type: 'default' }],
      },
      variables: {
        plain_var: { type: 'string', value: PLAIN_VALUE, scope: 'test' },
        secret_var: { type: 'string', value: RAW_SECRET, scope: 'test', secret: true },
      },
    },
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const created = await response.json()
  return ((created.data ?? created) as Record<string, unknown>).id as string
}

/** Create a bare library Function (no local variables); return its id. */
async function createLibraryFunction(page: Page, name: string): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'export-secrets seed',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  expect(response.ok(), `POST /functions failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return body.data.id as string
}

async function openTestExportDialog(page: Page) {
  const firstRow = page.locator('[data-testid="test-row"]').first()
  await firstRow.locator('[data-testid="action-menu-trigger"]').click()
  const exportItem = page.locator('[data-testid="action-export"]')
  await expect(exportItem).toBeVisible()
  await exportItem.click()
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })
}

/** Open the export dialog, pick JSON + the given secrets mode, download, and
 *  return the parsed payload. Asserts the amber warning shows for plaintext. */
async function exportTestPayloadInMode(page: Page, mode: SecretsMode): Promise<Record<string, any>> {
  await openTestExportDialog(page)
  await page.locator('[data-testid="format-json"]').click()
  await page.locator(`[data-testid="secrets-mode-${mode}"]`).click()
  if (mode === 'plaintext') {
    await expect(
      page.locator('[data-testid="secrets-plaintext-warning"]'),
      'Decrypt shows the plaintext warning before download',
    ).toBeVisible()
  }
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-button"]').click()
  const download = await downloadPromise
  const content = fs.readFileSync(await download.path(), 'utf-8')
  await expect(
    page.locator('[data-testid="export-dialog"]'),
    'dialog closes after export',
  ).not.toBeVisible()
  return JSON.parse(content)
}

test.describe('V-EXPORT-SECRETS: per-export Secret values choice', () => {
  test('tests export dialog emits mask / encrypted / plaintext per the picker', async ({ page }) => {
    const testName = `Export Secrets ${Date.now()}`
    const testId = await createSecretTest(page, testName)
    try {
      await page.goto('/tests')
      await waitForTestsPageLoad(page)
      await page.getByPlaceholder(/Search tests/i).fill(testName)
      await expect(page.locator('[data-testid="test-row"]')).toHaveCount(1)

      // Mask (default): placeholder + masked flag, raw value never present.
      const masked = await exportTestPayloadInMode(page, 'mask')
      expect(masked.variables.secret_var.value).toBe('********')
      expect(masked.variables.secret_var.masked).toBe(true)
      expect(masked.variables.plain_var.value).toBe(PLAIN_VALUE)
      expect(JSON.stringify(masked), 'raw secret never present in mask export').not.toContain(RAW_SECRET)

      // Keep encrypted: sealed envelope, never the plaintext, no mask flag.
      const encrypted = await exportTestPayloadInMode(page, 'encrypted')
      expect(encrypted.variables.secret_var.value).toMatch(/^wave:enc:v1:/)
      expect(encrypted.variables.secret_var.value).not.toBe(RAW_SECRET)
      expect(encrypted.variables.secret_var.masked).toBeUndefined()
      expect(encrypted.variables.plain_var.value).toBe(PLAIN_VALUE)

      // Decrypt: real value in cleartext (warning was shown before download).
      const plaintext = await exportTestPayloadInMode(page, 'plaintext')
      expect(plaintext.variables.secret_var.value).toBe(RAW_SECRET)
      expect(plaintext.variables.secret_var.masked).toBeUndefined()
      expect(plaintext.variables.plain_var.value).toBe(PLAIN_VALUE)
    } finally {
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
    }
  })

  test('functions export dialog carries the Secret values picker', async ({ page }) => {
    const fnName = `Export Secrets Fn ${Date.now()}`
    const fnId = await createLibraryFunction(page, fnName)
    try {
      await page.goto('/functions')
      await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
      await page.locator('[data-testid="search-input"] input').fill(fnName)
      await expect(
        page.locator('[data-testid="function-name"]').filter({ hasText: fnName }),
      ).toBeVisible()

      await page.locator('[data-testid="action-menu-trigger"]').first().click()
      await page.locator('[data-testid="action-export"]').click()
      await page.waitForSelector('[data-testid="export-dialog"]', { state: 'visible' })

      const dialog = page.locator('[data-testid="export-dialog"]')
      await expect(
        dialog.locator('[data-testid="secrets-mode-picker"]'),
        'functions export dialog carries the Secret values picker',
      ).toBeVisible()
      await expect(dialog.getByRole('radio', { name: 'Mask', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-mask')
      await expect(dialog.getByRole('radio', { name: 'Keep encrypted', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-encrypted')
      await expect(dialog.getByRole('radio', { name: 'Decrypt', exact: true })).toHaveAttribute('data-testid', 'secrets-mode-plaintext')
      await expect(
        dialog.locator('[data-testid="secrets-mode-mask"]'),
        'Mask selected by default',
      ).toHaveAttribute('data-state', 'checked')
    } finally {
      await page.request.delete(`${BACKEND_URL}/functions/${fnId}`)
    }
  })

  test('global variables encrypted export emits the sealed envelope', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/variables/system`)
    const setRes = await page.request.post(`${BACKEND_URL}/variables/system`, {
      data: {
        variables: {
          gv_plain: { type: 'string', value: 'gv-plain-value' },
          gv_secret: { type: 'string', value: 'gv-secret-value', secret: true },
        },
      },
    })
    expect(setRes.ok(), `POST /variables/system failed: ${setRes.status()}`).toBeTruthy()

    const res = await page.request.get(
      `${BACKEND_URL}/variables/system/export?format=json&secrets=encrypted`,
    )
    expect(res.ok(), `GV encrypted export failed: ${res.status()}`).toBeTruthy()

    const parsed = JSON.parse(await res.text())
    expect(parsed.variables.gv_secret.value).toMatch(/^wave:enc:v1:/)
    expect(parsed.variables.gv_secret.value).not.toBe('gv-secret-value')
    expect(parsed.variables.gv_plain.value).toBe('gv-plain-value')

    await page.request.delete(`${BACKEND_URL}/variables/system`)
  })

  test('importing a foreign-encrypted secret warns per entity and still imports', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/variables/system`)

    const fileContent = JSON.stringify({
      variables: {
        imported_token: { type: 'string', value: FOREIGN_ENVELOPE, secret: true },
      },
    })

    const review = await importSystemVariables(page, {
      name: 'foreign-secret.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fileContent),
    })

    // Per-secret foreign-encrypted warning (EXPORT-5, name-carrying); the import still completes.
    expect(review.warnings).toContain(
      "Secret 'imported_token' is encrypted by another WAVE instance and cannot be decrypted here; re-enter it after import",
    )

    // Per EXPORT-5: stored null and still secret; the encrypted export shows the stored value.
    const exportRes = await page.request.get(
      `${BACKEND_URL}/variables/system/export?format=json&secrets=encrypted`,
    )
    expect(exportRes.ok(), `GV encrypted export failed: ${exportRes.status()}`).toBeTruthy()
    const exported = JSON.parse(await exportRes.text())
    expect(exported.variables.imported_token).toMatchObject({ value: null, secret: true })

    await page.request.delete(`${BACKEND_URL}/variables/system`)
  })
})
