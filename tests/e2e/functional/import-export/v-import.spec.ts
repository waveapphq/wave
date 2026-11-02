/**
 * Import Functional Tests
 *
 * Verifies import features work end-to-end against the real backend:
 *   - Import single YAML file
 *   - Import single JSON file
 *   - Import multiple tests via ZIP archive
 *   - An import over an existing name with an unknown conflict choice is skipped
 *
 * REQ: REQ-5.2.4.9 Test Import and Export
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export/v-import.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  loadFixture,
  createTestViaApi,
  deleteTestViaApi,
  fetchTestViaApi,
  buildYamlContent,
  buildJsonContent,
} from './helpers'

// ---------------------------------------------------------------------------
// Single File Import
// ---------------------------------------------------------------------------

test.describe('Import Single File', () => {
  test('import valid YAML creates new test', async ({ page }) => {
    const name = `Import YAML Test ${Date.now()}`
    const yamlContent = buildYamlContent(name, { includeVariables: true })

    const response = await page.request.post(`${BACKEND_URL}/tests/import`, {
      multipart: {
        file: {
          name: 'import-test.yaml',
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

    // Verify test exists via API
    const testId = data.imported[0].id
    const fetched = await fetchTestViaApi(page, testId)
    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe(name)

    // Cleanup
    await deleteTestViaApi(page, testId)
  })

  test('import valid JSON creates new test', async ({ page }) => {
    const name = `Import JSON Test ${Date.now()}`
    const jsonContent = buildJsonContent(name)

    const response = await page.request.post(`${BACKEND_URL}/tests/import`, {
      multipart: {
        file: {
          name: 'import-test.json',
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
    await deleteTestViaApi(page, json.data.imported[0].id)
  })
})

// ---------------------------------------------------------------------------
// ZIP Import (multiple tests)
// ---------------------------------------------------------------------------

test.describe('Import Multiple Tests via ZIP', () => {
  test('import ZIP archive creates all contained tests', async ({ page }) => {
    const fixture = loadFixture()

    // Step 1: Create two tests to export as ZIP
    const idA = await createTestViaApi(page, fixture, 'ZIP Import Test A')
    const idB = await createTestViaApi(page, fixture, 'ZIP Import Test B')

    // Step 2: Bulk export them as a ZIP archive
    const exportResponse = await page.request.post(
      `${BACKEND_URL}/tests/export`,
      {
        data: {
          test_ids: [idA, idB],
          format: 'yaml',
          secrets: 'encrypted',
        },
      }
    )
    expect(exportResponse.ok()).toBeTruthy()
    expect(exportResponse.headers()['content-type']).toContain('zip')
    const zipBuffer = await exportResponse.body()

    // Step 3: Delete the originals so import doesn't conflict
    await deleteTestViaApi(page, idA)
    await deleteTestViaApi(page, idB)

    // Step 4: Import the ZIP
    const importResponse = await page.request.post(
      `${BACKEND_URL}/tests/import`,
      {
        multipart: {
          file: {
            name: 'tests-export.zip',
            mimeType: 'application/zip',
            buffer: zipBuffer,
          },
          conflict_resolutions: '{}',
        },
      }
    )
    expect(importResponse.ok()).toBeTruthy()

    const json = await importResponse.json()
    const data = json.data
    expect(data.total_imported).toBe(2)
    expect(data.total_skipped).toBe(0)

    // Verify both test names are present in imported results
    const importedNames = data.imported.map(
      (t: { name: string }) => t.name
    )
    expect(importedNames).toContain('ZIP Import Test A')
    expect(importedNames).toContain('ZIP Import Test B')

    // Cleanup
    for (const imported of data.imported) {
      await deleteTestViaApi(page, imported.id)
    }
  })
})

// ---------------------------------------------------------------------------
// Conflict choice
// ---------------------------------------------------------------------------

test.describe('Import over an existing name', () => {
  test('an unknown conflict choice skips the import, so the name stays with one Test', async ({ page }) => {
    const name = `Import Conflict Test ${Date.now()}`
    const yamlContent = buildYamlContent(name)
    const importWith = (choice: string) =>
      page.request.post(`${BACKEND_URL}/tests/import`, {
        multipart: {
          file: { name: 'import-test.yaml', mimeType: 'application/x-yaml', buffer: Buffer.from(yamlContent) },
          conflict_resolutions: JSON.stringify({ [name]: choice }),
        },
      })

    const first = await importWith('skip')
    expect(first.ok()).toBeTruthy()
    const created = (await first.json()).data.imported
    expect(created).toHaveLength(1)

    const second = await importWith('not-a-choice')
    expect(second.ok()).toBeTruthy()
    const data = (await second.json()).data
    expect(data.imported).toEqual([])
    expect(data.skipped).toEqual([{ name, reason: 'skipped by user' }])

    const listed = await page.request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
    expect(listed.ok()).toBeTruthy()
    const sameName = ((await listed.json()).data as Array<{ name: string }>).filter((item) => item.name === name)
    expect(sameName, 'one Test carries the name').toHaveLength(1)

    await deleteTestViaApi(page, created[0].id)
  })
})
