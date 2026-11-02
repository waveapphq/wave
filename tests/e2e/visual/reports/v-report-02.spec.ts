/**
 * V-REPORT-02: In-App Report Viewer (list -> generate-on-view -> document)
 * Design Decisions: RVIEW-1..13 (list columns + actions, entry points, opening
 * the viewer auto-generates the missing JSON report)
 * REQ: REQ-3.7.2.8, REQ-5.2.4.13
 *
 * Pass Criteria:
 *  1. A finished execution appears on /reports with an italic "Not
 *     generated" Report cell and the file-plus Generate row action
 *  2. The row action opens /reports/{executionId}; the generating
 *     interstitial appears (or generation completes fast) and the ready
 *     document renders the Summary, Timeline, Errors, and Logs sections
 *  3. Timeline renders the blocks variant: a Block table with one row per
 *     canvas node (6), the nested row carrying the muted "Viewer_Loop /"
 *     path prefix, and a chart bar per row; the ERROR log entry surfaces
 *     as an error card
 *  4. Logs level filter defaults to INFO (DEBUG entry absent); switching
 *     to DEBUG shows the DEBUG entry and the live "N of M entries" count
 *     updates (REQ-3.7.2.8)
 *  5. Back on /reports the row reads "Generated" with the eye View action
 *  6. The historical canvas action-bar Report button (the test-type
 *     execution detail surface) navigates to the viewer, which loads the
 *     existing report without regenerating
 *  7. Download JSON triggers a download event with a .json filename
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'

const GENERATION_TIMEOUT_MS = 30_000

function loadFixture(): Record<string, any> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/reports/v-report-02/fixture.json'),
    'utf-8',
  )
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
  expect(
    response.ok(),
    `POST /executions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
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
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function gotoReportsListRow(page: Page, testName: string) {
  await page.goto(`/reports?search=${encodeURIComponent(testName)}`)
  await page.waitForSelector('[data-testid="reports-page"]', { state: 'visible' })
  const row = page.locator('[data-testid="report-row"]').filter({ hasText: testName }).first()
  await expect(row, `Reports row for "${testName}" must be visible`).toBeVisible()
  return row
}

test.describe('V-REPORT-02: In-app report viewer', () => {
  test('list -> generate-on-view -> document -> level filter -> entry point -> download', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const { id: testId, name: testName } = await importFixture(request)

    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, 'fixture must pass validation with zero errors').toHaveLength(0)

    const executionId = await startTrackedExecution(request, testId, environmentId)
    const finalStatus = await pollUntilTerminal(request, executionId)
    expect(finalStatus, 'seeded execution must pass').toBe('passed')

    await test.step('1. Reports list shows the finished execution as "Not generated"', async () => {
      const row = await gotoReportsListRow(page, testName)
      const reportCell = row.locator('[data-testid="report-cell"]')
      await expect(reportCell, 'Report cell reads "Not generated"').toContainText('Not generated')
      // Shared entity-type badge: the Reports list Type cell is a colored
      // chip carrying the entity icon - it must NOT be plain text.
      const typeChip = row.locator('[data-testid="report-type"]')
      await expect(typeChip).toContainText('Test')
      await expect(typeChip.locator('svg'), 'Reports Type cell is a chip with an icon').toBeVisible()
      await expect(
        row.locator('[data-testid="row-action-generate"]'),
        'Generate row action (file-plus) is present',
      ).toBeVisible()
      await expect(
        row.locator('[data-testid="row-action-view"]'),
        'View action must not exist before generation',
      ).toHaveCount(0)
    })

    await test.step('2. Row action opens the viewer; generation yields the ready document', async () => {
      await page
        .locator('[data-testid="report-row"]')
        .filter({ hasText: testName })
        .first()
        .locator('[data-testid="row-action-generate"]')
        .click()
      await expect(page).toHaveURL(new RegExp(`/reports/${executionId}$`))

      // Generation for a single-run test can complete faster than the
      // interstitial can be asserted - accept either state, then require
      // the ready document.
      await expect(
        page
          .getByTestId('report-generation-state')
          .or(page.getByTestId('report-summary'))
          .first(),
        'Generating interstitial or ready document must render',
      ).toBeVisible({ timeout: 10_000 })

      await expect(page.getByTestId('report-summary')).toBeVisible({
        timeout: GENERATION_TIMEOUT_MS,
      })
      // Shared entity-type badge: the viewer header chip is color-keyed to
      // the entity type (test = success green) - not the neutral gray shadcn pill.
      await expect(
        page.locator('[data-testid="report-viewer-page"] > div.border-b').getByText('Test', {
          exact: true,
        }),
        'Report viewer header entity chip is colored, not gray',
      ).toHaveClass(/text-success/)
      await expect(page.getByTestId('report-timeline')).toBeVisible()
      await expect(page.getByTestId('report-errors')).toBeVisible()
      await expect(page.getByTestId('report-logs')).toBeVisible()

      // Header carries the execution name; Block Results count cards show
      // all 6 blocks passed.
      await expect(page.getByTestId('report-viewer-page')).toContainText(testName)
      await expect(page.getByTestId('summary-count-total')).toContainText('6')
      await expect(page.getByTestId('summary-count-passed')).toContainText('6')
    })

    await test.step('3. Timeline blocks variant with bars; ERROR entry surfaces as an error card', async () => {
      const timeline = page.getByTestId('report-timeline')
      await expect(
        timeline.locator('th', { hasText: 'Block' }),
        'Timeline table header uses the blocks variant',
      ).toBeVisible()
      await expect(
        timeline.locator('[data-testid="timeline-row"]'),
        'One timeline row per canvas node',
      ).toHaveCount(6)
      await expect(
        timeline.locator('[data-testid="timeline-bar"]'),
        'One chart bar per timeline row',
      ).toHaveCount(6)
      await expect(
        timeline.locator('[data-testid="timeline-path-prefix"]').first(),
        'Nested block row carries the muted parent path prefix',
      ).toContainText('Viewer_Loop /')

      const errorCard = page.locator('[data-testid="error-card"]')
      await expect(errorCard, 'Exactly one ERROR card').toHaveCount(1)
      await expect(errorCard).toContainText('Viewer simulated error')
      await expect(errorCard).toContainText('ERROR')
    })

    await test.step('4. Logs level filter: INFO default hides DEBUG; DEBUG shows it; count updates', async () => {
      const logs = page.getByTestId('report-logs')
      await expect(
        page.getByTestId('report-logs-level'),
        'Level dropdown defaults to INFO',
      ).toContainText('INFO')
      await expect(
        logs.getByText('Viewer debug diagnostics'),
        'DEBUG entry is filtered out at INFO',
      ).toHaveCount(0)

      const countText = await page.getByTestId('report-logs-count').textContent()
      const match = /^(\d+) of (\d+) entries$/.exec(countText?.trim() ?? '')
      expect(match, `count reads "N of M entries", got "${countText}"`).toBeTruthy()
      const [, visibleAtInfo, total] = match as RegExpExecArray
      expect(
        Number(visibleAtInfo),
        'INFO threshold must hide at least the DEBUG entry',
      ).toBeLessThan(Number(total))

      await page.getByTestId('report-logs-level').click()
      await page.getByRole('option', { name: 'DEBUG' }).click()

      await expect(
        page.getByTestId('report-logs-count'),
        'At DEBUG every entry is visible and the live count tracks it',
      ).toHaveText(`${total} of ${total} entries`)

      // The virtualized list auto-scrolls to the tail; scroll back up so
      // the early DEBUG entry is rendered before asserting on it.
      await logs.hover()
      await page.mouse.wheel(0, -5000)
      await expect(
        logs.getByText('Viewer debug diagnostics').first(),
        'DEBUG entry visible after switching the threshold to DEBUG',
      ).toBeVisible()
    })

    await test.step('5. Reports list row flips to "Generated" with the View action', async () => {
      const row = await gotoReportsListRow(page, testName)
      const reportCell = row.locator('[data-testid="report-cell"]')
      await expect(reportCell, 'Report cell reads "Generated <relative> - <size>"').toContainText(
        'Generated',
      )
      await expect(
        row.locator('[data-testid="row-action-view"]'),
        'View row action (eye) is present',
      ).toBeVisible()
      await expect(
        row.locator('[data-testid="row-action-generate"]'),
        'Generate action must be gone once the JSON report exists',
      ).toHaveCount(0)
    })

    await test.step('6. Historical canvas Report button opens the existing report', async () => {
      await page.goto(`/executions/history/${executionId}`)
      await page.waitForSelector('[data-testid="workbench-page"]', { state: 'visible' })
      const reportButton = page.getByTestId('history-report-button')
      await expect(reportButton, 'Action-bar Report button is visible').toBeVisible()
      await reportButton.click()
      await expect(page).toHaveURL(new RegExp(`/reports/${executionId}$`))
      await expect(page.getByTestId('report-summary')).toBeVisible({
        timeout: GENERATION_TIMEOUT_MS,
      })
    })

    await test.step('7. Download JSON triggers a download event', async () => {
      const downloadPromise = page.waitForEvent('download')
      await page.getByTestId('download-json-btn').click()
      const download = await downloadPromise
      expect(
        download.suggestedFilename(),
        'Download JSON yields a .json filename',
      ).toMatch(/\.json$/)
    })
  })
})
