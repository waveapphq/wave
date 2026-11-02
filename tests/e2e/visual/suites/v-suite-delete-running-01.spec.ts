/**
 * V-SUITE-DELETE-RUNNING-01: Suite delete blocked by running execution
 *
 * REQ: REQ-5.2.1.36, REQ-5.2.4.6
 * Surfaces: /suites list page row Delete action AND /suites/{id} detail
 *           page header Delete button.
 *
 * Pass Criteria:
 *   1. Initiating Delete on either entry point against a suite whose
 *      entity has a tracked execution in `running` (or `paused`) status
 *      surfaces the destructive toast titled "Cannot delete suite" with
 *      the blocking execution id and a "View execution" action.
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
    description: 'Delay-based test body kept inside a suite to keep a tracked suite execution running while a delete is attempted.',
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
    data: { name, description: 'V-SUITE-DELETE-RUNNING-01 fixture', tests: testIds },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
}

async function startSuiteTrackedExecution(
  request: APIRequestContext,
  suiteId: string,
  environmentId: string,
): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'suite', id: suiteId, environment_id: environmentId },
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

async function waitForSuitesPageLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="suites-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="suites-table"] tbody tr', { state: 'visible' })
}

async function waitForSuiteDetailLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
}

async function clickDeleteInListDialog(page: import('@playwright/test').Page): Promise<void> {
  const dialog = page.locator('[data-testid="delete-confirmation-dialog"]')
  await expect(dialog, 'Confirmation dialog should appear for delete').toBeVisible({
    timeout: 5000,
  })
  await dialog.locator('[data-testid="delete-confirm-btn"]').click()
}

async function expectDestructiveToast(
  page: import('@playwright/test').Page,
  executionId: string,
) {
  const toast = page
    .locator('[data-toast]')
    .filter({ has: page.locator('[data-toast-icon="error"]') })
    .filter({ hasText: 'Cannot delete suite' })
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
  return toast
}

async function dismissDestructiveToasts(page: import('@playwright/test').Page) {
  await page
    .locator('[data-toast]')
    .filter({ hasText: 'Cannot delete suite' })
    .getByLabel('Dismiss notification')
    .first()
    .click({ trial: false })
    .catch(() => undefined)
}

test.describe('V-SUITE-DELETE-RUNNING-01: Suite delete blocked by running execution', () => {
  test('suite list row Delete blocked by running suite execution; succeeds after stop', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const suiteName = `V-SUITE-DEL-RUN-LIST ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const testId = await importTest(request, `${suiteName} body`)
    const suiteId = await createSuite(request, suiteName, [testId])
    const executionId = await startSuiteTrackedExecution(request, suiteId, environmentId)

    // Other fixture tests on this worker may have seeded 30+ suites. The
    // /suites list paginates at 25 per page by name, which can push the
    // unique suite name onto page 2. Using ?search=<name> filters down to
    // just our row so the spec stays deterministic.
    await page.goto(`/suites?search=${encodeURIComponent(suiteName)}`)
    await waitForSuitesPageLoad(page)

    const suiteRow = page
      .locator('[data-testid="suites-table"] tbody tr')
      .filter({ hasText: suiteName })
      .first()
    await expect(suiteRow, `Suite row "${suiteName}" must be visible`).toBeVisible()

    await test.step('List row Delete while running surfaces destructive toast', async () => {
      await suiteRow.locator('[data-testid="row-actions-menu"]').click()
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await dialog.locator('button').filter({ hasText: /^Delete$/i }).last().click()

      await expectDestructiveToast(page, executionId)

      await expect(
        page.locator('[data-testid="suites-table"] tbody tr').filter({ hasText: suiteName }),
        'Suite row must still exist after the blocked delete',
      ).toBeVisible()
    })

    await test.step('After stopping the execution, retrying from the list succeeds silently', async () => {
      const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(stopResp.ok()).toBeTruthy()
      await pollUntilTerminal(request, executionId)

      await dismissDestructiveToasts(page)

      const refreshedRow = page
        .locator('[data-testid="suites-table"] tbody tr')
        .filter({ hasText: suiteName })
        .first()
      await refreshedRow.locator('[data-testid="row-actions-menu"]').click()
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await dialog.locator('button').filter({ hasText: /^Delete$/i }).last().click()

      await expect(
        page.locator('[data-testid="suites-table"] tbody tr').filter({ hasText: suiteName }),
        'Suite row must disappear after silent delete',
      ).toHaveCount(0, { timeout: 5000 })

      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Cannot delete suite' }),
        'No "Cannot delete suite" toast should appear on the silent delete',
      ).toHaveCount(0)

      const getResp = await request.get(`${BACKEND_URL}/suites/${suiteId}`)
      expect(getResp.status(), 'GET /suites/{id} returns 404 after delete').toBe(404)
    })
  })

  test('suite detail header Delete blocked by running suite execution; succeeds after stop', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const suiteName = `V-SUITE-DEL-RUN-DETAIL ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const testId = await importTest(request, `${suiteName} body`)
    const suiteId = await createSuite(request, suiteName, [testId])
    const executionId = await startSuiteTrackedExecution(request, suiteId, environmentId)

    await page.goto(`/suites/${suiteId}`)
    await waitForSuiteDetailLoad(page)

    await test.step('Header Delete while running surfaces destructive toast', async () => {
      await page.locator('[data-testid="suite-delete-btn"]').click()
      await clickDeleteInListDialog(page)

      await expectDestructiveToast(page, executionId)

      // Detail page must remain on /suites/{id} - the destructive toast
      // closes the dialog but does not navigate away.
      await expect(page).toHaveURL(new RegExp(`/suites/${suiteId}`))
      await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible()
    })

    await test.step('After stopping the execution, retrying from the detail header succeeds silently', async () => {
      const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(stopResp.ok()).toBeTruthy()
      await pollUntilTerminal(request, executionId)

      await dismissDestructiveToasts(page)

      await page.locator('[data-testid="suite-delete-btn"]').click()
      await clickDeleteInListDialog(page)

      // The detail page navigates back to /suites on success.
      await page.waitForURL(/\/suites$/, { timeout: 5000 })

      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Cannot delete suite' }),
        'No "Cannot delete suite" toast should appear on the silent delete',
      ).toHaveCount(0)

      const getResp = await request.get(`${BACKEND_URL}/suites/${suiteId}`)
      expect(getResp.status(), 'GET /suites/{id} returns 404 after delete').toBe(404)
    })
  })
})
