/**
 * V-ARTIFACT-BROWSER-FUNCTIONAL: Artifact browser end-to-end
 * Design Decisions: ARTIF-11 (soft-delete), execution-delete cascade; ARTIF-7
 *   (per-section Tree | Flat toggle), ARTIF-9 (folder rows carry the subtree
 *   actions), TDATA-7 (Copy path on every file and folder row)
 * REQ: REQ-5.2.1.41, REQ-5.2.6.4.8, REQ-6.1.4, REQ-3.7.1.1
 *
 * Imports the artifact-browser fixture (a failing test that writes File I/O
 * artifacts, emits an ERROR that error.json aggregates, and persists its per-test
 * log), runs it tracked, generates report.html/json, then drives the browser UI
 * and asserts on OBSERVABLE output - the landing count/size, the four grouped
 * sections, downloaded bytes, the view toggle, the folder disclosure, the copied
 * reference, the soft-delete audit trail, and the streamed zip.
 *
 * Pass Criteria:
 *  1. The execution appears in the landing list with the API's artifact count.
 *  2. Opening it groups artifacts into Failure / Reports / Logs / Files, each
 *     holding its expected artifact.
 *  3. A single-file download returns the exact fixture bytes.
 *  4. ARTIF-7: the Files section's Tree | Flat toggle carries the pressed state on
 *     exactly one option and switches the rows - Flat lists every artifact under
 *     its full path with no folder to expand, Tree brings the folder rows back.
 *  5. ARTIF-9: a folder row's chevron is the only disclosure - its accessible name
 *     flips Collapse <-> Expand, aria-expanded follows the click, the subtree
 *     appears and disappears with it, and clicking the folder name toggles nothing.
 *  6. TDATA-7: Copy path on an artifact row puts `artifact://<stored path>` on the
 *     clipboard and shows the copied cue with its screen-reader announcement.
 *  7. A soft-delete hides the row; Show removed reveals a tombstone with no
 *     restore affordance; the deleted artifact is gone from the live listing.
 *  8. Download all streams a valid .zip.
 *  9. Deleting the execution cascades - it is absent from /artifacts AND
 *     /reports and its artifact dir is purged; the row + bulk delete
 *     confirmations both warn about "artifacts and reports", and the bulk
 *     confirmation appears before any deletion fires.
 * 10. A GET of an artifact's content with a byte range inside the file answers 206
 *     with exactly those bytes and their Content-Range; a range that starts at or
 *     past its end answers 416 with error code RANGE_NOT_SATISFIABLE.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'

const FIXTURE_OUTPUT_CONTENT = '{"result": "generated", "items": 3}'
// The fixture's two File I/O writes land under artifact://data/, so the Files
// section holds exactly one folder node with two leaves.
const FILES_FOLDER = 'data'
const OUTPUT_STORED_PATH = 'data/output.json'
const OUTPUT_REFERENCE = `artifact://${OUTPUT_STORED_PATH}`
const OUTPUT_SIZE = Buffer.byteLength(FIXTURE_OUTPUT_CONTENT)
/** The bytes the in-range request asks for: the first ones of the file. */
const RANGE_HEAD = 8
const RANGE_ERROR_CODE = 'RANGE_NOT_SATISFIABLE'

interface ArtifactRow {
  id: string
  path: string
  size_bytes: number
}

function loadFixture(): Record<string, any> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/artifacts/fixture.json'),
    'utf-8',
  )
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function importFixture(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const fixture = loadFixture()
  const name = `${fixture.name as string} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  fixture.name = name
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return { id: ((body.data ?? body) as Record<string, unknown>).id as string, name }
}

async function startTrackedExecution(
  request: APIRequestContext,
  testId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: environmentId },
  })
  expect(response.ok(), `POST /executions failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as Record<string, unknown>).id as string
}

async function pollUntilTerminal(request: APIRequestContext, executionId: string): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    const status = (((await response.json()).data ?? {}) as Record<string, unknown>).status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') return status
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach a terminal state`)
}

async function generateReport(
  request: APIRequestContext,
  executionId: string,
  format: 'html' | 'json',
): Promise<void> {
  await request.post(`${BACKEND_URL}/executions/${executionId}/report?format=${format}`)
  const start = Date.now()
  while (Date.now() - start < 20_000) {
    const response = await request.get(
      `${BACKEND_URL}/executions/${executionId}/report?format=${format}`,
    )
    if ((((await response.json()).data ?? {}) as Record<string, unknown>).status === 'completed') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Report ${format} did not complete`)
}

async function liveArtifactCount(request: APIRequestContext, executionId: string): Promise<number> {
  const response = await request.get(`${BACKEND_URL}/artifacts?execution_id=${executionId}&per_page=100`)
  return ((await response.json()).data as unknown[]).length
}

