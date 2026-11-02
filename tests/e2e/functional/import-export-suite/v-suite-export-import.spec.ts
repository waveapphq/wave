/**
 * Suite Import/Export Functional Tests
 *
 * Verifies suite export/import works end-to-end against the real backend:
 *   - Single export as YAML and JSON
 *   - Export with secrets mask / encrypted / plaintext
 *   - Bulk export returns ZIP archive for 2+ suites
 *   - Import single YAML/JSON creates suite
 *   - Import with conflict resolution (rename, overwrite, skip)
 *   - Validation: unresolvable test IDs (fixable), masked secrets (warning), missing name (fatal)
 *   - ZIP round-trip
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export-suite/v-suite-export-import.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createSuiteViaApi,
  deleteSuiteViaApi,
  fetchSuiteViaApi,
  buildSuiteYaml,
  buildSuiteJson,
} from './helpers'

// ---------------------------------------------------------------------------
// Single Suite Export
// ---------------------------------------------------------------------------

test.describe('Export Single Suite', () => {
  let suiteId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    suiteId = await createSuiteViaApi(page, 'Export Test Suite', {
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
    await deleteSuiteViaApi(page, suiteId)
    await page.close()
  })

  test('export as YAML contains suite name', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/suites/${suiteId}/export?format=yaml&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('yaml')

    const body = await response.text()
    expect(body).toContain('Export Test Suite')
  })

  test('export as JSON is parseable with correct name', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/suites/${suiteId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.name).toBe('Export Test Suite')
  })

  test('export with secrets=mask masks secret variable values', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/suites/${suiteId}/export?format=json&secrets=mask`
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
      `${BACKEND_URL}/suites/${suiteId}/export?format=json&secrets=encrypted`
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
      `${BACKEND_URL}/suites/${suiteId}/export?format=json&secrets=plaintext`
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

test.describe('Export Multiple Suites as ZIP', () => {
  const suiteIds: string[] = []

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    suiteIds.push(await createSuiteViaApi(page, 'Bulk Suite A'))
    suiteIds.push(await createSuiteViaApi(page, 'Bulk Suite B'))
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    for (const id of suiteIds) {
      await deleteSuiteViaApi(page, id)
    }
    await page.close()
  })

  test('bulk export of 2+ suites returns ZIP archive', async ({ page }) => {
    const response = await page.request.post(`${BACKEND_URL}/suites/export`, {
      data: {
        suite_ids: suiteIds,
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('zip')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('suites-export.zip')

    // ZIP magic bytes
    const body = await response.body()
    expect(body[0]).toBe(0x50)
    expect(body[1]).toBe(0x4b)
  })
})

// ---------------------------------------------------------------------------
// Single File Import
// ---------------------------------------------------------------------------

test.describe('Import Single Suite', () => {
  test('import valid YAML creates new suite', async ({ page }) => {
    const name = `Import YAML Suite ${Date.now()}`
    const yamlContent = buildSuiteYaml(name)

    const response = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'import-suite.yaml',
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
    await deleteSuiteViaApi(page, json.data.imported[0].id)
  })

  test('import valid JSON creates new suite', async ({ page }) => {
    const name = `Import JSON Suite ${Date.now()}`
    const jsonContent = buildSuiteJson(name)

    const response = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'import-suite.json',
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
    await deleteSuiteViaApi(page, json.data.imported[0].id)
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test.describe('Import Validation', () => {
  test('unresolvable test IDs are fixable', async ({ page }) => {
    const yaml = buildSuiteYaml('Test Ref Suite', {
      tests: ['nonexistent-test-id-abc123'],
    })

    const response = await page.request.post(`${BACKEND_URL}/suites/import/validate`, {
      multipart: {
        file: {
          name: 'test-ref.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.suites[0]
    expect(item.status).toBe('fixable')
    expect(item.fixable_errors[0].code).toBe('UNRESOLVABLE_TEST')
  })

  test('masked secret variables produce warning', async ({ page }) => {
    const yaml = buildSuiteYaml('Masked Var Suite', {
      variables: {
        token: { type: 'string', value: '********', secret: true },
      },
    })

    const response = await page.request.post(`${BACKEND_URL}/suites/import/validate`, {
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
    const item = json.data.suites[0]
    expect(item.warnings[0].code).toBe('MASKED_SECRET')
  })

  test('missing name is fatal', async ({ page }) => {
    const yaml = 'description: "No name suite"\ntests: []\n'

    const response = await page.request.post(`${BACKEND_URL}/suites/import/validate`, {
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
    const item = json.data.suites[0]
    expect(item.status).toBe('fatal')
    expect(item.fatal_errors[0].code).toBe('MISSING_NAME')
  })
})

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

test.describe('Import Conflict Resolution', () => {
  test('rename appends numeric suffix', async ({ page }) => {
    const name = `Rename Suite ${Date.now()}`
    const suiteId = await createSuiteViaApi(page, name)

    const yaml = buildSuiteYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'rename-suite.yaml',
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
    await deleteSuiteViaApi(page, suiteId)
    await deleteSuiteViaApi(page, json.data.imported[0].id)
  })

  test('skip does not import conflicting suite', async ({ page }) => {
    const name = `Skip Suite ${Date.now()}`
    const suiteId = await createSuiteViaApi(page, name)

    const yaml = buildSuiteYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'skip-suite.yaml',
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
    await deleteSuiteViaApi(page, suiteId)
  })

  test('overwrite replaces existing suite', async ({ page }) => {
    const name = `Overwrite Suite ${Date.now()}`
    const suiteId = await createSuiteViaApi(page, name, {
      description: 'Original description',
    })

    const yaml = buildSuiteYaml(name, { tags: ['overwritten'] })
    const response = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'overwrite-suite.yaml',
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
    expect(json.data.imported[0].id).toBe(suiteId)

    // Verify the overwritten suite has new data
    const fetched = await fetchSuiteViaApi(page, suiteId)
    expect(fetched).not.toBeNull()
    expect((fetched!.tags as string[])).toContain('overwritten')

    // Cleanup
    await deleteSuiteViaApi(page, suiteId)
  })
})

// ---------------------------------------------------------------------------
// ZIP Round-Trip
// ---------------------------------------------------------------------------

test.describe('ZIP Round-Trip', () => {
  test('export as ZIP then import recreates suites', async ({ page }) => {
    const idA = await createSuiteViaApi(page, 'ZIP RT Suite A')
    const idB = await createSuiteViaApi(page, 'ZIP RT Suite B')

    // Export as ZIP
    const exportResponse = await page.request.post(`${BACKEND_URL}/suites/export`, {
      data: {
        suite_ids: [idA, idB],
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(exportResponse.ok()).toBeTruthy()
    const zipBuffer = await exportResponse.body()

    // Delete originals
    await deleteSuiteViaApi(page, idA)
    await deleteSuiteViaApi(page, idB)

    // Import the ZIP
    const importResponse = await page.request.post(`${BACKEND_URL}/suites/import`, {
      multipart: {
        file: {
          name: 'suites-export.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        },
        conflict_resolutions: '{}',
      },
    })
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    expect(json.data.total_imported).toBe(2)

    const names = json.data.imported.map((s: { name: string }) => s.name)
    expect(names).toContain('ZIP RT Suite A')
    expect(names).toContain('ZIP RT Suite B')

    // Cleanup
    for (const imported of json.data.imported) {
      await deleteSuiteViaApi(page, imported.id)
    }
  })
})
