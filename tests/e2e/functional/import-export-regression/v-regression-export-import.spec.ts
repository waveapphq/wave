/**
 * Regression Import/Export Functional Tests
 *
 * Verifies regression export/import works end-to-end against the real backend:
 *   - Single export as YAML and JSON
 *   - Export with secrets mask / encrypted / plaintext
 *   - Bulk export returns ZIP archive for 2+ regressions
 *   - Import single YAML/JSON creates regression
 *   - Import with conflict resolution (rename, overwrite, skip)
 *   - Validation: unresolvable suite IDs (fixable), masked secrets (warning), missing name (fatal)
 *   - ZIP round-trip
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export-regression/v-regression-export-import.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createRegressionViaApi,
  deleteRegressionViaApi,
  fetchRegressionViaApi,
  buildRegressionYaml,
  buildRegressionJson,
} from './helpers'

// ---------------------------------------------------------------------------
// Single Regression Export
// ---------------------------------------------------------------------------

test.describe('Export Single Regression', () => {
  let regressionId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    regressionId = await createRegressionViaApi(page, 'Export Test Regression', {
      variables: {
        api_key: { type: 'string', value: 'secret-key-123', secret: true },
        host: { type: 'string', value: 'example.com', secret: false },
      },
      tags: ['export-test'],
    })
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteRegressionViaApi(page, regressionId)
    await page.close()
  })

  test('export as YAML contains regression name', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/regressions/${regressionId}/export?format=yaml&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('yaml')

    const body = await response.text()
    expect(body).toContain('Export Test Regression')
  })

  test('export as JSON is parseable with correct name', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/regressions/${regressionId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.name).toBe('Export Test Regression')
  })

  test('export with secrets=mask masks secret variable values', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/regressions/${regressionId}/export?format=json&secrets=mask`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.variables.api_key.value).toBe('********')
    expect(parsed.variables.api_key.masked).toBe(true)
    expect(parsed.variables.host.value).toBe('example.com')
  })

  test('export with secrets=encrypted keeps the secret sealed', async ({ page }) => {
    // Encrypted mode carries the wave:enc:v1: envelope verbatim - no cleartext,
    // no mask; only this WAVE instance can read it back.
    const response = await page.request.get(
      `${BACKEND_URL}/regressions/${regressionId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.variables.api_key.value).toMatch(/^wave:enc:v1:/)
    expect(parsed.variables.api_key.value).not.toBe('secret-key-123')
    expect(parsed.variables.api_key.masked).toBeUndefined()
    // Non-secret variables are never sealed - they stay cleartext.
    expect(parsed.variables.host.value).toBe('example.com')
  })

  test('export with secrets=plaintext decrypts the secret to cleartext', async ({ page }) => {
    // Decrypt mode writes the real secret in cleartext (for migrating to
    // another WAVE instance).
    const response = await page.request.get(
      `${BACKEND_URL}/regressions/${regressionId}/export?format=json&secrets=plaintext`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.variables.api_key.value).toBe('secret-key-123')
    expect(parsed.variables.api_key.masked).toBeUndefined()
    expect(parsed.variables.host.value).toBe('example.com')
  })
})

// ---------------------------------------------------------------------------
// Bulk Export (ZIP)
// ---------------------------------------------------------------------------

test.describe('Export Multiple Regressions as ZIP', () => {
  const regressionIds: string[] = []

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    regressionIds.push(await createRegressionViaApi(page, 'Bulk Regression A'))
    regressionIds.push(await createRegressionViaApi(page, 'Bulk Regression B'))
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    for (const id of regressionIds) {
      await deleteRegressionViaApi(page, id)
    }
    await page.close()
  })

  test('bulk export of 2+ regressions returns ZIP archive', async ({ page }) => {
    const response = await page.request.post(`${BACKEND_URL}/regressions/export`, {
      data: {
        regression_ids: regressionIds,
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('zip')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('regressions-export.zip')

    // ZIP magic bytes
    const body = await response.body()
    expect(body[0]).toBe(0x50)
    expect(body[1]).toBe(0x4b)
  })
})

// ---------------------------------------------------------------------------
// Single File Import
// ---------------------------------------------------------------------------

test.describe('Import Single Regression', () => {
  test('import valid YAML creates new regression', async ({ page }) => {
    const name = `Import YAML Regression ${Date.now()}`
    const yamlContent = buildRegressionYaml(name)

    const response = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'import-regression.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)
    expect(json.data.imported[0].name).toBe(name)

    // Cleanup
    await deleteRegressionViaApi(page, json.data.imported[0].id)
  })

  test('import valid JSON creates new regression', async ({ page }) => {
    const name = `Import JSON Regression ${Date.now()}`
    const jsonContent = buildRegressionJson(name)

    const response = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'import-regression.json',
          mimeType: 'application/json',
          buffer: Buffer.from(jsonContent),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)

    // Cleanup
    await deleteRegressionViaApi(page, json.data.imported[0].id)
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test.describe('Import Validation', () => {
  test('unresolvable suite IDs are fixable', async ({ page }) => {
    const yaml = buildRegressionYaml('Suite Ref Regression', {
      suites: ['nonexistent-suite-id-abc123'],
    })

    const response = await page.request.post(`${BACKEND_URL}/regressions/import/validate`, {
      multipart: {
        file: {
          name: 'suite-ref.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.regressions[0]
    expect(item.status).toBe('fixable')
    expect(item.fixable_errors[0].code).toBe('UNRESOLVABLE_SUITE')
  })

  test('masked secret variables produce warning', async ({ page }) => {
    const yaml = buildRegressionYaml('Masked Var Regression', {
      variables: {
        token: { type: 'string', value: '********', secret: true },
      },
    })

    const response = await page.request.post(`${BACKEND_URL}/regressions/import/validate`, {
      multipart: {
        file: {
          name: 'masked-var.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.regressions[0]
    expect(item.warnings[0].code).toBe('MASKED_SECRET')
  })

  test('missing name is fatal', async ({ page }) => {
    const yaml = 'description: "No name regression"\nsuites: []\n'

    const response = await page.request.post(`${BACKEND_URL}/regressions/import/validate`, {
      multipart: {
        file: {
          name: 'no-name.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.regressions[0]
    expect(item.status).toBe('fatal')
    expect(item.fatal_errors[0].code).toBe('MISSING_NAME')
  })
})

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

test.describe('Import Conflict Resolution', () => {
  test('rename appends numeric suffix', async ({ page }) => {
    const name = `Rename Regression ${Date.now()}`
    const regressionId = await createRegressionViaApi(page, name)

    const yaml = buildRegressionYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'rename-regression.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'rename' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)
    expect(json.data.imported[0].name).toContain(name)
    expect(json.data.imported[0].name).not.toBe(name)

    // Cleanup
    await deleteRegressionViaApi(page, regressionId)
    await deleteRegressionViaApi(page, json.data.imported[0].id)
  })

  test('skip does not import conflicting regression', async ({ page }) => {
    const name = `Skip Regression ${Date.now()}`
    const regressionId = await createRegressionViaApi(page, name)

    const yaml = buildRegressionYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'skip-regression.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'skip' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(0)
    expect(json.data.total_skipped).toBe(1)

    // Cleanup
    await deleteRegressionViaApi(page, regressionId)
  })

  test('overwrite replaces existing regression', async ({ page }) => {
    const name = `Overwrite Regression ${Date.now()}`
    const regressionId = await createRegressionViaApi(page, name, {
      description: 'Original description',
    })

    const yaml = buildRegressionYaml(name, { tags: ['overwritten'] })
    const response = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'overwrite-regression.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'overwrite' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)
    expect(json.data.imported[0].action).toBe('overwritten')
    expect(json.data.imported[0].id).toBe(regressionId)

    // Verify the overwritten regression has new data
    const fetched = await fetchRegressionViaApi(page, regressionId)
    expect(fetched).not.toBeNull()
    expect((fetched!.tags as string[])).toContain('overwritten')

    // Cleanup
    await deleteRegressionViaApi(page, regressionId)
  })
})

// ---------------------------------------------------------------------------
// ZIP Round-Trip
// ---------------------------------------------------------------------------

test.describe('ZIP Round-Trip', () => {
  test('export as ZIP then import recreates regressions', async ({ page }) => {
    const idA = await createRegressionViaApi(page, 'ZIP RT Regression A')
    const idB = await createRegressionViaApi(page, 'ZIP RT Regression B')

    // Export as ZIP
    const exportResponse = await page.request.post(`${BACKEND_URL}/regressions/export`, {
      data: {
        regression_ids: [idA, idB],
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(exportResponse.ok()).toBeTruthy()
    const zipBuffer = await exportResponse.body()

    // Delete originals
    await deleteRegressionViaApi(page, idA)
    await deleteRegressionViaApi(page, idB)

    // Import the ZIP
    const importResponse = await page.request.post(`${BACKEND_URL}/regressions/import`, {
      multipart: {
        file: {
          name: 'regressions-export.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        },
        conflict_resolutions: '{}',
      },
    })
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    expect(json.data.total_imported).toBe(2)

    const names = json.data.imported.map((r: { name: string }) => r.name)
    expect(names).toContain('ZIP RT Regression A')
    expect(names).toContain('ZIP RT Regression B')

    // Cleanup
    for (const imported of json.data.imported) {
      await deleteRegressionViaApi(page, imported.id)
    }
  })
})
