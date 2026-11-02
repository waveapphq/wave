/**
 * V-RUNM-PARITY-FUNCTIONAL: mirroring is broadcast-only - a watched run leaves
 * exactly the same record as an unwatched one.
 * Wireframes: none of its own
 * Design Decisions: RUNM-9, RUNM-10; REPORT-12..14
 * REQ: REQ-5.2.7.15, REQ-3.4.2.7
 *
 * Pass Criteria:
 * 1. The exported JSON report's log rows of a watched run match an unwatched
 *    run of the same test one-for-one in count, order, level, source and
 *    message; summary counts and timeline statuses are identical.
 * 2. The persisted history payloads (block states, end-of-run variables, log
 *    rows) match apart from ids and timestamps.
 * 3. The console lines the mirror showed live equal what the Execution
 *    History page repaints for the same run, in order and level.
 * 4. The environment the mirror reflected equals the history page readout.
 */

import type { BrowserContext } from '@playwright/test'
import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, FRONTEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import { getLogEntries } from '../../helpers/log-reader'
import { SEL, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import {
  loadFixture,
  importFixture,
  openWatcher,
  allowRunAttach,
  ensureConsoleExpanded,
  consoleRows,
  environmentId,
  startTrackedRun,
  pollExecutionTerminal,
} from './helpers'

const open: BrowserContext[] = []

interface HistoryPayload {
  status: string
  block_states: Record<string, string>
  variables: Record<string, unknown>
  logs: Array<{
    level?: string
    source?: string
    message?: string
    sequence?: number
    seq?: number
  }>
  environment_name: string | null
}

async function fetchHistory(
  request: APIRequestContext,
  executionId: string,
): Promise<HistoryPayload> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(resp.ok(), `GET /executions/history/${executionId} failed: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()).data ?? {}) as HistoryPayload
}

/** Measured wall-clock values differ per run like timestamps do; normalize them
 *  so the comparison is about content, order and level. */
function normalizeMessage(message: string): string {
  return message.replace(/\(\d+ ms elapsed\)/g, '(<elapsed> ms elapsed)')
}

function comparableLogs(logs: HistoryPayload['logs']): Array<[number, string, string, string]> {
  return logs.map((entry) => [
    entry.seq ?? entry.sequence ?? -1,
    (entry.level ?? '').toUpperCase(),
    entry.source ?? '',
    normalizeMessage(entry.message ?? ''),
  ])
}

async function generateJsonReport(
  request: APIRequestContext,
  executionId: string,
): Promise<Record<string, any>> {
  await request.post(`${BACKEND_URL}/executions/${executionId}/report?format=json`)
  let artifactId = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}/report?format=json`)
        const job = ((await resp.json()).data ?? {}) as { status?: string; artifact_id?: string }
        expect(job.status, 'report job must not fail').not.toBe('failed')
        artifactId = job.artifact_id ?? ''
        return job.status
      },
      { timeout: 30_000, message: 'expected the JSON report job to complete' },
    )
    .toBe('completed')
  const artifact = await request.get(
    `${BACKEND_URL}/artifacts/content/${artifactId}?disposition=inline`,
  )
  expect(artifact.ok(), `artifact fetch failed: ${artifact.status()}`).toBeTruthy()
  return (await artifact.json()) as Record<string, any>
}

/** Show every entry on the watcher console: DEBUG floor (system logs default on). */
async function showAllLevels(page: Page): Promise<void> {
  await ensureConsoleExpanded(page)
  await page
    .locator('[data-testid="console-panel-header"] button[aria-label="Minimum log level"]')
    .first()
    .click()
  await page.locator('[role="option"]', { hasText: 'DEBUG' }).first().click()
}

