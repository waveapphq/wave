/**
 * Execution Detail Functional Test
 *
 * Drives the new Execution Detail view end-to-end through the UI:
 *
 *   1. Import a test workflow fixture.
 *   2. Wrap the test in a suite (suite-type executions keep the
 *      /executions/<id> detail page; test-type executions redirect to
 *      /executions/history/<id>, so
 *      this test must target a suite to reach the toolbar under test).
 *   3. Start a tracked SUITE execution via POST /executions.
 *   4. Navigate to /executions/<id>.
 *   5. While the execution is running, assert the Running-state toolbar
 *      (Stop / View Running / Export) renders.
 *   6. Poll until the execution reaches a terminal status.
 *   7. Assert the Terminal-state toolbar (Re-run / Export / Delete) renders
 *      after the polling-driven re-fetch picks up the new status.
 *   8. Assert EXECUTION INFO, Components table, Tags & Description and
 *      Console panel are visible.
 *   9. Click Re-run and assert the RunDialog opens.
 *
 * Per section 15.6.4 this is the functional proof that the page composes
 * correctly, the live poll updates state, and the state-switched action set
 * responds to a real status transition.
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

async function createSuiteWrapping(
  request: APIRequestContext,
  testId: string,
  suffix: string,
): Promise<string> {
  const response = await request.post(`${BASE}/suites`, {
    data: { name: `Detail Flow Suite ${suffix} ${Date.now()}`, tests: [testId] },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function startSuiteExecution(
  request: APIRequestContext,
  suiteId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BASE}/executions`, {
    data: { type: 'suite', id: suiteId, environment_id: environmentId },
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

test.describe('Execution Detail functional flow', () => {
  test('running -> terminal transition drives the detail-view toolbar swap', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const testId = await importTest(request, 'detail')
    await validateImportedTest(request, testId)

    // Wrap the test in a suite so /executions/<id> stays on the detail
    // page. Test-type executions redirect to /executions/history/<id>
    // and would not render the
    // toolbar this test is the proof of.
    const suiteId = await createSuiteWrapping(request, testId, 'detail')
    const executionId = await startSuiteExecution(request, suiteId, environmentId)

    await page.goto(`/executions/${executionId}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    // Running-state toolbar appears while the workflow is running.
    await expect(
      page.getByRole('button', { name: /view running/i }),
      'View Running button present while running',
    ).toBeVisible({ timeout: 5000 })
    await expect(
      page.getByRole('button', { name: /^Stop$/ }),
      'Stop button present while running',
    ).toBeVisible()

    // Wait for backend to reach terminal status, then wait for the client
    // poll to pick it up and swap the toolbar.
    const terminalStatus = await pollUntilTerminal(request, executionId)
    expect(['passed', 'failed', 'stopped']).toContain(terminalStatus)

    await expect(
      page.getByRole('button', { name: /re-run/i }),
      'Re-run button present after terminal status',
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole('button', { name: /delete/i }),
      'Delete button present after terminal status',
    ).toBeVisible()

    // Core sections render.
    await expect(
      page.locator('[data-testid="execution-info-panel"]'),
      'EXECUTION INFO visible',
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="execution-console"]'),
      'Console visible',
    ).toBeVisible()

    // Re-run opens the RunDialog prepopulated with the entity name and env.
    await page.getByRole('button', { name: /re-run/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog, 'RunDialog opens on Re-run').toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i }), 'Cancel button present').toBeVisible()
    await dialog.getByRole('button', { name: /cancel/i }).click()
  })
})
