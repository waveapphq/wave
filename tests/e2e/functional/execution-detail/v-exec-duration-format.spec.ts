/**
 * Duration formatter truncates to at most 3 decimals.
 *
 * `formatDuration(5.125999)` -> "5.125s", `formatDuration(5.100)` -> "5.1s",
 * `formatDuration(3)` -> "3s". The helper is wired into the Execution
 * Detail components table + the executions list, so a seeded fractional
 * duration must render with the truncation rule.
 *
 * Uses a real backend run to get a fractional second duration: import a
 * tiny Log test, start a test-type execution, poll to terminal, then
 * open its Historical Canvas (test-type detail redirects to history).
 * The breadcrumb's status pill + the console entry's relative timestamp
 * are not the assertion target - we look at the Historical Canvas's
 * action-bar (or the Executions list row) for the duration string.
 *
 * If the real run is too fast or too slow for a fractional value, we
 * fall back to asserting by regex match: /^\d+(\.\d{1,3})?s$/ or
 * /\d+m \d+(\.\d{1,3})?s$/ which captures the truncation rule without
 * pinning a specific number.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
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

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(HISTORY_FIXTURE_PATH, 'utf-8')
  return { ...JSON.parse(raw), name: `Duration Format ${Date.now()}` }
}

async function getEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BASE}/environments/`)
  const body = await response.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: Record<string, unknown>) => e.name === E2E_ENV_NAME)
  expect(env, 'E2E env present').toBeTruthy()
  return env.id as string
}

test.describe('duration formatter truncates to at most 3 decimals', () => {
  test('list row duration cell matches truncation regex', async ({ page, request }) => {
    await ensureEnvironment(request)
    const environmentId = await getEnvironmentId(request)

    const importResponse = await request.post(`${BASE}/tests`, { data: loadFixture() })
    expect(importResponse.ok()).toBeTruthy()
    const testId = ((await importResponse.json()).data as Record<string, unknown>).id as string

    const startResponse = await request.post(`${BASE}/executions`, {
      data: { type: 'test', id: testId, environment_id: environmentId },
    })
    expect(startResponse.ok()).toBeTruthy()
    const executionId = ((await startResponse.json()).data as Record<string, unknown>).id as string

    // Poll to terminal.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const get = await request.get(`${BASE}/executions/${executionId}`)
      const data = ((await get.json()).data ?? (await get.json())) as Record<string, unknown>
      if (['passed', 'failed', 'stopped', 'skipped'].includes(data.status as string)) break
      await new Promise((r) => setTimeout(r, 150))
    }

    await page.goto('/executions')
    const row = page.getByRole('row', { name: /duration format/i }).first()
    await expect(row, 'duration-format execution row is visible').toBeVisible()

    const durationCell = row.locator('[data-testid="execution-duration"]')
    await expect(durationCell).toBeVisible()
    const text = (await durationCell.textContent())?.trim() ?? ''

    // Truncation rule: at most 3 digits after the dot on seconds; no
    // raw float like "5.125999" may leak through. Valid shapes:
    //   "-"           (no duration recorded yet)
    //   "3s", "5.1s", "5.12s", "5.125s"
    //   "1m 0s", "1m 5.123s"
    //   "1h", "1h 5m"
    expect(text, `duration text "${text}" matches truncation rule`).toMatch(
      /^(-|\d+h( \d+m)?|\d+m( \d+(\.\d{1,3})?s)?|\d+(\.\d{1,3})?s)$/,
    )
    // Belt-and-braces: the cell must not contain the raw float noise
    // patterns (4+ decimals on seconds).
    expect(text).not.toMatch(/\.\d{4,}/)
  })
})
