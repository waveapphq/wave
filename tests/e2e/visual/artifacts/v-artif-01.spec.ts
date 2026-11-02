/**
 * V-ARTIF-01: Artifact Browser (execution-first list + per-execution drill)
 * Design Decisions: ARTIF-1..13
 * REQ: REQ-5.2.1.41, REQ-5.2.6.4.8, REQ-6.1.4, REQ-3.7.1.1
 *
 * Seeds ONE failing tracked test execution that produces every artifact section
 * (File I/O output under data/, an ERROR that error.json aggregates, the
 * persisted per-test log, and report.html/report.json on demand), then asserts
 * the landing list + drill layout against the wireframe.
 *
 * Pass Criteria:
 *  1. Landing row: Type chip (icon + label), status dot+label, Artifacts count
 *     (archive icon), Size; filter-aware grand-total size chip; no "New" button.
 *  2. Selection: Mass Action -> checkbox -> counter "X of Y · <size>";
 *     mass-action menu = Download (.zip) + Delete artifacts only.
 *  3. Drill: Failure summary / Reports / Logs / Files in fixed order; the
 *     Failure summary carries a "1 failures" badge.
 *  4. Drill header: the meta line lives in the header block above the
 *     divider (not the scroll body); an entity chip + a status-colored (error,
 *     not muted) status label; Download all (.zip) carries a leading icon.
 *  5. No preview / eye / open-in-viewer affordance anywhere.
 *  6. Logs tree: a red-tinted test leaf; Tree|Flat toggle on Logs+Files only.
 *  7. Files tree: a directory node with subtree size + download + delete (no
 *     preview slot) and indented leaves.
 *  8. Long file names clip to a hover popover (shared TruncatedName).
 *  9. Soft-delete hides a row; Show removed reveals a muted, struck tombstone
 *     with no actions (no restore).
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'

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
  const data = (body.data ?? body) as Record<string, unknown>
  return { id: data.id as string, name }
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

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const status = (((await response.json()).data ?? {}) as Record<string, unknown>).status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') return status
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach a terminal state in ${timeoutMs}ms`)
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
    const job = (((await response.json()).data ?? {}) as Record<string, unknown>)
    if (job.status === 'completed') return
    expect(job.status, `report ${format} job failed`).not.toBe('failed')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Report ${format} for ${executionId} did not complete`)
}

async function gotoArtifactsRow(page: Page, name: string) {
  await page.goto('/artifacts')
  await expect(page.getByTestId('artifacts-page')).toBeVisible()
  await page.getByPlaceholder('Search artifacts…').fill(name)
  const row = page.locator('[data-testid="artifacts-table"] tbody tr').filter({ hasText: name })
  await expect(row.first()).toBeVisible()
  return row.first()
}

/** A drill section located by its exact bold title span (avoids the "logs"
 *  substring in the failure-summary subtitle). */
function sectionByTitle(page: Page, title: string) {
  return page.locator('section', {
    has: page.locator('span.text-sm.font-bold', { hasText: title }),
  })
}