/** The live artifact of an execution stored under `storedPath`. */
async function liveArtifact(
  request: APIRequestContext,
  executionId: string,
  storedPath: string,
): Promise<ArtifactRow> {
  const response = await request.get(`${BACKEND_URL}/artifacts?execution_id=${executionId}&per_page=100`)
  expect(response.ok(), `GET /artifacts answered ${response.status()}`).toBeTruthy()
  const rows = (await response.json()).data as ArtifactRow[]
  const found = rows.filter((row) => row.path === storedPath)
  expect(
    found,
    `the execution holds one live "${storedPath}". Listed: ${JSON.stringify(rows)}`,
  ).toHaveLength(1)
  return found[0]
}

/** The drill section card whose bold header reads `title`. */
function sectionOf(page: Page, title: string) {
  return page.locator('section', {
    has: page.locator('span.text-sm.font-bold', { hasText: title }),
  })
}

async function searchExecutionsRow(page: Page, name: string) {
  await page.goto('/artifacts')
  await expect(page.getByTestId('artifacts-page')).toBeVisible()
  await page.getByPlaceholder('Search artifacts…').fill(name)
  const row = page.locator('[data-testid="artifacts-table"] tbody tr').filter({ hasText: name })
  await expect(row.first()).toBeVisible()
  return row.first()
}

