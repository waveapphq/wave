/**
 * Suite and regression banner log variants.
 *
 * The sequential driver emits `suite-banner` and `regression-banner`
 * variant entries at the start and end of a suite / regression
 * execution. Those variants drive the `.log-variant-suite-banner` and
 * `.log-variant-regression-banner` classes on the log-entry row.
 *
 * This test starts a real one-test suite via /executions (so the
 * sequential driver runs), polls to terminal, then opens the Execution
 * Detail page and asserts at least one suite-banner row appears in the
 * merged console.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadLogFixture(suffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '..', 'historical-test-canvas', 'fixture.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw) as Record<string, unknown>
  return { ...fixture, name: `Banner log ${suffix} ${Date.now()}` }
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BASE}/environments/`)
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, 'E2E env present').toBeTruthy()
  return env.id as string
}

async function postJson(
  request: APIRequestContext,
  url: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} failed: ${response.status()} ${await response.text()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body) as Record<string, unknown>
}

async function pollTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await request.get(`${BASE}/executions/${executionId}`)
    const data = (((await response.json()).data ?? (await response.json())) as Record<string, unknown>)
    const status = data.status as string
    if (['passed', 'failed', 'stopped', 'skipped'].includes(status)) return status
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Execution ${executionId} did not reach terminal within ${timeoutMs}ms`)
}

test.describe('suite-banner log variant is rendered on the Execution Detail console', () => {
  test('running a one-test suite emits and renders a suite-banner entry', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    // Import a tiny log test, wrap it in a one-test suite, execute the suite.
    const testData = await postJson(request, `${BASE}/tests`, loadLogFixture('suite-banner'))
    const testId = testData.id as string
    const suiteData = await postJson(request, `${BASE}/suites`, {
      name: `Banner suite ${Date.now()}`,
      tests: [testId],
    })
    const suiteId = suiteData.id as string

    const execResp = await postJson(request, `${BASE}/executions`, {
      type: 'suite',
      id: suiteId,
      environment_id: environmentId,
    })
    const executionId = execResp.id as string

    const terminal = await pollTerminal(request, executionId)
    expect(['passed', 'failed', 'stopped', 'skipped']).toContain(terminal)

    await page.goto(`/executions/${executionId}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    // Console panel subscribes on mount and receives the initial history
    // page. Wait for at least one log entry to render.
    const consolePanel = page.locator('[data-testid="execution-console"], [data-testid="console-panel"]').first()
    await expect(consolePanel, 'console is visible on Execution Detail').toBeVisible()

    // Banner variant rows apply the `log-variant-suite-banner` class on
    // the log-entry row. Assert at least one banner row appears.
    const bannerRow = consolePanel.locator('.log-variant-suite-banner').first()
    await expect(bannerRow, 'at least one suite-banner entry rendered').toBeVisible({
      timeout: 10_000,
    })

    // Visual coverage: the class is only half the contract; the CSS
    // rule that turns it into the blue-accented banner row is the
    // other half. A regression that removes the `.log-variant-
    // suite-banner` rule from index.css would leave the class intact
    // (functional test passes) but visually collapse the banner back
    // into a plain INFO row. Assert the computed border-left color
    // matches the design's blue-400 accent (rgb(96, 165, 250)) to
    // catch that shape of regression.
    const borderColor = await bannerRow.evaluate(
      (el) => window.getComputedStyle(el).borderLeftColor,
    )
    expect(
      borderColor,
      'suite-banner row has the design-spec blue-400 border accent',
    ).toBe('rgb(96, 165, 250)')
  })
})
