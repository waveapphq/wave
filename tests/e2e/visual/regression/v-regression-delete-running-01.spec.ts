/**
 * V-REGRESSION-DELETE-RUNNING-01: Regression delete blocked by running execution
 *
 * REQ: REQ-5.2.4.5, REQ-5.2.4.6
 * Surfaces: /regressions list page row Delete action AND /regressions/{id}
 *           detail page header Delete button.
 *
 * Pass Criteria:
 *   1. Initiating Delete on either entry point against a regression whose
 *      entity has a tracked execution in `running` (or `paused`) status
 *      surfaces the destructive toast titled "Cannot delete regression"
 *      with the blocking execution id and a "View execution" action.
 *   2. After stopping the execution, retrying the delete from the same
 *      entry point succeeds silently.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const TOAST_TIMEOUT_MS = 10_000
const RUNNING_DELAY_MS = 3000

function buildDelayTestFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Delay-based test body that lives inside a suite/regression to keep a tracked regression execution running while a delete is attempted.',
    workflow: {
      nodes: [
        {
          id: 'delay-only',
          type: 'workflowNode',
          position: { x: 400, y: 100 },
          data: {
            label: 'Delay',
            elementType: 'delay',
            nodeType: 'control',
            category: 'timing',
            version: '1.0.0',
            description: 'Delete-Running Delay',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { duration: RUNNING_DELAY_MS },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-node', target: 'delay-only', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
  }
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

async function importTest(
  request: APIRequestContext,
  uniqueName: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/tests`, {
    data: buildDelayTestFixture(uniqueName),
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createSuite(
  request: APIRequestContext,
  name: string,
  testIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/suites`, {
    data: { name, description: 'V-REGRESSION-DELETE-RUNNING-01 inner suite', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function createRegression(
  request: APIRequestContext,
  name: string,
  suiteIds: string[],
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/regressions`, {
    data: { name, description: 'V-REGRESSION-DELETE-RUNNING-01 fixture', suites: suiteIds },
  })
  expect(
    response.ok(),
    `POST /regressions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function startRegressionTrackedExecution(
  request: APIRequestContext,
  regressionId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'regression', id: regressionId, environment_id: environmentId },
  })
  expect(
    response.ok(),
    `POST /executions failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  expect(data.status).toBe('running')
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function waitForRegressionsPageLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="regressions-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="regressions-table"] tbody tr', { state: 'visible' })
}

async function waitForRegressionDetailLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="regression-detail-page"]', { state: 'visible' })
}

async function expectDestructiveToast(
  page: import('@playwright/test').Page,
  executionId: string,
) {
  const toast = page
    .locator('[data-toast]')
    .filter({ has: page.locator('[data-toast-icon="error"]') })
    .filter({ hasText: 'Cannot delete regression' })
  await expect(toast.first(), 'Destructive toast must be visible').toBeVisible({
    timeout: TOAST_TIMEOUT_MS,
  })
  await expect(
    toast.first(),
    'Toast body must name the blocking execution id and ask the user to stop it',
  ).toContainText(`Execution ${executionId} is still running. Stop it and try again.`)
  await expect(
    toast.getByRole('button', { name: /View execution/i }),
    'Toast carries a "View execution" action',
  ).toBeVisible()
}

async function dismissDestructiveToasts(page: import('@playwright/test').Page) {
  await page
    .locator('[data-toast]')
    .filter({ hasText: 'Cannot delete regression' })
    .getByLabel('Dismiss notification')
    .first()
    .click({ trial: false })
    .catch(() => undefined)
}

async function clickDeleteInDetailDialog(page: import('@playwright/test').Page): Promise<void> {
  const dialog = page.locator('[data-testid="delete-confirmation-dialog"]')
  await expect(dialog, 'Delete confirmation dialog should appear').toBeVisible({
    timeout: 5000,
  })
  await dialog.locator('[data-testid="confirm-delete-regression-btn"]').click()
}

test.describe('V-REGRESSION-DELETE-RUNNING-01: Regression delete blocked by running execution', () => {
  test('regression list row Delete blocked by running regression execution; succeeds after stop', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const regressionName = `V-REG-DEL-RUN-LIST ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const testId = await importTest(request, `${regressionName} body`)
    const suiteId = await createSuite(request, `${regressionName} suite`, [testId])
    const regressionId = await createRegression(request, regressionName, [suiteId])
    const executionId = await startRegressionTrackedExecution(
      request,
      regressionId,
      environmentId,
    )

    // Other fixture tests on this worker may have seeded regressions. The
    // /regressions list paginates at 25 per page by name, which can push
    // the unique regression name onto page 2. Using ?search=<name> filters
    // down to just our row so the spec stays deterministic.
    await page.goto(`/regressions?search=${encodeURIComponent(regressionName)}`)
    await waitForRegressionsPageLoad(page)

    const regressionRow = page
      .locator('[data-testid="regressions-table"] tbody tr')
      .filter({ hasText: regressionName })
      .first()
    await expect(regressionRow, `Regression row "${regressionName}" must be visible`).toBeVisible()

    await test.step('List row Delete while running surfaces destructive toast', async () => {
      await regressionRow.locator('[data-testid="row-actions-menu"]').click()
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await dialog.locator('button').filter({ hasText: /^Delete$/i }).last().click()

      await expectDestructiveToast(page, executionId)

      await expect(
        page.locator('[data-testid="regressions-table"] tbody tr').filter({ hasText: regressionName }),
        'Regression row must still exist after the blocked delete',
      ).toBeVisible()
    })

    await test.step('After stopping the execution, retrying from the list succeeds silently', async () => {
      const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(stopResp.ok()).toBeTruthy()
      await pollUntilTerminal(request, executionId)

      await dismissDestructiveToasts(page)

      const refreshedRow = page
        .locator('[data-testid="regressions-table"] tbody tr')
        .filter({ hasText: regressionName })
        .first()
      await refreshedRow.locator('[data-testid="row-actions-menu"]').click()
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await dialog.locator('button').filter({ hasText: /^Delete$/i }).last().click()

      await expect(
        page.locator('[data-testid="regressions-table"] tbody tr').filter({ hasText: regressionName }),
        'Regression row must disappear after silent delete',
      ).toHaveCount(0, { timeout: 5000 })

      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Cannot delete regression' }),
        'No "Cannot delete regression" toast should appear on the silent delete',
      ).toHaveCount(0)

      const getResp = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
      expect(getResp.status(), 'GET /regressions/{id} returns 404 after delete').toBe(404)
    })
  })

  test('regression detail header Delete blocked by running regression execution; succeeds after stop', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const regressionName = `V-REG-DEL-RUN-DETAIL ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const testId = await importTest(request, `${regressionName} body`)
    const suiteId = await createSuite(request, `${regressionName} suite`, [testId])
    const regressionId = await createRegression(request, regressionName, [suiteId])
    const executionId = await startRegressionTrackedExecution(
      request,
      regressionId,
      environmentId,
    )

    await page.goto(`/regressions/${regressionId}`)
    await waitForRegressionDetailLoad(page)

    await test.step('Header Delete while running surfaces destructive toast', async () => {
      await page.locator('[data-testid="delete-regression-btn"]').click()
      await clickDeleteInDetailDialog(page)

      await expectDestructiveToast(page, executionId)

      // Detail page stays on /regressions/{id} - destructive toast closes
      // the dialog but does not navigate away.
      await expect(page).toHaveURL(new RegExp(`/regressions/${regressionId}`))
      await expect(page.locator('[data-testid="regression-detail-page"]')).toBeVisible()
    })

    await test.step('After stopping the execution, retrying from the detail header succeeds silently', async () => {
      const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(stopResp.ok()).toBeTruthy()
      await pollUntilTerminal(request, executionId)

      await dismissDestructiveToasts(page)

      await page.locator('[data-testid="delete-regression-btn"]').click()
      await clickDeleteInDetailDialog(page)

      // Detail page navigates back to /regressions on success.
      await page.waitForURL(/\/regressions$/, { timeout: 5000 })

      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Cannot delete regression' }),
        'No "Cannot delete regression" toast should appear on the silent delete',
      ).toHaveCount(0)

      const getResp = await request.get(`${BACKEND_URL}/regressions/${regressionId}`)
      expect(getResp.status(), 'GET /regressions/{id} returns 404 after delete').toBe(404)
    })
  })
})
