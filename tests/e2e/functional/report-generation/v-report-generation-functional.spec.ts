/**
 * V-REPORT-GENERATION-FUNCTIONAL: On-demand execution report generation
 * Design Decisions: REPORT-1..REPORT-13 (document structure); an async job, a
 * synchronous workbench session path, inline disposition, POST is "ensure report
 * exists", one timeline row per canvas node, nested "Parent / Child" block paths,
 * chart expanded for small reports
 * REQ: REQ-3.7.2.1 .. REQ-3.7.2.8 (Report Generation)
 *
 * Scope guard: NO in-app viewer UI (V-REPORT-02). The report
 * document is opened via the inline artifact URL only.
 *
 * Pass Criteria:
 *  1. POST /tests imports the fixture; validation returns zero errors
 *  2. Tracked run started from the Tests list Run dialog reaches terminal passed
 *  3. POST /executions/{id}/report returns 202 with a job view
 *  4. GET /executions/{id}/report polls to completed with full progress and a
 *     report.html artifact_id (unversioned)
 *  5. Second POST returns 200 with the same artifact_id and no second report
 *     artifact is written (exists-check)
 *  6. GET /artifacts/content/{artifact_id}?disposition=inline renders the
 *     standalone document (header, status, entity chip, meta grid)
 *  7. Block Results cards count all 6 blocks as passed
 *  8. Timeline holds one row per canvas node in traversal order including the
 *     nested "Report_Loop / Nested_Log" path; the chart is expanded
 *  9. Errors section shows the ERROR log entry with its block path
 * 10. Log table (Time/Level/Source/Message) merges SYSTEM and Log-plugin
 *     sources; loop iterations appear per-entry while the timeline stays
 *     per-node
 * 11. Level filter hides DEBUG rows at INFO, leaves only ERROR/FATAL rows at
 *     ERROR, and the live entry count tracks visible rows
 * 12. Columns selector hides the Time column
 * 13. Theme switch toggles the dark class on the document
 * 14. Workbench ad-hoc run: POST /workbench/session/report writes
 *     report.html into the session artifact dir; a second POST returns the
 *     same path; the session content endpoint renders the document
 * 15. Warning tile color in the EXPORTED document: with one warning Block the
 *     tile number is amber - the same color as the warning step row, its
 *     timeline bar and the WARN log rows - and with no warning Block it reads
 *     0 in the same gray as its own label. A WARN-level Log line is not a
 *     warning Block and must not move the tile
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/report-generation/v-report-generation-functional.spec.ts
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'
import { runTrackedTest } from '../../helpers/k8s-run'
import { escapeRegExp } from '../../helpers/log-reader'
import { resetOwnership } from '../../helpers/ownership'
import { blockSource } from '../shell-blocks/shell-helpers'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(file = 'fixture.json'): Record<string, any> {
  const raw = fs.readFileSync(path.resolve(__dirname, file), 'utf-8')
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function importFixture(
  request: APIRequestContext,
  file = 'fixture.json',
): Promise<{ id: string; name: string }> {
  const fixture = loadFixture(file)
  const name = `${fixture.name as string} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  fixture.name = name
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return { id: data.id as string, name }
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok(), `GET /executions/${executionId} failed: ${response.status()}`).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function findExecutionId(
  request: APIRequestContext,
  testId: string,
  timeoutMs = 15_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions?entity_id=${testId}`)
    expect(response.ok(), `GET /executions failed: ${response.status()}`).toBeTruthy()
    const body = await response.json()
    const rows = (body.data ?? []) as Array<Record<string, unknown>>
    if (rows.length > 0) {
      return rows[0].id as string
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`No execution appeared for test ${testId} within ${timeoutMs}ms`)
}

async function pollReportCompleted(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 20_000,
): Promise<Record<string, any>> {
  const start = Date.now()
  let job: Record<string, any> = {}
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}/report`)
    expect(
      response.ok(),
      `GET /executions/${executionId}/report failed: ${response.status()}`,
    ).toBeTruthy()
    const body = await response.json()
    job = (body.data ?? body) as Record<string, any>
    if (job.status === 'completed') {
      return job
    }
    expect(job.status, `report job failed: ${job.error}`).not.toBe('failed')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `Report for ${executionId} did not complete within ${timeoutMs}ms (last status: ${job.status})`,
  )
}

/** Generate (or reuse) a tracked execution's report and open it inline. */
async function openExecutionReport(
  page: Page,
  request: APIRequestContext,
  executionId: string,
): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/executions/${executionId}/report`)
  expect(
    [200, 202].includes(response.status()),
    `POST report expected 200/202, got ${response.status()}: ${await response.text()}`,
  ).toBeTruthy()
  const job = await pollReportCompleted(request, executionId)
  await page.goto(
    `${BACKEND_URL}/artifacts/content/${job.artifact_id as string}?disposition=inline`,
  )
}

/** One Block Results tile in the exported document, located by its label. */
function outcomeTile(page: Page, label: string): Locator {
  return page
    .locator('.rpt-card')
    .filter({ has: page.locator('.rpt-lbl', { hasText: new RegExp(`^${label}$`) }) })
}

async function textColor(locator: Locator): Promise<string> {
  return locator.first().evaluate((el) => getComputedStyle(el).color)
}

async function fillColor(locator: Locator): Promise<string> {
  return locator.first().evaluate((el) => getComputedStyle(el).backgroundColor)
}

async function selectWorkbenchEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

/** Visible log rows must match the live "N entries" counter (REQ-3.7.2.8). */
async function expectLogCountMatchesVisibleRows(page: Page) {
  const visible = await page.locator('#rpt-logbody .rpt-row:not([hidden])').count()
  await expect(page.locator('#rpt-logcount')).toHaveText(
    `${visible} ${visible === 1 ? 'entry' : 'entries'}`,
  )
}

// Match a log-row message cell EXACTLY, so the engine's masked Inputs:/Output:
// echo rows (which embed the same message text) are not mistaken for the entry.
function exactMessage(message: string): RegExp {
  return new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

// Shared document assertions for both the execution and the session report.
async function expectReportDocument(page: Page, testName: string) {
  await expect(page.locator('.rpt-wordmark')).toHaveText('WAVE')
  await expect(page.locator('.rpt-doctype')).toHaveText('Execution Report')
  await expect(page.locator('.rpt-brandright .rpt-status')).toHaveText('Passed')
  await expect(page.locator('.rpt-title')).toHaveText(testName)
  await expect(page.locator('.rpt-entitychip')).toHaveText('Test')

  // Timeline: nested body block carries the "Parent / Child" path.
  const timeline = page.locator('table.rpt-table')
  await expect(timeline.locator('td', { hasText: 'Report_Loop / Nested_Log' })).toBeVisible()

  // Log table headers (REQ-3.7.2.7 merged stream rendering).
  const logTable = page.locator('#rpt-logtable')
  await expect(logTable.locator('thead th')).toHaveText(['Time', 'Level', 'Source', 'Message'])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Report Generation E2E', () => {
  test('Tracked execution: generate, idempotent re-POST, render and drive the document', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    let testId = ''
    let testName = ''
    let executionId = ''
    let artifactId = ''

    // ================================================================
    // STEP 1: Import fixture and validate (zero errors)
    // ================================================================
    await test.step('Import fixture via API and validate', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      const imported = await importFixture(request)
      testId = imported.id
      testName = imported.name

      const validation = await validateTest(request, testId, 'run')
      expect(validation.status).toBe(200)
      expect(
        validation.errors,
        `Fixture must pass validation with zero errors. Got: ${JSON.stringify(validation.errors)}`,
      ).toHaveLength(0)
    })

    // ================================================================
    // STEP 2: UI-driven tracked run from the Tests list
    // ================================================================
    await test.step('Run the test from the Tests list and wait for terminal', async () => {
      await page.goto('/tests')
      await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 10_000 })

      await page.locator('[data-testid="search-input"] input').fill(testName)
      const runButton = page.getByRole('button', { name: `Run ${testName}` })
      await expect(runButton).toBeVisible()
      await runButton.click()

      const dialog = page.locator('[data-testid="run-dialog-content"]')
      await expect(dialog).toBeVisible()
      await dialog
        .locator(`[data-testid="all-environments"] [data-env-id="${environmentId}"]`)
        .click()
      await dialog.locator('[data-testid="run-dialog-run"]').click()

      // Test runs stream live on the Workbench canvas.
      await page.waitForURL(/\/workbench/)

      executionId = await findExecutionId(request, testId)
      const terminal = await pollUntilTerminal(request, executionId)
      expect(terminal.status, 'tracked execution must pass').toBe('passed')
    })

    // ================================================================
    // STEP 3: POST report (202), poll to completed
    // ================================================================
    await test.step('POST /executions/{id}/report starts a generation job', async () => {
      const response = await request.post(`${BACKEND_URL}/executions/${executionId}/report`)
      expect(
        response.status(),
        `POST report expected 202, got ${response.status()}: ${await response.text()}`,
      ).toBe(202)
      const body = await response.json()
      const job = (body.data ?? body) as Record<string, any>
      expect(job.execution_id).toBe(executionId)
      expect(job.format).toBe('html')
      expect(['pending', 'running']).toContain(job.status)

      const completed = await pollReportCompleted(request, executionId)
      expect(completed.artifact_id, 'generation writes the unversioned report').toMatch(
        /report\.html$/,
      )
      expect(completed.progress.runs_processed).toBe(completed.progress.runs_total)
      expect(completed.error).toBeNull()
      artifactId = completed.artifact_id as string
    })

    // ================================================================
    // STEP 4: Second POST is an exists-check - no regeneration
    // ================================================================
    await test.step('Second POST returns 200 with the same artifact and no new write', async () => {
      const response = await request.post(`${BACKEND_URL}/executions/${executionId}/report`)
      expect(response.status(), 'existing artifact must short-circuit to 200').toBe(200)
      const body = await response.json()
      const job = (body.data ?? body) as Record<string, any>
      expect(job.status).toBe('completed')
      expect(job.artifact_id).toBe(artifactId)

      const listResponse = await request.get(
        `${BACKEND_URL}/artifacts?execution_id=${executionId}`,
      )
      expect(listResponse.ok()).toBeTruthy()
      // GET /artifacts wraps the list under `data` (the shared success envelope),
      // unlike the session artifacts endpoint below which returns `{items}`.
      const listing = (await listResponse.json()) as {
        data: Array<{ path: string }>
      }
      const reportFiles = listing.data.filter((item) => /^report\.html$/.test(item.path))
      expect(reportFiles, 'exactly one HTML report artifact must exist').toHaveLength(1)
      expect(reportFiles[0].path).toBe('report.html')
    })

    // ================================================================
    // STEP 5: Open the document via the inline artifact URL
    // ================================================================
    await test.step('Inline artifact URL renders the standalone document', async () => {
      await page.goto(`${BACKEND_URL}/artifacts/content/${artifactId}?disposition=inline`)
      await expectReportDocument(page, testName)

      // Meta grid carries the full execution ID.
      await expect(page.locator('.rpt-meta dd.rpt-mono')).toHaveText(executionId)
    })

    // ================================================================
    // STEP 6: Block Results cards
    // ================================================================
    await test.step('Block Results cards count all six blocks as passed', async () => {
      await expect(page.locator('.rpt-h2', { hasText: 'Block Results' })).toBeVisible()
      const card = (label: string) =>
        page
          .locator('.rpt-card')
          .filter({ has: page.locator('.rpt-lbl', { hasText: new RegExp(`^${label}$`) }) })
          .locator('.rpt-num')
      await expect(card('Total')).toHaveText('6')
      await expect(card('Passed')).toHaveText('6')
      await expect(card('Failed')).toHaveText('0')
      await expect(card('Warning')).toHaveText('0')
    })

    // ================================================================
    // STEP 7: Timeline rows in traversal order, one per node
    // ================================================================
    await test.step('Timeline holds one row per canvas node in traversal order', async () => {
      const rows = page.locator('table.rpt-table tbody tr')
      await expect(rows).toHaveCount(6)
      const names = rows.locator('td:nth-child(2)')
      await expect(names).toHaveText([
        'Startup_Log',
        'Debug_Log',
        'Warn_Log',
        'Report_Loop',
        'Report_Loop / Nested_Log',
        'Error_Log',
      ])
      // 6 rows is under the collapse threshold: chart defaults to expanded.
      await expect(page.locator('details.rpt-chart')).toHaveAttribute('open', '')
      await expect(page.locator('.rpt-gantt-collbl').first()).toHaveText('Block')
    })

    // ================================================================
    // STEP 8: Errors section (REQ-3.7.2.4)
    // ================================================================
    await test.step('Errors section shows the ERROR entry with its block path', async () => {
      const errorCard = page.locator('.rpt-errorcard')
      await expect(errorCard).toHaveCount(1)
      await expect(errorCard.locator('.rpt-lvl')).toHaveText('ERROR')
      await expect(errorCard.locator('.rpt-errorpath')).toHaveText('Error_Log')
      await expect(errorCard.locator('.rpt-errormsg')).toHaveText('Report simulated error')
    })

    // ================================================================
    // STEP 9: Merged log stream (REQ-3.7.2.5/2.6/2.7)
    // ================================================================
    await test.step('Log table merges SYSTEM and plugin sources with per-iteration entries', async () => {
      const logRows = page.locator('#rpt-logbody .rpt-row')
      await expect(
        logRows.filter({ has: page.locator('td.rpt-col-src', { hasText: 'SYSTEM' }) }).first(),
        'merged stream must contain SYSTEM entries',
      ).toBeVisible()
      const logSource = new RegExp(`^${escapeRegExp(blockSource('Log', 'Startup_Log'))}$`)
      await expect(
        logRows.filter({ has: page.locator('td.rpt-col-src', { hasText: logSource }) }).first(),
        'merged stream must contain Log plugin entries',
      ).toBeVisible()

      // Each level carries its level cell (REQ-3.7.2.6).
      for (const [level, message] of [
        ['DEBUG', 'Report debug diagnostics'],
        ['INFO', 'Report run started'],
        ['WARN', 'Report warning threshold'],
        ['ERROR', 'Report simulated error'],
      ]) {
        const row = logRows
          .filter({ has: page.locator('td.rpt-col-msg', { hasText: exactMessage(message) }) })
          .first()
        await expect(row, `log row "${message}" must be present`).toBeVisible()
        await expect(row).toHaveAttribute('data-level', level)
      }

      // Two loop iterations = two log entries, while the timeline keeps one row.
      await expect(
        logRows.filter({
          has: page.locator('td.rpt-col-msg', { hasText: exactMessage('Nested iteration log') }),
        }),
      ).toHaveCount(2)

      await expectLogCountMatchesVisibleRows(page)
    })

    // ================================================================
    // STEP 10: Level filter (REQ-3.7.2.8)
    // ================================================================
    await test.step('Level filter hides lower levels and updates the entry count', async () => {
      const debugRow = page
        .locator('#rpt-logbody .rpt-row[data-level="DEBUG"]')
        .first()
      await expect(debugRow).toBeVisible()

      await page.locator('#rpt-level').selectOption('INFO')
      await expect(debugRow).toBeHidden()
      await expectLogCountMatchesVisibleRows(page)

      await page.locator('#rpt-level').selectOption('ERROR')
      await expect(page.locator('#rpt-logbody .rpt-row[data-level="WARN"]').first()).toBeHidden()
      await expect(page.locator('#rpt-logbody .rpt-row[data-level="INFO"]').first()).toBeHidden()
      const visibleRows = page.locator('#rpt-logbody .rpt-row:not([hidden])')
      const visibleCount = await visibleRows.count()
      expect(visibleCount, 'at least the ERROR entry remains visible').toBeGreaterThan(0)
      for (let i = 0; i < visibleCount; i++) {
        const level = await visibleRows.nth(i).getAttribute('data-level')
        expect(['ERROR', 'FATAL'], `row ${i} visible at ERROR threshold`).toContain(level)
      }
      await expectLogCountMatchesVisibleRows(page)

      await page.locator('#rpt-level').selectOption('DEBUG')
      await expect(debugRow).toBeVisible()
      await expectLogCountMatchesVisibleRows(page)
    })

    // ================================================================
    // STEP 11: Columns selector
    // ================================================================
    await test.step('Columns selector toggles the Time column off', async () => {
      await expect(page.locator('#rpt-logtable thead th.rpt-col-ts')).toBeVisible()
      await page.locator('details.rpt-cols summary').click()
      await page.locator('.rpt-cols input[data-col="ts"]').uncheck()
      await expect(page.locator('#rpt-logtable thead th.rpt-col-ts')).toBeHidden()
      await expect(page.locator('#rpt-logtable')).toHaveClass(/rpt-hide-ts/)
    })

    // ================================================================
    // STEP 12: Theme switch
    // ================================================================
    await test.step('Theme switch toggles the dark class', async () => {
      await expect(page.locator('html')).not.toHaveClass(/dark/)
      await page.locator('#rpt-theme').click()
      await expect(page.locator('html')).toHaveClass(/dark/)
      await page.locator('#rpt-theme').click()
      await expect(page.locator('html')).not.toHaveClass(/dark/)
    })
  })

  test('Workbench ad-hoc run: session report generates synchronously and renders', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    // Start from a free workbench session: a leftover holder would make this
    // tab a watcher, and a watcher is never promoted.
    await resetOwnership(request)

    let testId = ''
    let testName = ''

    // ================================================================
    // STEP 1: Import fixture, open in workbench, run ad-hoc
    // ================================================================
    await test.step('Import fixture and run via the canvas Run button', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      const imported = await importFixture(request)
      testId = imported.id
      testName = imported.name

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)

      await selectWorkbenchEnvironment(page, E2E_ENV_NAME)
      await page.locator('[data-testid="run-button"]').click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
        timeout: 15_000,
      })
      await expect(statusIndicator).toHaveAttribute('data-status', 'passed')
    })

    // ================================================================
    // STEP 2: POST /workbench/session/report (synchronous)
    // ================================================================
    let reportPath = ''
    await test.step('POST /workbench/session/report writes report.html', async () => {
      const response = await request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(
        response.status(),
        `POST /workbench/session/report failed: ${response.status()}: ${await response.text()}`,
      ).toBe(200)
      const body = await response.json()
      const data = (body.data ?? body) as Record<string, any>
      expect(data.format).toBe('html')
      expect(data.session_id).toBeTruthy()
      expect(data.path).toBe('report.html')
      reportPath = data.path as string
    })

    // ================================================================
    // STEP 3: Second POST returns the existing artifact
    // ================================================================
    await test.step('Second POST returns the existing report, no v2', async () => {
      const response = await request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(response.status()).toBe(200)
      const body = await response.json()
      const data = (body.data ?? body) as Record<string, any>
      expect(data.path, 'exists-check must not write a second copy').toBe('report.html')

      const listResponse = await request.get(`${BACKEND_URL}/workbench/session/artifacts`)
      expect(listResponse.ok()).toBeTruthy()
      const listing = (await listResponse.json()) as { items: Array<{ path: string }> }
      const reports = listing.items.filter((item) => /^report\.html$/.test(item.path))
      expect(reports).toHaveLength(1)
    })

    // ================================================================
    // STEP 4: Session content endpoint renders the document
    // ================================================================
    await test.step('Session artifact content endpoint renders the document', async () => {
      // The content endpoint hands files over as downloads; inline is what renders.
      await page.goto(
        `${BACKEND_URL}/workbench/session/artifacts/content/${reportPath}?disposition=inline`,
      )
      await expectReportDocument(page, testName)

      // Session documents identify by Session ID instead of Execution ID.
      await expect(page.locator('.rpt-meta dt', { hasText: 'Session ID' })).toBeVisible()
    })
  })

  test('Exported Warning tile: amber when a Block warns, gray when none does', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)

    // ================================================================
    // STEP 1: A tracked run holding one informational assert failure
    // ================================================================
    let warnExecutionId = ''
    await test.step('Import the warning fixture and run it tracked', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      const imported = await importFixture(request, 'fixture-warning.json')

      const validation = await validateTest(request, imported.id, 'run')
      expect(
        validation.errors,
        `Warning fixture must validate clean. Got: ${JSON.stringify(validation.errors)}`,
      ).toHaveLength(0)

      const run = await runTrackedTest(request, imported.id)
      expect(run.verdict, 'a warning Block must not fail the run verdict').toBe('passed')
      warnExecutionId = run.executionId
    })

    // ================================================================
    // STEP 2: The tile counts the Block and paints amber
    // ================================================================
    await test.step('Warning tile counts the Block and reads amber', async () => {
      await openExecutionReport(page, request, warnExecutionId)

      const tile = outcomeTile(page, 'Warning')
      await expect(tile).toHaveClass(/rpt-card-warn/)
      await expect(tile.locator('.rpt-num')).toHaveText('1')
      await expect(outcomeTile(page, 'Total').locator('.rpt-num')).toHaveText('4')
      await expect(outcomeTile(page, 'Passed').locator('.rpt-num')).toHaveText('3')
      await expect(outcomeTile(page, 'Failed').locator('.rpt-num')).toHaveText('0')

      const amber = await textColor(tile.locator('.rpt-num'))
      expect(
        await textColor(tile.locator('.rpt-lbl')),
        'the tile number must not carry the gray its own label carries',
      ).not.toBe(amber)
      expect(
        await textColor(page.locator('table.rpt-table .rpt-status-warning')),
        'the tile number is the color of the warning step row',
      ).toBe(amber)
      expect(
        await fillColor(page.locator('.rpt-gantt-fill-warning')),
        'the tile number is the color of the warning timeline bar',
      ).toBe(amber)
      expect(
        await textColor(page.locator('#rpt-logbody .rpt-row-WARN')),
        'the tile number is the color of the WARN log rows',
      ).toBe(amber)
    })

    // ================================================================
    // STEP 3: No warning Block reads 0 in gray, WARN log lines included
    // ================================================================
    await test.step('A run with no warning Block reads 0 in gray', async () => {
      const imported = await importFixture(request)
      const run = await runTrackedTest(request, imported.id)
      expect(run.verdict, 'the zero-warning run must pass').toBe('passed')
      await openExecutionReport(page, request, run.executionId)

      const tile = outcomeTile(page, 'Warning')
      await expect(tile).toHaveClass(/rpt-card-muted/)
      await expect(tile).not.toHaveClass(/rpt-card-warn/)
      await expect(tile.locator('.rpt-num')).toHaveText('0')
      await expect(page.locator('.rpt-gantt-fill-warning')).toHaveCount(0)

      const gray = await textColor(tile.locator('.rpt-num'))
      expect(
        await textColor(tile.locator('.rpt-lbl')),
        'zero reads the same gray as the tile label',
      ).toBe(gray)
      // This document still holds WARN log rows: a WARN line is not a warning Block.
      expect(
        await textColor(page.locator('#rpt-logbody .rpt-row-WARN')),
        'a WARN log line must not tint the tile amber',
      ).not.toBe(gray)
    })
  })
})
