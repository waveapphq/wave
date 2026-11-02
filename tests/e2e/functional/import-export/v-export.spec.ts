/**
 * Export Functional Tests
 *
 * Verifies export features work end-to-end against the real backend:
 *   - Single test export as YAML and JSON
 *   - Bulk export returns ZIP archive for 2+ tests
 *   - Secret values mode: mask / encrypted / plaintext
 *
 * REQ: REQ-5.2.4.9 Test Import and Export
 * Run: ./scripts/e2e-targeted-local.sh functional/import-export/v-export.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  loadFixture,
  createTestViaAdminBulk,
  createTestViaApi,
  deleteTestViaApi,
} from './helpers'

// ---------------------------------------------------------------------------
// Single Test Export
// ---------------------------------------------------------------------------

test.describe('Export Single Test', () => {
  let testId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    // The fixture intentionally includes an explicit `start-001` node with
    // `type: "startNode"`. The unified write-path pipeline treats
    // any `type` outside {workflowNode, noteNode} as INVALID_NODE_TYPE and
    // auto-removes the node before persist. Bypass the pipeline here and
    // import via the admin bulk endpoint so the export round-trip preserves
    // the original node set.
    const fixture = loadFixture() as Record<string, unknown> & { id: string }
    testId = await createTestViaAdminBulk(page, fixture)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestViaApi(page, testId)
    await page.close()
  })

  test('export as YAML returns valid YAML content', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=yaml&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('yaml')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.yaml')

    const body = await response.text()
    expect(body).toContain('Export Import E2E Test')
    expect(body).toContain('log-001')
    expect(body).toContain('start-001')
  })

  test('export as JSON returns valid JSON content', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('json')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('attachment')
    expect(disposition).toContain('.json')

    const body = await response.text()
    const parsed = JSON.parse(body)
    expect(parsed.name).toBe('Export Import E2E Test')
    expect(parsed.workflow.nodes).toHaveLength(2)
    expect(parsed.workflow.edges).toHaveLength(1)
  })

  test('export with secrets=mask replaces secret values with ********', async ({ page }) => {
    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=mask`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    const vars = parsed.variables as Record<string, Record<string, unknown>>

    expect(vars.plain_var?.value).toBe('visible_value')
    expect(vars.secret_var?.value).toBe('********')
    expect(vars.secret_var?.masked).toBe(true)
  })

  test('export with secrets=encrypted emits the sealed envelope', async ({ page }) => {
    // Encrypted mode keeps the wave:enc:v1: envelope verbatim - no cleartext,
    // no mask; only this WAVE instance can read it back.
    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=encrypted`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    const vars = parsed.variables as Record<string, Record<string, unknown>>

    expect(vars.plain_var?.value).toBe('visible_value')
    expect(vars.secret_var?.value).toMatch(/^wave:enc:v1:/)
    expect(vars.secret_var?.value).not.toBe('super_secret_password')
    expect(vars.secret_var?.masked).toBeUndefined()
  })

  test('export with secrets=plaintext decrypts to the real value', async ({ page }) => {
    // Decrypt mode writes the real secret in cleartext (for migrating to
    // another instance).
    const response = await page.request.get(
      `${BACKEND_URL}/tests/${testId}/export?format=json&secrets=plaintext`
    )
    expect(response.ok()).toBeTruthy()

    const parsed = JSON.parse(await response.text())
    const vars = parsed.variables as Record<string, Record<string, unknown>>

    expect(vars.plain_var?.value).toBe('visible_value')
    expect(vars.secret_var?.value).toBe('super_secret_password')
    expect(vars.secret_var?.masked).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Bulk Export (ZIP)
// ---------------------------------------------------------------------------

test.describe('Export Multiple Tests as ZIP', () => {
  const testIds: string[] = []

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    const fixture = loadFixture()
    testIds.push(await createTestViaApi(page, fixture, 'Bulk Export Test A'))
    testIds.push(await createTestViaApi(page, fixture, 'Bulk Export Test B'))
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    for (const id of testIds) {
      await deleteTestViaApi(page, id)
    }
    await page.close()
  })

  test('bulk export of 2+ tests returns ZIP archive', async ({ page }) => {
    const response = await page.request.post(`${BACKEND_URL}/tests/export`, {
      data: {
        test_ids: testIds,
        format: 'yaml',
        secrets: 'mask',
      },
    })
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('zip')

    const disposition = response.headers()['content-disposition']
    expect(disposition).toContain('tests-export.zip')

    // Verify body is non-empty with ZIP magic bytes (PK)
    const body = await response.body()
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toBe(0x50)
    expect(body[1]).toBe(0x4b)
  })
})
