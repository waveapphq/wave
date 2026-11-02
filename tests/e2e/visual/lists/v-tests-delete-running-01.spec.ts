/**
 * V-TESTS-DELETE-RUNNING-01: Tests list - delete blocked by running execution
 *
 * REQ: REQ-5.2.1.35, REQ-5.2.4.6
 * Surface: /tests list page row Delete action.
 *
 * Pass Criteria:
 *   1. Initiating Delete on a test row whose entity has a tracked execution
 *      in `running` (or `paused`) status surfaces the destructive toast
 *      with title "Cannot delete test" and a body that names the blocking
 *      execution id and tells the user to stop it first.
 *   2. The toast carries a "View execution" action that points at
 *      /executions/<id> for the blocking execution.
 *   3. Stopping the execution and retrying the same delete succeeds
 *      silently - no toast, the row disappears, the entity is gone.
 *
 * The toast component itself is exercised by V-TOAST-* visuals; this spec
 * only proves the 409-driven destructive message renders with the expected
 * content + action and that the success path stays silent.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

const TOAST_TIMEOUT_MS = 10_000
const RUNNING_DELAY_MS = 3000

function buildDelayTestFixture(name: string): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: 'Delay-based test used to keep a tracked execution running while a delete is attempted.',
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

async function waitForTestsPageLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', {
    state: 'attached',
  })
  await page.waitForSelector('[data-testid="test-row"]', { state: 'visible' })
}

async function openRowActionMenu(
  page: import('@playwright/test').Page,
  rowName: string,
): Promise<void> {
  const row = page.locator('[data-testid="test-row"]').filter({ hasText: rowName }).first()
  await expect(row, `Test row "${rowName}" must be visible`).toBeVisible()
  await row.locator('[data-testid="action-menu-trigger"]').click()
}

async function clickDeleteInDialog(page: import('@playwright/test').Page): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog, 'Confirmation dialog should appear for delete').toBeVisible({
    timeout: 5000,
  })
  await dialog.locator('button').filter({ hasText: /^Delete$/i }).last().click()
}

test.describe('V-TESTS-DELETE-RUNNING-01: Tests list delete blocked by running execution', () => {
  test('delete a test with a running execution surfaces destructive toast and silently succeeds after stop', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const testName = `V-TESTS-DEL-RUN ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const testId = await importTest(request, testName)
    const executionId = await startTrackedExecution(request, testId, environmentId)

    // Other fixture tests on this worker may have left dozens of seeded
    // tests in the DB. The /tests list paginates at 25 per page sorted by
    // name ascending, which would push the unique test name onto page 2 in
    // most workers. Using ?search=<name> filters down to just our row so
    // the spec stays deterministic regardless of leftover seed data.
    await page.goto(`/tests?search=${encodeURIComponent(testName)}`)
    await waitForTestsPageLoad(page)

    await test.step('Initiating delete while execution is running surfaces the destructive toast', async () => {
      await openRowActionMenu(page, testName)
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      await clickDeleteInDialog(page)

      const toast = page
        .locator('[data-toast]')
        .filter({ has: page.locator('[data-toast-icon="error"]') })
        .filter({ hasText: 'Cannot delete test' })

      await expect(toast.first(), 'Destructive toast must be visible').toBeVisible({
        timeout: TOAST_TIMEOUT_MS,
      })
      await expect(
        toast.first(),
        'Toast body must name the blocking execution id and ask the user to stop it',
      ).toContainText(`Execution ${executionId} is still running. Stop it and try again.`)

      const viewAction = toast.getByRole('button', { name: /View execution/i })
      await expect(viewAction, 'Toast carries a "View execution" action').toBeVisible()

      // Test is still present in the list - the 409 short-circuited the delete.
      await expect(
        page.locator('[data-testid="test-row"]').filter({ hasText: testName }).first(),
        'Test row must still exist after the blocked delete',
      ).toBeVisible()
    })

    await test.step('After stopping the execution, retrying the delete succeeds silently', async () => {
      const stopResp = await request.put(`${BACKEND_URL}/executions/${executionId}/stop`)
      expect(
        stopResp.ok(),
        `PUT /executions/${executionId}/stop failed: ${stopResp.status()}`,
      ).toBeTruthy()
      await pollUntilTerminal(request, executionId)

      // Dismiss the prior destructive toast so the second attempt isn't
      // racing the same notification reappearing.
      await page
        .locator('[data-toast]')
        .filter({ hasText: 'Cannot delete test' })
        .getByLabel('Dismiss notification')
        .first()
        .click({ trial: false })
        .catch(() => undefined)

      await openRowActionMenu(page, testName)
      await page.getByRole('menuitem', { name: /Delete/i }).click()
      await clickDeleteInDialog(page)

      // Row disappears from the list - silent success, no second toast.
      await expect(
        page.locator('[data-testid="test-row"]').filter({ hasText: testName }),
        'Test row must disappear after the silent delete',
      ).toHaveCount(0, { timeout: 5000 })

      await expect(
        page.locator('[data-toast]').filter({ hasText: 'Cannot delete test' }),
        'No "Cannot delete test" toast should appear on the silent delete',
      ).toHaveCount(0)

      const getResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(getResp.status(), 'GET /tests/{id} returns 404 after delete').toBe(404)
    })
  })
})