test.describe('V-RUNM-PARITY-FUNCTIONAL: watched and unwatched runs leave the same record', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
  })

  test('report rows, history payloads and the live mirror all agree', async ({
    browser,
    request,
  }) => {
    const testId = await importFixture(request, loadFixture())
    const envId = await environmentId(request)

    let watchedExec = ''
    let mirroredLive: Array<{ level: string; source: string; message: string }> = []

    await test.step('watched run: a holder idles, a watcher mirrors the stream', async () => {
      const holderContext = await browser.newContext({ baseURL: FRONTEND_URL })
      open.push(holderContext)
      const holderTab = await holderContext.newPage()
      await stubSessionRecovery(holderTab)
      await holderTab.goto('/workbench')
      await waitForCanvasLoad(holderTab)
      await waitUntilHeld(request)

      const watcher = await openWatcher(browser, (c) => open.push(c))
      await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()
      await showAllLevels(watcher)
      await allowRunAttach(watcher)

      watchedExec = await startTrackedRun(request, testId, envId)
      await expect(watcher.locator(SEL.banner)).toContainText('read-only, running live', {
        timeout: 15_000,
      })
      // The reflected environment on the mirror (compared to history below).
      await expect(watcher.locator(SEL.envSelector)).toContainText(E2E_ENV_NAME)
      await expect
        .poll(async () => consoleRows(watcher).count(), { timeout: 20_000 })
        .toBeGreaterThan(0)

      expect(await pollExecutionTerminal(request, watchedExec)).toBe('passed')
      await expect(watcher.locator(SEL.banner)).not.toContainText('running live', {
        timeout: 15_000,
      })

      mirroredLive = (await getLogEntries(watcher)).map((entry) => ({
        level: entry.level.toUpperCase(),
        source: entry.source,
        message: normalizeMessage(entry.message),
      }))
      expect(mirroredLive.length, 'the mirror captured the streamed lines').toBeGreaterThan(0)
    })

    await test.step('unwatched run: no tabs anywhere', async () => {
      for (const context of open.splice(0)) await context.close().catch(() => {})
      await resetOwnership(request)
    })

    const unwatchedExec = await startTrackedRun(request, testId, envId)
    expect(await pollExecutionTerminal(request, unwatchedExec)).toBe('passed')

    const watchedHistory = await fetchHistory(request, watchedExec)
    const unwatchedHistory = await fetchHistory(request, unwatchedExec)

    await test.step('history payloads match apart from ids and timestamps', async () => {
      expect(watchedHistory.status).toBe(unwatchedHistory.status)
      expect(watchedHistory.block_states).toEqual(unwatchedHistory.block_states)
      expect(watchedHistory.variables).toEqual(unwatchedHistory.variables)
      expect(comparableLogs(watchedHistory.logs)).toEqual(comparableLogs(unwatchedHistory.logs))
      expect(watchedHistory.environment_name).toBe(unwatchedHistory.environment_name)
    })

    await test.step('exported report log rows match one-for-one', async () => {
      const watchedReport = await generateJsonReport(request, watchedExec)
      const unwatchedReport = await generateJsonReport(request, unwatchedExec)

      const rows = (report: Record<string, any>) =>
        ((report.logs ?? []) as Array<Record<string, unknown>>).map((entry) => [
          ((entry.level as string) ?? '').toUpperCase(),
          (entry.source as string) ?? '',
          normalizeMessage((entry.message as string) ?? ''),
        ])
      const watchedRows = rows(watchedReport)
      const unwatchedRows = rows(unwatchedReport)
      expect(watchedRows.length, 'report log rows exist').toBeGreaterThan(0)
      expect(watchedRows).toEqual(unwatchedRows)

      // Timestamps and durations legitimately differ between the two runs;
      // parity is on statuses, counts, and the ordered block outcomes.
      expect(watchedReport.summary?.status).toEqual(unwatchedReport.summary?.status)
      expect(watchedReport.summary?.counts).toEqual(unwatchedReport.summary?.counts)
      const blockStatuses = (report: Record<string, any>) =>
        ((report.timeline?.blocks ?? []) as Array<Record<string, unknown>>).map((row) => [
          row.order,
          row.block_path,
          row.status,
        ])
      expect(blockStatuses(watchedReport)).toEqual(blockStatuses(unwatchedReport))
    })

    await test.step('the mirror showed exactly what history repaints', async () => {
      // The console's source cell is a fixed-width display column (colons
      // spaced, long names ellipsed), so parity is on level and message -
      // the source values themselves are compared run-to-run above.
      const persisted = watchedHistory.logs.map((entry) => ({
        level: (entry.level ?? '').toUpperCase(),
        message: normalizeMessage(entry.message ?? ''),
      }))
      expect(mirroredLive.map(({ level, message }) => ({ level, message }))).toEqual(persisted)
    })

    await test.step('the reflected environment equals the history readout', async () => {
      const context = await browser.newContext({ baseURL: FRONTEND_URL })
      open.push(context)
      const page = await context.newPage()
      await page.goto(`/executions/history/${watchedExec}`)
      await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible({ timeout: 30_000 })
      const readout = page.locator('[data-testid="environment-selector"]')
      await expect(readout).toBeDisabled()
      await expect(readout).toContainText(E2E_ENV_NAME)
    })
  })
})
