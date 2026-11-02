/**
 * Live Workbench redirects to history when session recovery
 * finds a terminal tracked session.
 *
 * 1. A test-type execution that completes before the user visits
 *    /workbench: session recovery's TERMINAL_STATUSES check hits,
 *    container fires `trackedTerminalHandler`, which navigates to
 *    /executions/<execId>; ExecutionDetailPage's test-type guard then
 *    redirects to /executions/history/<execId>. End-user URL:
 *    /executions/history/<execId>.
 * 2. Same flow but terminal status is `skipped` (halt-with-skip
 *    fixture). The TERMINAL_WORKBENCH_STATUSES set in
 *    use-test-lifecycle.ts includes 'skipped' so the Live Workbench
 *    must skip loading the recovered test and the redirect must still
 *    fire.
 *
 * Drives the backend end-to-end via /executions, polls to terminal, then
 * mounts the frontend and asserts the final URL.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

const HISTORY_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  'historical-test-canvas',
  'fixture.json',
)

function loadPassingFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(HISTORY_FIXTURE_PATH, 'utf-8')
  return JSON.parse(raw)
}

/**
 * Tiny halt-with-skip workflow: a single Halt control with
 * scope=test, status=skipped so the tracked run finishes with
 * status=skipped. Kept inline instead of as a fixture file so the test
 * folder stays minimal.
 */
function buildHaltSkipFixture(): Record<string, unknown> {
  // `_find_entry_points` (backend/.../workbench/graph.py:49) only returns
  // nodes whose incoming edge starts at the implicit `start-node`. Without
  // that edge the workflow has zero executable entry points, the engine
  // exits with no transitions, and `_broadcast_final_status` defaults the
  // session to `passed`. We explicitly wire `start-node -> halt-skip` so
  // the halt actually runs and drives the session to `skipped`.
  return {
    name: `Halt Skip ${Date.now()}`,
    version: '1.0.0',
    description: 'Halt with status=skipped to exercise the terminal-redirect path.',
    workflow: {
      nodes: [
        {
          id: 'halt-skip',
          type: 'workflowNode',
          position: { x: 400, y: 100 },
          data: {
            label: 'Halt',
            elementType: 'halt',
            nodeType: 'control',
            category: 'flow',
            version: '1.0.0',
            description: 'Halt (skip)',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                scope: 'test',
                status: 'skipped',
                message: 'e2e-halt-skip',
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [
        {
          id: 'e-start-halt',
          source: 'start-node',
          target: 'halt-skip',
          type: 'default',
        },
      ],
    },
  }
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

async function importTest(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(`${BASE}/tests`, { data: payload })
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
  return data.id as string
}

async function pollUntilTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 20_000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    const data = (body.data ?? body) as Record<string, unknown>
    const status = data.status as string
    if (['passed', 'failed', 'stopped', 'skipped'].includes(status)) {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} did not reach terminal state within ${timeoutMs}ms`)
}

async function assertWorkbenchRedirectsToHistory(page: Page, executionId: string): Promise<void> {
  await page.goto('/workbench')
  // The redirect chain is: /workbench (session recovery fires terminal
  // handler) -> /executions/<execId> (detail page's test-type guard) ->
  // /executions/history/<execId>. Assert the final URL.
  await expect(page, 'Workbench redirects fast-completing tracked test to its history canvas')
    .toHaveURL(new RegExp(`/executions/history/${executionId}$`), { timeout: 15_000 })
  await expect(page.locator('[data-testid="workbench-page"]')).toBeVisible()
  await expect(page.locator('[data-testid="workbench-page"]')).toHaveAttribute('data-mode', 'history')
}

test.describe('tracked-session terminal redirect from /workbench', () => {
  test('fast-completing passed run redirects to history', async ({ page, request }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, {
      ...loadPassingFixture(),
      name: `Terminal Redirect Passed ${Date.now()}`,
    })
    const executionId = await startExecution(request, testId, environmentId)
    const terminal = await pollUntilTerminal(request, executionId)
    expect(['passed', 'failed', 'stopped']).toContain(terminal)

    await assertWorkbenchRedirectsToHistory(page, executionId)
  })

  test('halt-with-skip run also redirects to history', async ({ page, request }) => {
    // Asserts the full contract: halt(scope=test, status=skipped)
    // settles the execution as `skipped` AND the Workbench redirect
    // path handles that terminal status the same way as `passed`.
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)
    const testId = await importTest(request, buildHaltSkipFixture())
    const executionId = await startExecution(request, testId, environmentId)
    const terminal = await pollUntilTerminal(request, executionId)
    expect(terminal, 'halt(scope=test, status=skipped) settles the run as skipped').toBe('skipped')

    await assertWorkbenchRedirectsToHistory(page, executionId)
  })
})
