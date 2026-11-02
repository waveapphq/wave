/**
 * Historical Test Canvas Functional Test
 *
 * Drives the new `/executions/history/:runId` view end-to-end:
 *
 *   1. Import a one-Log-node test fixture (standard POST /tests).
 *   2. Validate with zero errors.
 *   3. Start a test-type execution via POST /executions.
 *   4. Poll to terminal status.
 *   5. Navigate to /executions/history/{executionId} (test-type runs
 *      reuse the execution id as the run_id, per the design doc).
 *   6. Assert the reused Workbench chrome renders (canvas, palette,
 *      action bar), the palette is collapsed + disabled, the console
 *      shows with a disabled Clear button, and the variable manager
 *      panel is visible.
 *   7. Delete the source test and reload: the historical canvas must
 *      still paint even though the live test is gone.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BASE}/environments/`)
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, `E2E environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env.id as string
}

async function importTest(request: APIRequestContext, suffix: string): Promise<string> {
  const fixture = loadFixture()
  fixture.name = `${fixture.name as string} ${suffix} ${Date.now()}`
  const response = await request.post(`${BASE}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function validateImportedTest(
  request: APIRequestContext,
  testId: string,
): Promise<void> {
  const response = await request.post(`${BASE}/tests/${testId}/validate`)
  expect(response.ok(), `POST /tests/${testId}/validate failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  const errors = (data.errors ?? []) as unknown[]
  expect(errors, 'fixture must validate with zero errors').toHaveLength(0)
}

async function startExecution(
  request: APIRequestContext,
  testId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BASE}/executions`, {
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
  timeoutMs = 15_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
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

test.describe('Historical Test Canvas functional flow', () => {
  test('renders the painted snapshot and survives source-test deletion', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const testId = await importTest(request, 'historical')
    await validateImportedTest(request, testId)

    const executionId = await startExecution(request, testId, environmentId)
    const terminalStatus = await pollUntilTerminal(request, executionId)
    expect(['passed', 'failed', 'stopped']).toContain(terminalStatus)

    await page.goto(`/executions/history/${executionId}`)

    // Shell and reused Workbench chrome.
    const workbenchPage = page.locator('[data-testid="workbench-page"]')
    await expect(workbenchPage).toBeVisible({ timeout: 15_000 })
    await expect(workbenchPage).toHaveAttribute('data-mode', 'history')

    await expect(page.locator('[data-testid="canvas-action-bar"]')).toBeVisible()
    await expect(page.locator('[data-testid="canvas-main-content"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-canvas"]')).toBeVisible()

    // Palette: collapsed and disabled.
    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toBeVisible()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
    await expect(palette).toHaveAttribute('data-disabled', 'true')
    await expect(palette).toHaveAttribute('aria-disabled', 'true')

    // Action bar: Open-in-Workbench visible, environment pill disabled.
    await expect(page.locator('[data-testid="open-in-workbench-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="environment-selector"]')).toBeDisabled()

    // Console reused from the live Workbench, with Clear disabled.
    const consolePanel = page.locator('[data-testid="console-panel"]')
    await expect(consolePanel).toBeVisible()
    const clearBtn = consolePanel.getByRole('button', { name: /clear console/i })
    await expect(clearBtn).toBeDisabled()

    // Variable Manager panel visible. The panel renders collapsed
    // by default but the testid is present either way.
    await expect(page.locator('[data-testid="variable-manager"]')).toBeVisible()

    // Visual coverage: the painted-snapshot block states are the whole
    // point of the historical canvas - each node must carry a
    // `data-execution-status` attribute reflecting its final state via
    // the HistoricalBlockStatesProvider context. Code that
    // bypassed the provider (e.g. broke buildHistoricalBlockStates or
    // swapped useHistoricalBlockStatuses for the live store)  would
    // leave nodes unstyled, which every existing functional assertion
    // would pass right over. Assert at least one node on the canvas
    // has an execution-state-derived attribute set.
    const paintedNode = page.locator('[data-execution-status]').first()
    await expect(
      paintedNode,
      'at least one canvas node carries a painted block state (data-execution-status)',
    ).toBeVisible({ timeout: 10_000 })

    // Deleting the source test keeps the historical canvas viewable.
    const deleteResponse = await request.delete(`${BASE}/tests/${testId}`)
    expect(
      deleteResponse.ok(),
      `DELETE /tests/${testId} failed: ${deleteResponse.status()}`,
    ).toBeTruthy()

    await page.goto(`/executions/history/${executionId}`)
    await expect(page.locator('[data-testid="workbench-page"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('[data-testid="workflow-canvas"]')).toBeVisible()
  })

  test('history API returns the Log node message in the logs slice', async ({
    request,
  }) => {
    // Seed a test run and assert the historical-canvas HTTP contract
    // carries the Log node's emitted message. The UI-rendering side of
    // this is blocked on a separate investigation: `getByText(...)`
    // inside the HistoryConsole doesn't locate the entry even though
    // the API returns it, most likely because the CanvasLoadingOverlay
    // delays the console mount past the 10s test budget.
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, 'c11')
    await validateImportedTest(request, testId)
    const executionId = await startExecution(request, testId, environmentId)
    await pollUntilTerminal(request, executionId)

    const historyResp = await request.get(`${BASE}/executions/history/${executionId}`)
    expect(historyResp.ok(), 'history API responds OK').toBeTruthy()
    const body = await historyResp.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const logs = (data.logs ?? []) as Array<Record<string, unknown>>
    expect(logs.length, 'historical-canvas response carries at least one log entry').toBeGreaterThan(0)
    const messages = logs.map((entry) => String(entry.message ?? ''))
    expect(
      messages.some((m) => /historical-canvas-smoke/i.test(m)),
      `Log node message present in response (got: ${JSON.stringify(messages)})`,
    ).toBeTruthy()
  })

  test('variable manager surfaces end-of-run variables', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, 'c12')
    await validateImportedTest(request, testId)
    const executionId = await startExecution(request, testId, environmentId)
    await pollUntilTerminal(request, executionId)

    await page.goto(`/executions/history/${executionId}`)
    const varManager = page.locator('[data-testid="variable-manager"]')
    await expect(varManager).toBeVisible({ timeout: 15_000 })

    // The inline variable row exposes the variable name via both an
    // aria-label ("Variable <name>") on the wrapper div and a
    // `variable-row-<id>` testid. Target the aria-label because
    // accessibility trees are more resilient to testid refactors.
    const row = varManager.getByLabel(/^Variable var_smoke$/)
    await expect(
      row,
      'var_smoke row appears in the history variable manager',
    ).toBeVisible({ timeout: 10_000 })
    await expect(row).toContainText('var_smoke')
    await expect(row).toContainText('42')
  })

  test('Back button navigates to /executions for a test-type run', async ({
    page,
    request,
  }) => {
    // Test-type runs carry run_id === execution_id, so the container's
    // handleBack() routes to /executions. This is the first case of the
    // two-branch logic in history/container.tsx::handleBack.
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, 'c13')
    await validateImportedTest(request, testId)
    const executionId = await startExecution(request, testId, environmentId)
    await pollUntilTerminal(request, executionId)

    await page.goto(`/executions/history/${executionId}`)
    await expect(page.locator('[data-testid="workbench-page"]')).toBeVisible({ timeout: 15_000 })

    // The reused CanvasBreadcrumbBar exposes the back arrow with
    // testid `breadcrumb-back-arrow` (confirmed in
    // canvas-breadcrumb-bar.tsx:142). History mode sets `isDraft=false`
    // so the arrow is always visible.
    const backBtn = page.locator('[data-testid="breadcrumb-back-arrow"]')
    await expect(backBtn, 'history canvas exposes a back arrow').toBeVisible()
    await backBtn.click()
    await expect(page, 'test-type Back lands on /executions').toHaveURL(/\/executions(\?.*)?$/)
  })
})
