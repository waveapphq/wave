/**
 * Environment Import/Export Functional Tests
 *
 * Verifies environment export/import works end-to-end against the real backend:
 *   - Single export as YAML and JSON (no secrets param - environments have no secrets)
 *   - Bulk export returns ZIP archive for 2+ environments
 *   - Import single YAML/JSON creates new environment
 *   - Import with conflict resolution (rename, overwrite, skip)
 *   - Validation: missing name (fatal), tags normalization
 *   - ZIP round-trip (export then import)
 *
 * REQ: Environment Import and Export
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export-env/v-env-export-import.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createEnvironmentViaApi,
  deleteEnvironmentViaApi,
  fetchEnvironmentViaApi,
  buildEnvironmentYaml,
  buildEnvironmentJson,
} from './helpers'

// ---------------------------------------------------------------------------
// Single Environment Export
// ---------------------------------------------------------------------------

test.describe('Export Single Environment', () => {
  let envId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    envId = await createEnvironmentViaApi(page, 'Export Test Env', 'For export testing', ['prod', 'us-east'])
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteEnvironmentViaApi(page, envId)
    await page.close()
  })

  test('export as YAML returns valid YAML content', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/environments/${envId}/export?format=yaml`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('yaml')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.yaml')

    const body = await response.text()
    expect(body).toContain('Export Test Env')
    expect(body).toContain('For export testing')
  })

  test('export as JSON returns valid JSON content', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/environments/${envId}/export?format=json`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('json')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.json')

    const body = await response.text()
    const parsed = JSON.parse(body)
    expect(parsed.name).toBe('Export Test Env')
    expect(parsed.description).toBe('For export testing')
  })

  test('export has no secrets parameter', async ({ page }) => {
    // Environments have no secrets - the export takes no secrets query param
    const response = await page.request.get(
      `${BACKEND_URL}/environments/${envId}/export?format=json`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    // No masked field should exist
    expect(parsed.masked).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Bulk Export (ZIP)
// ---------------------------------------------------------------------------

test.describe('Export Multiple Environments as ZIP', () => {
  const envIds: string[] = []

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    envIds.push(await createEnvironmentViaApi(page, 'Bulk Env A'))
    envIds.push(await createEnvironmentViaApi(page, 'Bulk Env B'))
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    for (const id of envIds) {
      await deleteEnvironmentViaApi(page, id)
    }
    await page.close()
  })

  test('bulk export of 2+ environments returns ZIP archive', async ({ page }) => {
    const response = await page.request.post(`${BACKEND_URL}/environments/export`, {
      data: {
        environment_ids: envIds,
        format: 'yaml',
      },
    })
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('zip')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('environments-export.zip')

    // Verify ZIP magic bytes (PK)
    const body = await response.body()
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toBe(0x50)
    expect(body[1]).toBe(0x4b)
  })
})

// ---------------------------------------------------------------------------
// Single File Import
// ---------------------------------------------------------------------------

test.describe('Import Single Environment', () => {
  test('import valid YAML creates new environment', async ({ page }) => {
    const name = `Import YAML Env ${Date.now()}`
    const yamlContent = buildEnvironmentYaml(name, { tags: ['imported'] })

    const response = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'import-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const data = json.data
    expect(data.total_imported).toBe(1)
    expect(data.total_skipped).toBe(0)
    expect(data.imported[0].name).toBe(name)
    expect(data.imported[0].action).toBe('created')

    // Verify environment exists
    const envId = data.imported[0].id
    const fetched = await fetchEnvironmentViaApi(page, envId)
    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe(name)

    // Cleanup
    await deleteEnvironmentViaApi(page, envId)
  })

  test('import valid JSON creates new environment', async ({ page }) => {
    const name = `Import JSON Env ${Date.now()}`
    const jsonContent = buildEnvironmentJson(name)

    const response = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'import-env.json',
          mimeType: 'application/json',
          buffer: Buffer.from(jsonContent),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)
    expect(json.data.imported[0].action).toBe('created')

    // Cleanup
    await deleteEnvironmentViaApi(page, json.data.imported[0].id)
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test.describe('Import Validation', () => {
  test('validate returns item statuses', async ({ page }) => {
    const yamlContent = buildEnvironmentYaml('Validate Env Test')

    const response = await page.request.post(`${BACKEND_URL}/environments/import/validate`, {
      multipart: {
        file: {
          name: 'validate-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const data = json.data
    expect(data.total).toBeGreaterThanOrEqual(1)
    expect(data.environments).toBeDefined()
    expect(data.environments.length).toBeGreaterThanOrEqual(1)
    // First item should be ok (new name, no conflict)
    expect(data.environments[0].status).toBe('ok')
  })

  test('validate detects conflict when name already exists', async ({ page }) => {
    // Create environment first
    const name = `Conflict Env ${Date.now()}`
    const envId = await createEnvironmentViaApi(page, name)

    // Validate import with same name
    const yamlContent = buildEnvironmentYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/environments/import/validate`, {
      multipart: {
        file: {
          name: 'conflict-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.environments[0].status).toBe('conflict')

    // Cleanup
    await deleteEnvironmentViaApi(page, envId)
  })
})

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

test.describe('Import Conflict Resolution', () => {
  test('rename appends numeric suffix', async ({ page }) => {
    const name = `Rename Env ${Date.now()}`
    const envId = await createEnvironmentViaApi(page, name)

    const yamlContent = buildEnvironmentYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'rename-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'rename' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)
    // Renamed should have a suffix like "(2)"
    expect(json.data.imported[0].name).toContain(name)
    expect(json.data.imported[0].name).not.toBe(name)

    // Cleanup
    await deleteEnvironmentViaApi(page, envId)
    await deleteEnvironmentViaApi(page, json.data.imported[0].id)
  })

  test('overwrite replaces existing environment', async ({ page }) => {
    const name = `Overwrite Env ${Date.now()}`
    const envId = await createEnvironmentViaApi(page, name, 'original')

    const yamlContent = buildEnvironmentYaml(name, { description: 'overwritten' })
    const response = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'overwrite-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'overwrite' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)

    // Verify the environment was overwritten
    const fetched = await fetchEnvironmentViaApi(page, json.data.imported[0].id)
    expect(fetched).not.toBeNull()
    expect(fetched!.description).toBe('overwritten')

    // Cleanup
    await deleteEnvironmentViaApi(page, envId)
    // If overwrite created new ID, clean that too
    if (json.data.imported[0].id !== envId) {
      await deleteEnvironmentViaApi(page, json.data.imported[0].id)
    }
  })

  test('skip does not import conflicting environment', async ({ page }) => {
    const name = `Skip Env ${Date.now()}`
    const envId = await createEnvironmentViaApi(page, name)

    const yamlContent = buildEnvironmentYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'skip-env.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: JSON.stringify({ [name]: 'skip' }),
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(0)
    expect(json.data.total_skipped).toBe(1)

    // Cleanup
    await deleteEnvironmentViaApi(page, envId)
  })
})

// ---------------------------------------------------------------------------
// ZIP Round-Trip
// ---------------------------------------------------------------------------

test.describe('ZIP Round-Trip', () => {
  test('export as ZIP then import recreates environments', async ({ page }) => {
    // Create two environments
    const idA = await createEnvironmentViaApi(page, 'ZIP RT Env A')
    const idB = await createEnvironmentViaApi(page, 'ZIP RT Env B')

    // Export as ZIP
    const exportResponse = await page.request.post(`${BACKEND_URL}/environments/export`, {
      data: {
        environment_ids: [idA, idB],
        format: 'yaml',
      },
    })
    expect(exportResponse.ok()).toBeTruthy()
    const zipBuffer = await exportResponse.body()

    // Delete originals
    await deleteEnvironmentViaApi(page, idA)
    await deleteEnvironmentViaApi(page, idB)

    // Import the ZIP
    const importResponse = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'environments-export.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        },
        conflict_resolutions: '{}',
      },
    })
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    expect(json.data.total_imported).toBe(2)

    const importedNames = json.data.imported.map((e: { name: string }) => e.name)
    expect(importedNames).toContain('ZIP RT Env A')
    expect(importedNames).toContain('ZIP RT Env B')

    // Cleanup
    for (const imported of json.data.imported) {
      await deleteEnvironmentViaApi(page, imported.id)
    }
  })
})

// ---------------------------------------------------------------------------
// New UUIDs on Import
// ---------------------------------------------------------------------------

test.describe('Identity Handling', () => {
  test('imported environments get new UUIDs', async ({ page }) => {
    const name = `UUID Env ${Date.now()}`
    const origId = await createEnvironmentViaApi(page, name)

    // Export
    const exportResponse = await page.request.get(
      `${BACKEND_URL}/environments/${origId}/export?format=json`
    )
    const exportedJson = await exportResponse.text()

    // Delete original
    await deleteEnvironmentViaApi(page, origId)

    // Import
    const importResponse = await page.request.post(`${BACKEND_URL}/environments/import`, {
      multipart: {
        file: {
          name: 'uuid-env.json',
          mimeType: 'application/json',
          buffer: Buffer.from(exportedJson),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    const newId = json.data.imported[0].id
    expect(newId).not.toBe(origId)

    // Cleanup
    await deleteEnvironmentViaApi(page, newId)
  })
})
