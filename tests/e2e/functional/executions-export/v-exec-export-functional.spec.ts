/**
 * V-EXEC-EXPORT-FUNCTIONAL: executions export flows end-to-end
 *
 * REQ: REQ-5.2.4.9
 *
 * Pass Criteria:
 * 1. Detail toolbar Export opens the shared dialog (JSON preselected, no
 *    secrets checkbox); picking YAML downloads a file that is YAML (JSON.parse
 *    rejects it) and contains the execution id.
 * 2. Same dialog with JSON downloads a file that parses as JSON with the
 *    execution's id and entity metadata.
 * 3. The list row Export action downloads the single-execution file.
 * 4. Bulk-selecting 2 executions downloads executions-export.zip whose archive
 *    holds exactly 2 entries (one per execution).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment, E2E_ENV_NAME } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

type Page = import('@playwright/test').Page

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function importTest(request: APIRequestContext, suffix: string): Promise<string> {
  const fixture = loadFixture()
  fixture.name = `${fixture.name as string} ${suffix}`
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as Record<string, unknown>).id as string
}

async function validateImportedTest(request: APIRequestContext, testId: string): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const errors = (((body.data ?? body) as Record<string, unknown>).errors ?? []) as unknown[]
  expect(errors, 'fixture must validate with zero errors').toHaveLength(0)
}

async function createSuiteWrapping(
  request: APIRequestContext,
  testId: string,
  name: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, tests: [testId] },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as Record<string, unknown>).id as string
}

async function startSuiteExecution(
  request: APIRequestContext,
  suiteId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'suite', id: suiteId, environment_id: environmentId },
  })
  expect(response.ok(), `POST /executions failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as Record<string, unknown>).id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const status = ((body.data ?? body) as Record<string, unknown>).status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

/** Dependency-free ZIP central-directory listing (EOCD walk). */
function listZipEntries(buf: Buffer): string[] {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('EOCD signature not found - not a valid ZIP')
  const total = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('bad central directory entry')
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    names.push(buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf-8'))
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return names
}

/** Assert the shared executions export dialog contract (JSON default, no secrets). */
async function expectExecutionExportDialog(page: Page) {
  const dialog = page.locator('[data-testid="export-dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-testid="format-json"]')).toHaveAttribute(
    'data-state',
    'checked',
  )
  await expect(dialog.locator('[data-testid="secrets-mode-picker"]')).toHaveCount(0)
  return dialog
}

async function downloadFromDialog(page: Page) {
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-button"]').click()
  const download = await downloadPromise
  return download
}

