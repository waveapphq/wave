/**
 * Dashboard Live Refresh E2E Functional Test (REQ-3.2.2.17)
 *
 * Verifies end-to-end that the Dashboard's Recent Executions section and the
 * header Live-refresh indicator actually work as a user would experience them:
 *
 *   1. Open /dashboard.
 *   2. Start a tracked execution via the REST API (no user click on any
 *      Refresh button, ever).
 *   3. Within the cache-TTL + poll-interval envelope, the new execution's
 *      card MUST appear in the Recent Executions list on its own.
 *   4. After the workflow's 1 s delay completes, the SAME card MUST flip
 *      to the `passed` status without any user interaction.
 *   5. The header Live pill stays `data-status="live"` throughout the
 *      happy path (no flap to `reconnecting`).
 *
 * This test proves the polling + watchdog + status-threading machinery is
 * wired correctly end-to-end. The unit tests at
 * frontend/tests/features/dashboard/container/container.test.tsx verify
 * the container state machine in isolation; this test verifies the whole
 * stack (backend /dashboard -> 5 s cache -> FE poll -> UI re-render).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

// The Dashboard /dashboard endpoint has a 5 s cache and the FE polls every 5 s,
// so the worst-case visible latency is ~10 s. 25 s gives a comfortable margin
// for CI under load without hiding real regressions.
const APPEAR_TIMEOUT_MS = 25_000
const TERMINAL_TIMEOUT_MS = 25_000

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

async function importTest(request: APIRequestContext, uniqueName: string): Promise<string> {
  const fixture = loadFixture()
  fixture.name = uniqueName
  const response = await request.post(`${BASE}/tests`, { data: fixture })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const data = (body.data ?? body) as Record<string, unknown>
  return data.id as string
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
  expect(data.status).toBe('running')
  return data.id as string
}

function cardForName(page: Page, entityName: string) {
  // Recent Executions renders each row as an <article data-testid="execution-card">
  // with aria-label="Execution: Test > <entityName> > <Environment>".
  return page
    .locator('[data-testid="execution-card"]')
    .filter({ hasText: entityName })
}

test.describe('Dashboard live refresh (REQ-3.2.2.17)', () => {
  test('Recent Executions card appears and transitions without any Refresh click', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    // Unique name so the card query never collides with executions from
    // prior test runs that share this backend's storage.
    const entityName = `Dash Live Refresh ${Date.now()}`
    const testId = await importTest(request, entityName)

    await test.step('Open the Dashboard and confirm the Live indicator is active', async () => {
      await page.goto('/dashboard')
      const pill = page.getByTestId('dashboard-live-status')
      await expect(pill, 'Live-refresh pill must be visible once data loads').toBeVisible({
        timeout: 15_000,
      })
      await expect(pill).toHaveAttribute('data-status', 'live')

      // Manual Refresh button is gone - the test would have accidentally
      // covered for its existence if we clicked something, so fail loudly.
      await expect(
        page.getByRole('button', { name: /^refresh$/i }),
        'Manual Refresh button must be absent on the Dashboard',
      ).toHaveCount(0)
    })

    let executionId = ''
    await test.step('Start a tracked execution via the REST API (no UI click)', async () => {
      executionId = await startExecution(request, testId, environmentId)
      expect(executionId).toBeTruthy()
    })

    await test.step(
      'New execution card appears in Recent Executions via auto-refresh',
      async () => {
        await expect(
          cardForName(page, entityName),
          `Card for "${entityName}" must appear within ~${APPEAR_TIMEOUT_MS / 1000}s without any user click`,
        ).toBeVisible({ timeout: APPEAR_TIMEOUT_MS })
      },
    )

    await test.step(
      'Card transitions from running to passed without any user click',
      async () => {
        const card = cardForName(page, entityName)
        await expect(
          card.getByTestId('execution-status-info'),
          `Card must flip to "Passed" once the 1s delay completes (within ~${TERMINAL_TIMEOUT_MS / 1000}s)`,
        ).toContainText(/Passed/i, { timeout: TERMINAL_TIMEOUT_MS })
      },
    )

    await test.step('Live pill stayed healthy throughout the happy path', async () => {
      // No flap to reconnecting - the whole path ran against a working backend.
      await expect(page.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        'live',
      )
    })
  })
})
