/**
 * Run-Suite Functional Test
 *
 * Drives the "Run from suite detail" flow end-to-end through the UI:
 *
 *   1. Import two test bodies via POST /tests.
 *   2. Validate both (POST /tests/{id}/validate, expect zero errors).
 *   3. Create a suite containing both tests via POST /suites.
 *   4. Navigate to /suites/{id}, open the Run dialog from the detail header.
 *   5. Pick an environment, unselect one of the two tests, submit.
 *   6. After navigation to /executions/{id}, assert the persisted record
 *      matches the subset contract: entity_type=suite, selected_tests has
 *      exactly one id, the timeline holds a `skipped` entry for the
 *      unselected test, status=running.
 *   7. Stop the execution via PUT /executions/{id}/stop and confirm the
 *      terminal state.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

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
  fixture.name = `${fixture.name as string} ${suffix} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function validateImportedTest(
  request: APIRequestContext,
  testId: string,
): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  expect(
    response.ok(),
    `POST /tests/${testId}/validate failed: ${response.status()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  const errors = (data.errors ?? []) as unknown[]
  expect(errors, 'fixture must validate with zero errors').toHaveLength(0)
}

async function createSuite(
  request: APIRequestContext,
  testIds: string[],
): Promise<string> {
  const name = `Runnable Suite ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, description: 'run-suite functional test', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return data
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `Execution ${executionId} did not reach a terminal state within ${timeoutMs}ms`,
  )
}

test.describe('Run from suite detail', () => {
  test('submits subset, persists selected_tests + skipped timeline, stop terminal', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const selectedTestId = await importTest(request, 'runsuite-selected')
    const skippedTestId = await importTest(request, 'runsuite-skipped')
    await validateImportedTest(request, selectedTestId)
    await validateImportedTest(request, skippedTestId)

    const suiteId = await createSuite(request, [selectedTestId, skippedTestId])

    await page.goto(`/suites/${suiteId}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    await page.locator('[data-testid="suite-run-btn"]').click()
    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog).toBeVisible()

    // Select the E2E env by data-env-id.
    await dialog
      .locator(`[data-testid="all-environments"] [data-env-id="${environmentId}"]`)
      .click()

    // Deselect the "skipped" test via its label (Checkbox is aria-labeled with the name).
    await dialog.getByRole('checkbox', { name: /runsuite-skipped/ }).click()
    await expect(
      dialog.locator('[data-testid="run-dialog-selected-count"]'),
      'Subset counter reflects one-of-two selected',
    ).toHaveText('1/2')

    await dialog.locator('[data-testid="run-dialog-run"]').click()

    await page.waitForURL(/\/executions\/[0-9a-f-]{36}/)
    const match = page.url().match(/\/executions\/([0-9a-f-]{36})/)
    expect(match, 'URL carries the new execution id').not.toBeNull()
    const executionId = match![1]

    const recordResp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(recordResp.ok()).toBeTruthy()
    const recordBody = await recordResp.json()
    const record = (recordBody.data ?? recordBody) as Record<string, unknown>

    expect(record.entity_type, 'entity_type is suite').toBe('suite')
    expect(record.entity_id, 'entity_id is the suite we just created').toBe(suiteId)
    expect(record.status, 'execution is running (per-test iteration deferred)').toBe(
      'running',
    )
    expect(record.selected_tests, 'selected_tests holds only the picked test id').toEqual([
      selectedTestId,
    ])

    // The detail GET returns the timeline rolled up under `tests` for a suite
    // (see _resolve_suite_tests in the execution service). Each row exposes
    // the timeline-derived status.
    const tests = ((record.tests as unknown[]) ?? []) as Array<Record<string, unknown>>
    const skippedRow = tests.find((row) => (row.id as string) === skippedTestId)
    expect(skippedRow, 'tests row exists for the unselected test').toBeTruthy()
    expect(skippedRow!.status, 'unselected test marked excluded').toBe('excluded')
    const selectedRow = tests.find((row) => (row.id as string) === selectedTestId)
    // The sequential driver starts iterating immediately after dispatch, so
    // the selected test may already be running (or completed) by the time
    // we inspect the record. What matters is that it is not excluded.
    expect(selectedRow!.status, 'selected test is not excluded').not.toBe('excluded')

    const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
    expect(
      stopResp.ok(),
      `PUT /executions/${executionId}/stop failed: ${stopResp.status()}`,
    ).toBeTruthy()

    const terminal = await pollUntilTerminal(request, executionId)
    expect(terminal.status, 'terminal status is stopped').toBe('stopped')
    expect(terminal.ended_at, 'terminal record carries ended_at').toBeTruthy()
    expect(typeof terminal.duration).toBe('number')
  })
})
