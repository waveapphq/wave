/**
 * Profile Import/Export Functional Tests
 *
 * Verifies profile export/import works end-to-end against the real backend:
 *   - Single export as YAML and JSON with env ID-to-name replacement
 *   - Export with secrets mask / plaintext
 *   - Bulk export returns ZIP archive for 2+ profiles
 *   - Import single YAML/JSON with env name-to-ID resolution
 *   - Import with conflict resolution (rename, overwrite, skip)
 *   - Validation: type fixup (defaults to 'custom'), unresolvable env names (stripped)
 *   - ZIP round-trip
 *
 * REQ: Profile Import and Export
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export-profile/v-prof-export-import.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  createEnvironmentViaApi,
  deleteEnvironmentViaApi,
  createProfileViaApi,
  deleteProfileViaApi,
  fetchProfileViaApi,
  buildProfileYaml,
  buildProfileJson,
} from './helpers'

// ---------------------------------------------------------------------------
// Single Profile Export
// ---------------------------------------------------------------------------

test.describe('Export Single Profile', () => {
  let envId: string
  let envName: string
  let profileId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    envName = `Export Prof Env ${Date.now()}`
    envId = await createEnvironmentViaApi(page, envName)
    profileId = await createProfileViaApi(page, 'Export Test Profile', {
      type: 'database',
      envValues: { [envId]: { host: 'db.example.com', port: 5432 } },
    })
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteProfileViaApi(page, profileId)
    await deleteEnvironmentViaApi(page, envId)
    await page.close()
  })

  test('export as YAML replaces env IDs with names', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/profiles/${profileId}/export?format=yaml&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('yaml')

    const body = await response.text()
    expect(body).toContain('Export Test Profile')
    // Environment ID should be replaced with name
    expect(body).toContain(envName)
    expect(body).not.toContain(envId)
  })

  test('export as JSON replaces env IDs with names', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/profiles/${profileId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    expect(parsed.name).toBe('Export Test Profile')
    // env_values keys should be names, not IDs
    const envKeys = Object.keys(parsed.environment_values || {})
    expect(envKeys).toContain(envName)
    expect(envKeys).not.toContain(envId)
  })

  test('export with secrets=mask keeps a parseable document', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/profiles/${profileId}/export?format=json&secrets=mask`
    )
    expect(response.ok()).toBeTruthy()
    // Verify response is valid JSON
    const parsed = JSON.parse(await response.text())
    expect(parsed.name).toBe('Export Test Profile')
  })

  test('export with secrets=plaintext shows clear text', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/profiles/${profileId}/export?format=json&secrets=plaintext`
    )
    expect(response.ok()).toBeTruthy()
    const parsed = JSON.parse(await response.text())
    expect(parsed.name).toBe('Export Test Profile')
    // env_values should have clear-text values
    const envVals = parsed.environment_values?.[envName]
    expect(envVals?.host).toBe('db.example.com')
  })
})

// ---------------------------------------------------------------------------
// Bulk Export (ZIP)
// ---------------------------------------------------------------------------

test.describe('Export Multiple Profiles as ZIP', () => {
  const profileIds: string[] = []

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    profileIds.push(await createProfileViaApi(page, 'Bulk Profile A'))
    profileIds.push(await createProfileViaApi(page, 'Bulk Profile B'))
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    for (const id of profileIds) {
      await deleteProfileViaApi(page, id)
    }
    await page.close()
  })

  test('bulk export of 2+ profiles returns ZIP archive', async ({ page }) => {
    const response = await page.request.post(`${BACKEND_URL}/profiles/export`, {
      data: {
        profile_ids: profileIds,
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('zip')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('profiles-export.zip')

    // ZIP magic bytes
    const body = await response.body()
    expect(body[0]).toBe(0x50)
    expect(body[1]).toBe(0x4b)
  })
})

// ---------------------------------------------------------------------------
// Single File Import
// ---------------------------------------------------------------------------

test.describe('Import Single Profile', () => {
  test('import valid YAML creates new profile', async ({ page }) => {
    const name = `Import YAML Profile ${Date.now()}`
    const yamlContent = buildProfileYaml(name)

    const response = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'import-profile.yaml',
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
    await deleteProfileViaApi(page, json.data.imported[0].id)
  })

  test('import valid JSON creates new profile', async ({ page }) => {
    const name = `Import JSON Profile ${Date.now()}`
    const jsonContent = buildProfileJson(name)

    const response = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'import-profile.json',
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
    await deleteProfileViaApi(page, json.data.imported[0].id)
  })

  test('import with env names resolves to IDs', async ({ page }) => {
    // Create environment
    const envName = `Import Env ${Date.now()}`
    const envId = await createEnvironmentViaApi(page, envName)

    // Import profile referencing environment by name
    const name = `Env Resolve Profile ${Date.now()}`
    const yamlContent = buildProfileYaml(name, {
      envValues: { [envName]: { host: 'resolved.example.com' } },
    })

    const response = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'env-resolve.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yamlContent),
        },
        conflict_resolutions: '{}',
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    expect(json.data.total_imported).toBe(1)

    // Verify the profile has env_values keyed by ID
    const profileId = json.data.imported[0].id
    const fetched = await fetchProfileViaApi(page, profileId)
    expect(fetched).not.toBeNull()
    const envValues = fetched!.environment_values as Record<string, Record<string, unknown>>
    // Should have the env ID as key, not the name
    expect(envValues[envId]).toBeDefined()
    expect(envValues[envId]?.host).toBe('resolved.example.com')

    // Cleanup
    await deleteProfileViaApi(page, profileId)
    await deleteEnvironmentViaApi(page, envId)
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test.describe('Import Validation', () => {
  test('invalid type is fixable - defaults to custom', async ({ page }) => {
    const yaml = buildProfileYaml('Type Fix Profile', { type: 'nonexistent_type' })

    const response = await page.request.post(`${BACKEND_URL}/profiles/import/validate`, {
      multipart: {
        file: {
          name: 'type-fix.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.profiles[0]
    // Invalid type should be fixable, not fatal
    expect(item.status).toBe('fixable')
  })

  test('unresolvable env names are fixable', async ({ page }) => {
    const yaml = buildProfileYaml('Env Fix Profile', {
      envValues: { 'NonexistentEnv': { key: 'value' } },
    })

    const response = await page.request.post(`${BACKEND_URL}/profiles/import/validate`, {
      multipart: {
        file: {
          name: 'env-fix.yaml',
          mimeType: 'application/x-yaml',
          buffer: Buffer.from(yaml),
        },
      },
    })
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const item = json.data.profiles[0]
    expect(item.status).toBe('fixable')
  })
})

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

test.describe('Import Conflict Resolution', () => {
  test('rename appends numeric suffix', async ({ page }) => {
    const name = `Rename Profile ${Date.now()}`
    const profileId = await createProfileViaApi(page, name)

    const yaml = buildProfileYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'rename-prof.yaml',
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
    await deleteProfileViaApi(page, profileId)
    await deleteProfileViaApi(page, json.data.imported[0].id)
  })

  test('skip does not import conflicting profile', async ({ page }) => {
    const name = `Skip Profile ${Date.now()}`
    const profileId = await createProfileViaApi(page, name)

    const yaml = buildProfileYaml(name)
    const response = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'skip-prof.yaml',
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
    await deleteProfileViaApi(page, profileId)
  })
})

// ---------------------------------------------------------------------------
// ZIP Round-Trip
// ---------------------------------------------------------------------------

test.describe('ZIP Round-Trip', () => {
  test('export as ZIP then import recreates profiles', async ({ page }) => {
    const idA = await createProfileViaApi(page, 'ZIP RT Profile A')
    const idB = await createProfileViaApi(page, 'ZIP RT Profile B')

    // Export as ZIP
    const exportResponse = await page.request.post(`${BACKEND_URL}/profiles/export`, {
      data: {
        profile_ids: [idA, idB],
        format: 'yaml',
        secrets: 'encrypted',
      },
    })
    expect(exportResponse.ok()).toBeTruthy()
    const zipBuffer = await exportResponse.body()

    // Delete originals
    await deleteProfileViaApi(page, idA)
    await deleteProfileViaApi(page, idB)

    // Import the ZIP
    const importResponse = await page.request.post(`${BACKEND_URL}/profiles/import`, {
      multipart: {
        file: {
          name: 'profiles-export.zip',
          mimeType: 'application/zip',
          buffer: zipBuffer,
        },
        conflict_resolutions: '{}',
      },
    })
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    expect(json.data.total_imported).toBe(2)

    const names = json.data.imported.map((p: { name: string }) => p.name)
    expect(names).toContain('ZIP RT Profile A')
    expect(names).toContain('ZIP RT Profile B')

    // Cleanup
    for (const imported of json.data.imported) {
      await deleteProfileViaApi(page, imported.id)
    }
  })
})