test.describe('V-ARTIF-01: Artifact browser list + drill', () => {
  test('landing list, drill sections, logs/files trees, truncation, show removed', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const { id: testId, name: testName } = await importFixture(request)

    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, 'fixture validates with zero errors').toHaveLength(0)

    const executionId = await startTrackedExecution(request, testId, environmentId)
    const status = await pollUntilTerminal(request, executionId)
    expect(status, 'seeded execution ends failed (Assert fail_current_scope)').toBe('failed')
    await generateReport(request, executionId, 'html')
    await generateReport(request, executionId, 'json')

    await test.step('1. Landing list row + columns + grand-total size', async () => {
      const row = await gotoArtifactsRow(page, testName)
      // Execution-first, no "New" button.
      await expect(page.getByRole('button', { name: /^new/i })).toHaveCount(0)
      // Type column is the shared entity chip WITH an icon, not plain text.
      const typeChip = row.locator('[data-testid="artifact-type"]')
      await expect(typeChip).toContainText('Test')
      await expect(typeChip.locator('svg'), 'Type chip carries the entity icon').toBeVisible()
      // Status cell is a dot + "Failed" label.
      await expect(row.locator('[data-testid="status-badge-failed"]')).toContainText('Failed')
      // Artifacts count cell carries the archive icon + a positive count.
      const countCell = row.locator('[data-testid="artifact-count"]')
      await expect(countCell.locator('svg')).toBeVisible()
      await expect(countCell).toContainText(/[1-9]/)
      await expect(row.locator('[data-testid="artifact-size"]')).not.toHaveText('')
      // Filter-aware grand-total size chip.
      await expect(page.getByTestId('artifacts-total-size')).toContainText('total')
    })

    await test.step('2. Selection counter "X of Y · size" + mass-action menu', async () => {
      await page.getByRole('button', { name: /Mass Action/i }).click()
      await page
        .locator('[data-testid="artifacts-table"] tbody tr')
        .filter({ hasText: testName })
        .first()
        .getByRole('checkbox')
        .click()
      // Counter reads "<selected> of <total> · <size>" (not "N selected").
      const counter = page.getByTestId('selection-counter')
      await expect(counter).toContainText(/\d+ of \d+ · /)
      await counter.click()
      // Mass-action menu = Download (.zip) + Delete artifacts only; no view / export.
      await expect(page.getByTestId('artifact-bulk-download')).toBeVisible()
      await expect(page.getByTestId('artifact-bulk-delete')).toBeVisible()
      await expect(page.getByRole('menuitem', { name: /view/i })).toHaveCount(0)
      await expect(page.getByRole('menuitem', { name: /export/i })).toHaveCount(0)
      await page.keyboard.press('Escape')
    })

    await test.step('3. Drill: four sections in fixed order + failure badge', async () => {
      await page.goto(`/artifacts/${executionId}`)
      await expect(page.getByTestId('artifact-drill-page')).toBeVisible()
      await expect(
        page.locator('[data-testid="artifact-drill-page"] span.text-sm.font-bold'),
      ).toHaveText(['Failure summary', 'Reports', 'Logs', 'Files'])
      await expect(
        sectionByTitle(page, 'Failure summary').getByText(/^1 failures$/),
      ).toBeVisible()
    })

    await test.step('4. Drill header meta placement + entity chip + colored status + download icon', async () => {
      // The meta line lives inside the header block (which owns the download-all
      // action) and NOT inside the scrolling section body.
      const metaInHeader = await page.getByTestId('artifact-drill-meta').evaluate((el) => {
        const header = el.closest('div.border-b')
        if (!header) return false
        const hasDownloadAll = !!header.querySelector('[data-testid="artifact-download-all"]')
        const hasFileRow = !!header.querySelector('[data-testid="file-row"]')
        return hasDownloadAll && !hasFileRow
      })
      expect(metaInHeader, 'meta renders in the header, above the divider').toBe(true)
      await expect(page.getByTestId('artifact-drill-meta')).toContainText(/artifacts ·/)
      // Entity chip + status-colored (error) semibold label live in the header.
      const header = page.locator('[data-testid="artifact-drill-page"] > div.border-b')
      await expect(header.getByText('Test', { exact: true })).toBeVisible()
      await expect(header.locator('span.font-semibold', { hasText: 'Failed' })).toHaveClass(
        /text-error/,
      )
      // Download all carries a leading lucide download icon.
      await expect(page.getByTestId('artifact-download-all').locator('svg')).toBeVisible()
    })

    await test.step('5. No preview / eye / open-in-viewer affordance anywhere', async () => {
      await expect(page.getByRole('button', { name: /preview/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /open in viewer/i })).toHaveCount(0)
      await expect(
        page.locator('[data-testid="artifact-drill-page"]').getByText(/open in viewer/i),
      ).toHaveCount(0)
      // Every live file row exposes exactly Copy path + Download + Delete (no eye).
      await expect(
        page.locator('[data-testid="file-row"]').first().getByRole('button'),
      ).toHaveCount(3)
    })

    await test.step('6. Logs tree: red-tinted test leaf + Tree|Flat on Logs+Files only', async () => {
      const logs = sectionByTitle(page, 'Logs')
      const files = sectionByTitle(page, 'Files')
      // The shared SegmentedControl is a labeled fieldset, which is role group.
      await expect(logs.getByRole('group', { name: 'Logs view' })).toBeVisible()
      await expect(files.getByRole('group', { name: 'Files view' })).toBeVisible()
      // Failure + Reports (flat) sections carry no view toggle. Named, so these
      // stay real guards rather than passing because no toolbar exists anywhere.
      await expect(
        sectionByTitle(page, 'Reports').getByRole('group', { name: 'Reports view' }),
      ).toHaveCount(0)
      await expect(
        sectionByTitle(page, 'Failure summary').getByRole('group', {
          name: 'Failure summary view',
        }),
      ).toHaveCount(0)
      // The test leaf carries the entity tile tinted red (#EF4444 = rgb(239,68,68)).
      const logLeaf = logs.locator('[data-testid="file-row"]').first()
      await expect(logLeaf).toContainText('.log')
      await expect(logLeaf.locator('span[aria-hidden="true"]').first()).toHaveCSS(
        'color',
        'rgb(239, 68, 68)',
      )
      // Flat mode surfaces the artifact path as the row subtitle.
      await logs.getByRole('button', { name: 'Flat' }).click()
      await expect(logs.locator('[data-testid="artifact-file-subtitle"]').first()).toContainText(
        'logs/',
      )
    })

    await test.step('7. Files tree: directory node actions + no preview slot', async () => {
      const files = sectionByTitle(page, 'Files')
      // The data/ subtree is a directory node with subtree download + delete and
      // NO preview slot, so columns align with the leaves.
      await expect(files.getByRole('button', { name: /^(Collapse|Expand) data$/ })).toBeVisible()
      await expect(files.getByRole('button', { name: 'Download data' })).toBeVisible()
      await expect(files.getByRole('button', { name: 'Delete data' })).toBeVisible()
      // Leaves under the node are file rows (Copy path + Download + Delete).
      await expect(
        files.locator('[data-testid="file-row"]').first().getByRole('button'),
      ).toHaveCount(3)
    })

    await test.step('8. Long file name clips to a hover popover (shared TruncatedName)', async () => {
      const files = sectionByTitle(page, 'Files')
      const longName =
        'regression-run-detailed-output-summary-with-an-intentionally-long-file-name.json'
      await files.getByText(longName).first().hover()
      await expect(page.getByRole('tooltip')).toContainText(longName)
    })

    await test.step('9. Soft-delete -> hidden; Show removed reveals a tombstone with no restore', async () => {
      const files = sectionByTitle(page, 'Files')
      const outputRow = files
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
      await outputRow.first().getByRole('button', { name: /^Delete output\.json$/ }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
      // Removed rows are hidden by default; a Show removed toggle appears.
      await expect(outputRow).toHaveCount(0)
      const toggle = page.getByTestId('artifact-show-removed')
      await expect(toggle).toContainText(/removed artifacts$/)
      await toggle.click()
      // The tombstone row is muted + struck, tagged Removed, and has NO actions.
      const tombstone = page
        .locator('[data-testid="file-row"]')
        .filter({ hasText: 'output.json' })
        .filter({ hasText: 'Removed' })
      await expect(tombstone.first()).toBeVisible()
      await expect(
        tombstone.first().getByRole('button'),
        'tombstones expose no restore/actions',
      ).toHaveCount(0)
    })
  })
})
