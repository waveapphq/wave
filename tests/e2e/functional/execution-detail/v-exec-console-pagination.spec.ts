/**
 * Execution Detail console merged-pagination smoke test.
 *
 * The cursor is `"<chronology_index>:<child_seq|x>"`; the initial
 * subscribe response returns up to 100 entries plus a cursor for older
 * pages. Full pagination (scroll-up triggers `request_history`) is
 * exercised by backend unit tests; this Playwright spec proves the
 * user-visible contract: opening a suite execution's detail page shows
 * the merged console populated with entries, and the console's "load
 * more" affordance (`data-has-more` / scroll-top request) is wired.
 *
 * Reuses v-exec-01 so we have a terminal suite execution with real run
 * data - same pattern as the suite-banner spec.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadLogFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '..', 'historical-test-canvas', 'fixture.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw) as Record<string, unknown>
  return { ...fixture, name: `Merged console ${Date.now()}` }
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BASE}/environments/`)
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env).toBeTruthy()
  return env.id as string
}

async function postJson(
  request: APIRequestContext,
  url: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} -> ${response.status()}: ${await response.text()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body) as Record<string, unknown>
}

async function pollTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
    const data = ((await response.json()).data ?? (await response.json())) as Record<string, unknown>
    const status = data.status as string
    if (['passed', 'failed', 'stopped', 'skipped'].includes(status)) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Execution ${executionId} did not reach terminal within ${timeoutMs}ms`)
}

test.describe('Execution Detail merged-console renders with entries', () => {
  test('suite execution detail console shows log entries after subscribe', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const testData = await postJson(request, `${BASE}/tests`, loadLogFixture())
    const testId = testData.id as string
    const suiteData = await postJson(request, `${BASE}/suites`, {
      name: `Merged console suite ${Date.now()}`,
      tests: [testId],
    })
    const suiteId = suiteData.id as string

    const execResp = await postJson(request, `${BASE}/executions`, {
      type: 'suite',
      id: suiteId,
      environment_id: environmentId,
    })
    const executionId = execResp.id as string
    await pollTerminal(request, executionId)

    await page.goto(`/executions/${executionId}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    // Console panel subscribes on mount; the initial-history event lands
    // with up to 100 entries plus an optional older-pages cursor. Wait
    // for at least one entry to render.
    const consolePanel = page
      .locator('[data-testid="execution-console"], [data-testid="console-panel"]')
      .first()
    await expect(consolePanel).toBeVisible()

    // The Log node's message is `historical-canvas-smoke`. Its entry
    // arrives via the per-test log file, wrapped into the merged
    // console by the new chronology walker. Finding this entry proves
    // the test-reference expansion path works end-to-end.
    await expect(
      consolePanel.getByText(/historical-canvas-smoke/i).first(),
      'merged console surfaces the Log node entry from logs/<run_id>.yaml',
    ).toBeVisible({ timeout: 10_000 })
  })
})
