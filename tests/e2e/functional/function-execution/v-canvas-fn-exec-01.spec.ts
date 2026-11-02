/**
 * V-CANVAS-FN-EXEC-01: Local Function inside a Test runs end-to-end
 *
 * REQ: REQ-3.2.1.1 (Function variant of normal execution; canonical
 * end-to-end contract).
 *
 * Pass Criteria:
 *   1. A Test containing a Local Function runs to completion via the
 *      workbench Run button and the workflow-status indicator settles on
 *      `passed`.
 *   2. The inner Log line emitted from inside the Function body surfaces in
 *      the console panel exactly like a top-level Log line (the executor
 *      routes plugin execution through the session-aware path).
 *   3. The Function block reports a passed execution state on the canvas
 *      (`data-execution-status="passed"` on the Function workflow node).
 *
 * Output-binding propagation to caller-scope variable is exercised by the
 * BE TDD unit tests (`backend/tests/core/functions/test_executor.py`) and
 * by the BE workbench-integration tests
 * (`backend/tests/api/test_workbench_function_runs.py`); we do not duplicate
 * those assertions here because the workbench `/status` route does not
 * surface the post-run variable map (only the BE unit tests can observe it).
 *
 * Phase: functional (serial). Drives the workbench through the browser the
 * same way v-plugin-log-execution does so we can read logs out of the
 * console panel via the DOM (the workbench REST status endpoint does not
 * expose `block_states` / `execution_logs`).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-exec-end-to-end.json'), 'utf-8'),
  )
  return { ...fixture, name: `V-CANVAS-FN-EXEC-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('V-CANVAS-FN-EXEC-01: Local Function execution end-to-end', () => {
  test('Function passes, inner Log line surfaces in console, canvas node ends passed', async ({
    page,
  }) => {
    // ----------------------------------------------------------------
    // STEP 1: seed Test + env, open in workbench
    // ----------------------------------------------------------------
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
    await ensureEnvironment(page.request)
    const seed = loadFixture()
    const createResp = await page.request.post(`${BASE}/tests`, { data: seed })
    const created = (await createResp.json()) as Record<string, unknown>
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()}`).toBeTruthy()
    const testId = ((created.data as Record<string, unknown>)?.id as string) ?? (created.id as string)
    expect(testId).toBeTruthy()

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // ----------------------------------------------------------------
    // STEP 2: pick env + Run, wait for terminal status
    // ----------------------------------------------------------------
    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()

    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
      timeout: 20_000,
    })
    await expect(statusIndicator).toHaveAttribute('data-status', /passed|success/, {
      timeout: 5_000,
    })

    // ----------------------------------------------------------------
    // STEP 3: Function canvas node reports success/passed
    // (the canvas node uses `success` for completed runs; the workflow
    // status indicator may use either string. Accept both.)
    // ----------------------------------------------------------------
    const fnNode = page.locator('[data-testid="workflow-node-fn-exec-1"]')
    await expect(fnNode).toBeVisible()
    await expect(fnNode).toHaveAttribute('data-execution-status', /passed|success/, {
      timeout: 5_000,
    })

    // ----------------------------------------------------------------
    // STEP 4: inner Log line surfaces in the console panel
    // ----------------------------------------------------------------
    const logLines = await getLogLines(page)
    const matched = logLines.some((line) => line.includes('function ran'))
    expect(matched, `inner Log line must surface in console panel; got ${JSON.stringify(logLines)}`).toBe(true)
  })
})
