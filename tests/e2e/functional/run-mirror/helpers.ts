/**
 * Shared helpers for the run-mirror functional suite: fixture import with
 * validation, holder/watcher tab setup, tracked-run REST helpers, and the
 * progressive-arrival sampler the streaming assertions ride on.
 * Self-contained per the per-dir helper convention (see watch-mode/helpers.ts).
 */

import { expect, type Page } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext, APIRequestContext } from '@playwright/test'
import { BACKEND_URL, FRONTEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import fs from 'fs'
import path from 'path'

/** Load fixture.json with a uniquified test name (names are globally unique). */
export function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

/** Import a fixture via POST /tests, assert zero validation errors, return the id. */
export async function importFixture(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)
  return testId
}

/** Resolve the shared E2E environment's id. */
export async function environmentId(request: APIRequestContext): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const env = (body.data as Array<{ id: string; name: string }>).find(
    (e) => e.name === E2E_ENV_NAME,
  )
  expect(env, `environment "${E2E_ENV_NAME}" exists`).toBeTruthy()
  return env!.id
}

/** Open a fresh tab as the editing holder with a test loaded (editTest). */
export async function openHolderWithTest(
  browser: Browser,
  testId: string,
  track: (c: BrowserContext) => void,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await stubSessionRecovery(page)
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return page
}

/** Open a fresh tab that mirrors the current holder (read-only watcher). */
export async function openWatcher(
  browser: Browser,
  track: (c: BrowserContext) => void,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await stubSessionRecovery(page)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  return page
}

/** Open a watcher tab while a run is already in flight: no session stub, so the
 *  attach path can resolve the running session on mount. */
export async function openWatcherDuringRun(
  browser: Browser,
  track: (c: BrowserContext) => void,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  return page
}

/** Drop the mount-time session stub so this tab can attach to an announced run.
 *
 * A watcher learns the run through `GET /workbench/session`; leaving the mount
 * stub in place silently disables the attach path (the banner still flips, but
 * console and block paint stay empty). Call right before the run starts. */
export async function allowRunAttach(page: Page): Promise<void> {
  await page.unroute('**/workbench/session')
}

/** Start a tracked execution over REST; returns the execution id. */
export async function startTrackedRun(
  request: APIRequestContext,
  testId: string,
  envId: string,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: envId },
  })
  expect(resp.ok(), `POST /executions failed: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()).data as { id: string }).id
}

/** Poll GET /executions/{id} until terminal; returns the terminal status. */
export async function pollExecutionTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 60_000,
): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        status = ((((await resp.json()).data ?? {}) as { status?: string }).status ?? '') as string
        return ['passed', 'failed', 'stopped', 'skipped'].includes(status)
      },
      { timeout: timeoutMs, message: `execution ${executionId} should reach a terminal state` },
    )
    .toBe(true)
  return status
}

/** Expand the console panel so its virtualized rows exist in the DOM. */
export async function ensureConsoleExpanded(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .first()
      .click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

/** Count of rendered console rows (the message-bearing rows only). */
export function consoleRows(page: Page) {
  return page
    .locator('[data-testid^="log-entry-"]')
    .filter({ has: page.locator('[data-testid="log-entry-message"]') })
}

export interface ArrivalSample {
  at: number
  count: number
}

/**
 * Sample the console row count until `until` resolves true, recording the
 * first-seen time of every distinct count. Proves lines arrive progressively
 * (>= 3 distinct arrival times spread across the run), not as one end dump.
 */
export async function sampleConsoleArrivals(
  page: Page,
  until: () => Promise<boolean>,
  intervalMs = 250,
  timeoutMs = 60_000,
): Promise<ArrivalSample[]> {
  const samples: ArrivalSample[] = []
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const count = await consoleRows(page).count()
    const last = samples[samples.length - 1]
    if (!last || count > last.count) {
      samples.push({ at: Date.now(), count })
    }
    if (await until()) return samples
    if (Date.now() > deadline) {
      throw new Error(`sampleConsoleArrivals timed out; samples=${JSON.stringify(samples)}`)
    }
    await page.waitForTimeout(intervalMs)
  }
}

/** Assert >= minArrivals distinct growth moments spread over >= minSpreadMs. */
export function expectProgressiveArrivals(
  samples: ArrivalSample[],
  minArrivals = 3,
  minSpreadMs = 2_000,
): void {
  const growth = samples.filter((s) => s.count > 0)
  expect(
    growth.length,
    `expected >= ${minArrivals} distinct console arrival times, saw ${JSON.stringify(samples)}`,
  ).toBeGreaterThanOrEqual(minArrivals)
  const spread = growth[growth.length - 1].at - growth[0].at
  expect(
    spread,
    `console lines arrived within ${spread}ms - looks like one end-of-run dump`,
  ).toBeGreaterThanOrEqual(minSpreadMs)
}