test.describe('Artifact browser end-to-end', () => {
  test('landing count, section grouping, download bytes, view toggle, folder disclosure, copied reference, soft-delete audit, zip, delete cascade', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    // Copy path goes through navigator.clipboard, which needs the grant.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const { id: testId, name: testName } = await importFixture(request)

    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, 'fixture validates with zero errors').toHaveLength(0)

    const executionId = await startTrackedExecution(request, testId, environmentId)
    expect(await pollUntilTerminal(request, executionId), 'seeded run fails').toBe('failed')
    await generateReport(request, executionId, 'html')
    await generateReport(request, executionId, 'json')
    const expectedCount = await liveArtifactCount(request, executionId)
    expect(expectedCount, 'error.json + 2 reports + log + 2 File I/O outputs').toBe(6)

    await test.step('1. Execution appears in the landing list with the API artifact count', async () => {
      const row = await searchExecutionsRow(page, testName)
      await expect(row.locator('[data-testid="artifact-count"]')).toContainText(String(expectedCount))
      await expect(row.locator('[data-testid="status-badge-failed"]')).toContainText('Failed')
    })

    await test.step('2. Opening groups artifacts into the four sections', async () => {
      await page.goto(`/artifacts/${executionId}`)
      await expect(page.getByTestId('artifact-drill-page')).toBeVisible()
      await expect(sectionOf(page, 'Failure summary').getByText('error.json')).toBeVisible()
      await expect(sectionOf(page, 'Reports').getByText('report.html')).toBeVisible()
      await expect(sectionOf(page, 'Reports').getByText('report.json')).toBeVisible()
      await expect(sectionOf(page, 'Logs').locator('[data-testid="file-row"]')).toContainText('.log')
      await expect(sectionOf(page, 'Files').getByText('output.json')).toBeVisible()
    })

    await test.step('3. Single-file download returns the exact fixture bytes', async () => {
      const files = sectionOf(page, 'Files')
      const downloadPromise = page.waitForEvent('download')
      await files
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
        .first()
        .getByRole('button', { name: /^Download output\.json$/ })
        .click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe('output.json')
      const streamed = fs.readFileSync(await download.path(), 'utf-8')
      expect(streamed, 'downloaded bytes equal the File I/O output').toBe(FIXTURE_OUTPUT_CONTENT)
    })

    await test.step('4. ARTIF-7: Flat lists the artifacts by path; Tree brings the folders back', async () => {
      const files = sectionOf(page, 'Files')
      // The toggle carries no testids - it is reached through the labeled group.
      const viewToggle = page.getByRole('group', { name: 'Files view', exact: true })
      const treeButton = viewToggle.getByRole('button', { name: 'Tree', exact: true })
      const flatButton = viewToggle.getByRole('button', { name: 'Flat', exact: true })
      const outputRow = files.locator('[data-testid="file-row"]').filter({ hasText: 'output.json' })

      await flatButton.click()
      await expect(flatButton, 'the pressed option is the active view').toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(treeButton).toHaveAttribute('aria-pressed', 'false')
      await expect(
        files.locator('[data-testid="folder-row"]'),
        'a flat listing has nothing to expand',
      ).toHaveCount(0)
      await expect(
        outputRow.first().getByTestId('artifact-file-subtitle'),
        'a flat row names the artifact by its full stored path',
      ).toHaveText(OUTPUT_STORED_PATH)

      await treeButton.click()
      await expect(treeButton).toHaveAttribute('aria-pressed', 'true')
      await expect(flatButton).toHaveAttribute('aria-pressed', 'false')
      const folderRow = files.locator('[data-testid="folder-row"]')
      await expect(folderRow, 'the two writes nest under one folder node').toHaveCount(1)
      await expect(folderRow).toContainText(FILES_FOLDER)
      await expect(
        outputRow.first().getByTestId('artifact-file-subtitle'),
        'a tree row shows the bare name; the folder above carries the path',
      ).toHaveCount(0)
    })

    await test.step('5. ARTIF-9: the chevron is the only disclosure on a folder row', async () => {
      const files = sectionOf(page, 'Files')
      const folderRow = files.locator('[data-testid="folder-row"]')
      const chevron = folderRow.getByRole('button', {
        name: new RegExp(`^(Expand|Collapse) ${FILES_FOLDER}$`),
      })
      const outputRow = files.locator('[data-testid="file-row"]').filter({ hasText: 'output.json' })

      await expect(chevron).toHaveAttribute('aria-expanded', 'true')
      await expect(chevron).toHaveAccessibleName(`Collapse ${FILES_FOLDER}`)
      await expect(outputRow).toHaveCount(1)

      await chevron.click()
      await expect(chevron).toHaveAttribute('aria-expanded', 'false')
      await expect(chevron).toHaveAccessibleName(`Expand ${FILES_FOLDER}`)
      await expect(outputRow, 'collapsing hides the subtree').toHaveCount(0)

      // The row body is not a second toggle: only the chevron opens and closes.
      await folderRow.getByText(FILES_FOLDER, { exact: true }).last().click()
      await expect(chevron, 'clicking the folder name toggles nothing').toHaveAttribute(
        'aria-expanded',
        'false',
      )
      await expect(outputRow).toHaveCount(0)

      await chevron.click()
      await expect(chevron).toHaveAttribute('aria-expanded', 'true')
      await expect(outputRow, 'expanding brings the subtree back').toHaveCount(1)
    })

    await test.step('6. TDATA-7: Copy path puts the artifact:// reference on the clipboard', async () => {
      const copyButton = sectionOf(page, 'Files')
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
        .first()
        .getByTestId('copy-path-button')
      await expect(copyButton).not.toHaveAttribute('data-copied', 'true')

      await copyButton.click()
      await expect(copyButton, 'the copied cue appears on a real copy').toHaveAttribute(
        'data-copied',
        'true',
      )
      await expect(copyButton.locator('output')).toHaveText('Path copied')
      expect(
        await page.evaluate(() => navigator.clipboard.readText()),
        'the clipboard holds the block-usable reference',
      ).toBe(OUTPUT_REFERENCE)
    })

    await test.step('7. Soft-delete hides the row; Show removed reveals a tombstone (no restore)', async () => {
      const files = sectionOf(page, 'Files')
      const outputRow = files
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
      await outputRow.first().getByRole('button', { name: /^Delete output\.json$/ }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(outputRow, 'soft-deleted row hidden by default').toHaveCount(0)
      // The live listing no longer counts the deleted artifact (audit, not recycle bin).
      await expect
        .poll(() => liveArtifactCount(request, executionId))
        .toBe(expectedCount - 1)
      // Show removed reveals the tombstone with no actions and no restore.
      await page.getByTestId('artifact-show-removed').click()
      const tombstone = page
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
        .filter({ hasText: 'Removed' })
      await expect(tombstone.first()).toBeVisible()
      await expect(tombstone.first().getByRole('button')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /restore/i })).toHaveCount(0)
    })

    await test.step('8. Download all streams a valid .zip', async () => {
      const downloadPromise = page.waitForEvent('download')
      await page.getByTestId('artifact-download-all').click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/\.zip$/)
      const zip = fs.readFileSync(await download.path())
      expect(zip[0] === 0x50 && zip[1] === 0x4b, 'zip PK magic').toBeTruthy()
    })

    await test.step('9a. the row delete confirmation warns about artifacts and reports', async () => {
      await page.goto('/executions')
      await expect(page.getByTestId('executions-page')).toBeVisible()
      await page.getByPlaceholder('Search executions…').fill(testName)
      const execRow = page
        .locator('[data-testid="executions-table"] tbody tr')
        .filter({ hasText: testName })
      await expect(execRow.first()).toBeVisible()
      await execRow.first().locator('[data-testid="row-action-delete"]').click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('artifacts and reports')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      // Canceling did not delete the execution.
      await expect(execRow.first()).toBeVisible()
    })

    await test.step('9b. bulk delete confirms before deleting, then cascades', async () => {
      await page.getByRole('button', { name: /Mass Action/i }).click()
      const execRow = page
        .locator('[data-testid="executions-table"] tbody tr')
        .filter({ hasText: testName })
        .first()
      await execRow.getByRole('checkbox').click()
      await page.getByTestId('selection-counter').click()
      await page.getByTestId('bulk-action-delete').click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('artifacts and reports')
      // The confirmation appears BEFORE any deletion fires (row still present).
      await expect(execRow).toBeVisible()
      await dialog.getByRole('button', { name: 'Delete' }).click()
      await expect(execRow, 'execution removed from the list').toHaveCount(0)
    })

    await test.step('9c. the execution and its artifacts + reports are gone everywhere', async () => {
      // Artifact directory purged (cascade), so nothing lists for the execution.
      expect(await liveArtifactCount(request, executionId)).toBe(0)
      const summary = await request.get(
        `${BACKEND_URL}/artifacts/executions?search=${encodeURIComponent(testName)}`,
      )
      expect(((await summary.json()).data as unknown[]).length).toBe(0)
      const reports = await request.get(
        `${BACKEND_URL}/reports?search=${encodeURIComponent(testName)}`,
      )
      const reportRows = ((await reports.json()).data as Array<{ execution: { id: string } }>) ?? []
      expect(reportRows.some((r) => r.execution.id === executionId)).toBe(false)
      // And the browser surface reflects it. (The search filter is disabled in
      // the empty state - which is exactly what a sole-execution delete produces
      // - so assert the row's absence on the default view rather than searching.)
      await page.goto('/artifacts')
      await expect(page.getByTestId('artifacts-page')).toBeVisible()
      await expect(
        page.locator('[data-testid="artifacts-table"] tbody tr').filter({ hasText: testName }),
      ).toHaveCount(0)
    })
  })

  test('a byte range inside an artifact answers 206 with those bytes; a range past its end answers 416 RANGE_NOT_SATISFIABLE', async ({
    request,
  }) => {
    test.setTimeout(90_000)

    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const { id: testId } = await importFixture(request)
    let executionId = ''

    try {
      const validation = await validateTest(request, testId, 'run')
      expect(validation.errors, 'fixture validates with zero errors').toHaveLength(0)
      executionId = await startTrackedExecution(request, testId, environmentId)
      expect(await pollUntilTerminal(request, executionId), 'seeded run fails').toBe('failed')

      const artifact = await liveArtifact(request, executionId, OUTPUT_STORED_PATH)
      expect(artifact.size_bytes, 'the artifact is as long as the File I/O output').toBe(OUTPUT_SIZE)
      const contentUrl = `${BACKEND_URL}/artifacts/content/${artifact.id}`

      await test.step('a range inside the file answers 206 with exactly those bytes', async () => {
        const response = await request.get(contentUrl, {
          headers: { Range: `bytes=0-${RANGE_HEAD - 1}` },
        })
        expect(response.status(), 'a satisfiable range is partial content').toBe(206)
        expect(response.headers()['content-range']).toBe(`bytes 0-${RANGE_HEAD - 1}/${OUTPUT_SIZE}`)
        expect((await response.body()).toString('utf-8')).toBe(
          FIXTURE_OUTPUT_CONTENT.slice(0, RANGE_HEAD),
        )
      })

      await test.step('the last byte is still in range', async () => {
        const response = await request.get(contentUrl, {
          headers: { Range: `bytes=${OUTPUT_SIZE - 1}-` },
        })
        expect(response.status()).toBe(206)
        expect(response.headers()['content-range']).toBe(
          `bytes ${OUTPUT_SIZE - 1}-${OUTPUT_SIZE - 1}/${OUTPUT_SIZE}`,
        )
        expect((await response.body()).toString('utf-8')).toBe(FIXTURE_OUTPUT_CONTENT.slice(-1))
      })

      await test.step('a range that starts at or past the end answers 416 RANGE_NOT_SATISFIABLE', async () => {
        const pastTheEnd = [`bytes=${OUTPUT_SIZE}-`, `bytes=${OUTPUT_SIZE + 10}-${OUTPUT_SIZE + 20}`]
        for (const range of pastTheEnd) {
          const response = await request.get(contentUrl, { headers: { Range: range } })
          expect(response.status(), `"${range}" on a ${OUTPUT_SIZE}-byte artifact`).toBe(416)
          const body = (await response.json()) as { success: boolean; error: { code: string } }
          expect(body.success, `"${range}" answers an error body`).toBe(false)
          expect(body.error.code, `"${range}" names its error`).toBe(RANGE_ERROR_CODE)
        }
      })

      await test.step('the artifact is unchanged and still downloads whole', async () => {
        const response = await request.get(contentUrl)
        expect(response.status()).toBe(200)
        expect((await response.body()).toString('utf-8')).toBe(FIXTURE_OUTPUT_CONTENT)
      })
    } finally {
      if (executionId) {
        await request.delete(`${BACKEND_URL}/executions/${executionId}`).catch(() => undefined)
      }
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
  })
})