test.describe('V-EXEC-EXPORT-FUNCTIONAL: executions export flows', () => {
  test('detail dialog (yaml + json), row download, and bulk ZIP', async ({ page, request }) => {
    const stamp = Date.now()
    const suiteAName = `Exec Export Suite A ${stamp}`
    const suiteBName = `Exec Export Suite B ${stamp}`
    let execA = ''
    let execB = ''
    let testId = ''
    let suiteA = ''
    let suiteB = ''

    await test.step('seed: import fixture, wrap in 2 suites, run both to terminal', async () => {
      await ensureEnvironment(request)
      const environmentId = await getEnvironmentId(request)
      testId = await importTest(request, String(stamp))
      await validateImportedTest(request, testId)
      suiteA = await createSuiteWrapping(request, testId, suiteAName)
      suiteB = await createSuiteWrapping(request, testId, suiteBName)
      execA = await startSuiteExecution(request, suiteA, environmentId)
      execB = await startSuiteExecution(request, suiteB, environmentId)
      await pollUntilTerminal(request, execA)
      await pollUntilTerminal(request, execB)
    })

    await test.step('1. detail toolbar Export -> dialog -> YAML file with the execution id', async () => {
      await page.goto(`/executions/${execA}`)
      await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

      await page.getByRole('button', { name: 'Export', exact: true }).click()
      const dialog = await expectExecutionExportDialog(page)
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Export execution')
      await expect(dialog.locator('p').first(), 'description names the execution').toHaveText(
        suiteAName,
      )
      await expect(dialog.locator('[data-testid="export-button"]')).toHaveText('Download')

      await dialog.locator('[data-testid="format-yaml"]').click()
      const download = await downloadFromDialog(page)
      expect(download.suggestedFilename()).toMatch(/\.yaml$/)

      const content = fs.readFileSync(await download.path(), 'utf-8')
      expect(() => JSON.parse(content), 'YAML export must not be JSON').toThrow()
      expect(content, 'export carries the execution id').toContain(execA)
      await expect(dialog).not.toBeVisible()
    })

    await test.step('2. detail dialog JSON variant parses with the execution metadata', async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      // The dialog stays mounted, so the format still holds step 1's YAML
      // pick; select JSON explicitly (the JSON-default contract is step 1's).
      const dialog = page.locator('[data-testid="export-dialog"]')
      await expect(dialog).toBeVisible()
      await dialog.locator('[data-testid="format-json"]').click()
      const download = await downloadFromDialog(page)
      expect(download.suggestedFilename()).toMatch(/\.json$/)

      const parsed = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'))
      expect(parsed.id).toBe(execA)
      expect(parsed.entity_type).toBe('suite')
      expect(parsed.name).toBe(suiteAName)
    })

    await test.step('3. list row Export downloads the single-execution file', async () => {
      await page.goto('/executions')
      await expect(page.getByTestId('executions-page')).toBeVisible()
      await page.getByPlaceholder('Search executions…').fill(suiteAName)

      const row = page
        .locator('[data-testid="executions-table"] tbody tr')
        .filter({ hasText: suiteAName })
      await expect(row).toHaveCount(1)
      await row.locator('[data-testid="row-action-export"]').click()

      await expectExecutionExportDialog(page)
      const download = await downloadFromDialog(page)
      expect(download.suggestedFilename()).toMatch(/\.json$/)
      const parsed = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'))
      expect(parsed.id).toBe(execA)
    })

    await test.step('4. bulk-select 2 executions -> Download ZIP with 2 entries', async () => {
      await page.getByPlaceholder('Search executions…').fill(`Exec Export Suite`)
      const rows = page
        .locator('[data-testid="executions-table"] tbody tr')
        .filter({ hasText: `${stamp}` })
      await expect(rows).toHaveCount(2)

      await page.getByRole('button', { name: /Mass Action/ }).click()
      await rows.nth(0).locator('[data-testid="row-checkbox"]').click()
      await rows.nth(1).locator('[data-testid="row-checkbox"]').click()

      await page.locator('[data-testid="selection-counter"]').click()
      const bulkExport = page.locator('[data-testid="bulk-action-export"]')
      await expect(bulkExport).toBeVisible()
      await bulkExport.click()

      const dialog = await expectExecutionExportDialog(page)
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Export 2 executions')
      await expect(dialog.locator('[data-testid="export-button"]')).toHaveText('Download ZIP')

      const download = await downloadFromDialog(page)
      expect(download.suggestedFilename()).toBe('executions-export.zip')

      const entries = listZipEntries(fs.readFileSync(await download.path()))
      expect(entries, 'one archive entry per exported execution').toHaveLength(2)
      for (const entry of entries) {
        expect(entry).toMatch(/\.json$/)
      }
      expect(new Set(entries).size, 'entry names are distinct').toBe(2)
    })

    await test.step('cleanup: delete the seeded executions, suites, and test', async () => {
      await request.delete(`${BACKEND_URL}/executions/${execA}`)
      await request.delete(`${BACKEND_URL}/executions/${execB}`)
      await request.delete(`${BACKEND_URL}/suites/${suiteA}`)
      await request.delete(`${BACKEND_URL}/suites/${suiteB}`)
      await request.delete(`${BACKEND_URL}/tests/${testId}`)
    })
  })
})
