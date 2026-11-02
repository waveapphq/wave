/**
 * Run-Regression Functional Test
 *
 * Drives the "Run from regression detail" flow end-to-end through the UI:
 *
 *   1. Import three test bodies via POST /tests (shared, auth-only, checkout-only).
 *   2. Validate all three (POST /tests/{id}/validate, expect zero errors).
 *   3. Create two suites via POST /suites:
 *        - "Auth Suite": shared + auth-only
 *        - "Checkout Suite": shared + checkout-only
 *   4. Create a regression referencing both suites via POST /regressions.
 *   5. Navigate to /regressions/{id}, open the Run dialog.
 *   6. Assert the duplicate-test badge is present on both instances of the
 *      shared test, proving the duplicate map reached the UI end-to-end.
 *   7. Deselect one {suite, test} pair, submit.
 *   8. After navigation to /executions/{id}, assert the persisted record:
 *        entity_type = 'regression'; selected_tests is an array of three
 *        {suite_id, test_id} pairs (the fourth deselected); timeline has a
 *        `skipped` entry for the deselected pair; status = 'running'.
 *   9. PUT /executions/{id}/stop; confirm terminal state = 'stopped'.
 */

import { test, expect, type APIRequestContext, type Locator } from '../../helpers/playwright-fixtures'
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
  expect(errors).toHaveLength(0)
}

async function createSuite(
  request: APIRequestContext,
  label: string,
  testIds: string[],
): Promise<string> {
  const name = `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, description: 'run-regression functional suite', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createRegression(
  request: APIRequestContext,
  suiteIds: string[],
): Promise<string> {
  const name = `Runnable Regression ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const response = await request.post(`${BACKEND_URL}/regressions`, {
    data: {
      name,
      description: 'run-regression functional test',
      suites: suiteIds,
    },
  })
  expect(
    response.ok(),
    `POST /regressions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
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

async function testCheckboxInGroup(
  group: Locator,
  testName: string,
): Promise<Locator> {
  return group
    .locator('[data-testid="run-dialog-test-item"]')
    .filter({ hasText: testName })
    .getByRole('checkbox')
}

test.describe('Run from regression detail', () => {
  test('duplicate badge + subset persist + skipped pair + stop terminal', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const sharedTestId = await importTest(request, 'runreg-shared')
    const authOnlyTestId = await importTest(request, 'runreg-auth')
    const checkoutOnlyTestId = await importTest(request, 'runreg-checkout')
    await validateImportedTest(request, sharedTestId)
    await validateImportedTest(request, authOnlyTestId)
    await validateImportedTest(request, checkoutOnlyTestId)

    const authSuiteId = await createSuite(request, 'Auth Suite', [
      sharedTestId,
      authOnlyTestId,
    ])
    const checkoutSuiteId = await createSuite(request, 'Checkout Suite', [
      sharedTestId,
      checkoutOnlyTestId,
    ])
    const regressionId = await createRegression(request, [authSuiteId, checkoutSuiteId])

    await page.goto(`/regressions/${regressionId}`)
    await page.waitForSelector('[data-testid="regression-detail-page"]', {
      state: 'visible',
    })

    await page.locator('[data-testid="regression-run-btn"]').click()
    const dialog = page.locator('[data-testid="run-dialog-content"]')
    await expect(dialog).toBeVisible()

    const authGroup = dialog.locator(`[data-testid="suite-group-${authSuiteId}"]`)
    const checkoutGroup = dialog.locator(
      `[data-testid="suite-group-${checkoutSuiteId}"]`,
    )

    // Shared test lives in both groups; both instances must carry the badge.
    await expect(
      authGroup
        .locator('[data-testid="run-dialog-test-item"]')
        .filter({ hasText: 'runreg-shared' })
        .locator('[data-testid="duplicate-test-badge"]'),
      'Shared test in Auth group shows duplicate badge',
    ).toBeVisible()
    await expect(
      checkoutGroup
        .locator('[data-testid="run-dialog-test-item"]')
        .filter({ hasText: 'runreg-shared' })
        .locator('[data-testid="duplicate-test-badge"]'),
      'Shared test in Checkout group shows duplicate badge',
    ).toBeVisible()

    // Select env.
    await dialog
      .locator(`[data-testid="all-environments"] [data-env-id="${environmentId}"]`)
      .click()

    // Deselect the auth-only pair; the other three stay selected.
    const authOnlyCheckbox = await testCheckboxInGroup(authGroup, 'runreg-auth')
    await authOnlyCheckbox.click()
    await expect(
      dialog.locator('[data-testid="run-dialog-selected-count"]'),
      'Counter reflects three-of-four selected',
    ).toHaveText(/^3\/4 tests in 2 suites$/)

    await dialog.locator('[data-testid="run-dialog-run"]').click()

    await page.waitForURL(/\/executions\/[0-9a-f-]{36}/)
    const match = page.url().match(/\/executions\/([0-9a-f-]{36})/)
    expect(match).not.toBeNull()
    const executionId = match![1]

    const recordResp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(recordResp.ok()).toBeTruthy()
    const recordBody = await recordResp.json()
    const record = (recordBody.data ?? recordBody) as Record<string, unknown>

    expect(record.entity_type).toBe('regression')
    expect(record.entity_id).toBe(regressionId)
    expect(record.status, 'execution running - iteration deferred').toBe('running')

    const selectedPairs = record.selected_tests as Array<{
      suite_id: string
      test_id: string
    }>
    expect(selectedPairs, 'selected_tests has exactly three pairs').toHaveLength(3)
    const pairKeys = selectedPairs.map((p) => `${p.suite_id}:${p.test_id}`).sort()
    const expectedPairs = [
      `${authSuiteId}:${sharedTestId}`,
      `${checkoutSuiteId}:${sharedTestId}`,
      `${checkoutSuiteId}:${checkoutOnlyTestId}`,
    ].sort()
    expect(pairKeys).toEqual(expectedPairs)

    // The detail GET rolls up the per-(suite, test) timeline under the
    // regression-style `suites` array (see _enrich_regression_suites).
    const suites = ((record.suites as unknown[]) ?? []) as Array<
      Record<string, unknown>
    >
    const authSuiteRow = suites.find((s) => (s.id as string) === authSuiteId)
    expect(authSuiteRow, 'auth suite row present in record').toBeTruthy()
    const authTests = (authSuiteRow!.tests as Array<Record<string, unknown>>) ?? []
    const authOnlyRow = authTests.find((t) => (t.id as string) === authOnlyTestId)
    expect(authOnlyRow, 'auth-only row present under auth suite').toBeTruthy()
    expect(authOnlyRow!.status, 'deselected pair marked excluded').toBe('excluded')
    const sharedInAuth = authTests.find((t) => (t.id as string) === sharedTestId)
    // The sequential driver starts iterating immediately after dispatch, so
    // the shared (selected) pair may already be running under auth by the
    // time we inspect the record. What matters is that it is not excluded.
    expect(sharedInAuth!.status, 'shared pair not excluded under auth suite').not.toBe(
      'excluded',
    )

    const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
    expect(
      stopResp.ok(),
      `PUT /executions/${executionId}/stop failed: ${stopResp.status()}`,
    ).toBeTruthy()

    const terminal = await pollUntilTerminal(request, executionId)
    expect(terminal.status).toBe('stopped')
    expect(terminal.ended_at).toBeTruthy()
    expect(typeof terminal.duration).toBe('number')
  })
})
