/**
 * Shared helpers for the Debug Step specs (Step Over / Step Into / Repeat
 * Step / Skip Block routing). Mirrors the helper shape used in
 * debug-run so each spec stays focused on its own scenario.
 */

import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { injectHttpHost, type ImportFixtureOptions } from '../../helpers/fixture-import'
import {
  BACKEND_PORT,
  E2E_ENV_NAME,
  HTTP_TARGET_HOST,
  HTTP_MAIN_PORT,
  ensureEnvironment,
} from '../../helpers/config'

export type WorkflowStatus =
  | 'paused'
  | 'passed'
  | 'failed'
  | 'stopped'
  | 'skipped'
  | 'running'

export async function importAndNavigate(
  page: Page,
  fixture: Record<string, unknown>,
  opts: ImportFixtureOptions = {},
): Promise<string> {
  if (opts.injectHttp) fixture = injectHttpHost(fixture)
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  // Test names must be unique across the database. Append a per-call
  // random suffix so concurrent / repeated runs of the same fixture don't
  // collide with each other (POST /tests treats a duplicate name as a
  // 500 today, not 409).
  const baseName = (fixture as { name?: string }).name ?? 'Debug Step Test'
  const uniqueFixture = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: uniqueFixture,
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  // Fixtures must pass /tests/{id}/validate with zero errors; failures are 422 with the result under error.details[0].
  const validateResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
  )
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(
    errors.length,
    `Fixture failed validation. Errors: ${JSON.stringify(errors)}`,
  ).toBe(0)

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

export async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

export async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

export async function setDebugOption(
  page: Page,
  option: 'first' | 'errors',
  checked: boolean,
): Promise<void> {
  await page.locator('[data-testid="debug-options-gear"]').click()
  const popover = page.locator('[data-testid="debug-options-popover"]')
  await expect(popover).toBeVisible()
  const checkboxTestId =
    option === 'first' ? 'pause-on-first-checkbox' : 'pause-on-errors-checkbox'
  const checkbox = popover.locator(`[data-testid="${checkboxTestId}"]`)
  const current = await checkbox.getAttribute('data-state')
  const isChecked = current === 'checked'
  if (isChecked !== checked) {
    await checkbox.click()
  }
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
}

export async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
}

export async function waitForStatus(
  page: Page,
  expected: WorkflowStatus,
  timeout = 15_000,
): Promise<void> {
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', expected, { timeout })
}

export async function expectPausedAt(
  page: Page,
  nodeId: string,
  timeout = 15_000,
): Promise<void> {
  await waitForStatus(page, 'paused', timeout)
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toHaveAttribute('data-paused', 'true')
}

export async function clickContinue(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-continue-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

export async function clickStepOver(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-step-over-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

export async function clickStepInto(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-step-into-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

export async function clickRepeatStep(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-repeat-step-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

export async function clickSkipBlock(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-skip-block-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

export async function clickStopImmediate(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
}

export async function getNodeExecStatus(
  page: Page,
  nodeId: string,
): Promise<string | null> {
  return page
    .locator(`[data-testid="workflow-node-${nodeId}"]`)
    .getAttribute('data-execution-status')
}

export async function getActiveSessionId(
  request: APIRequestContext,
): Promise<string> {
  const resp = await request.get(`http://localhost:${BACKEND_PORT}/workbench/session`)
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/session failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const sessionId = body?.data?.session_id ?? body?.session_id ?? null
  expect(sessionId, `Expected an active workbench session_id; got ${JSON.stringify(body)}`).toBeTruthy()
  return sessionId as string
}

/**
 * Arm http-echo's stateful timeout endpoint for a given key. The NEXT request
 * to /timeout?key=<key> delays by the fixture's `delay` query param, then
 * disarms - so the SECOND request (post-Repeat) is instant. Targets
 * HTTP_TARGET_HOST so arm and trigger hit the same published service in both
 * host and container-shard modes.
 */
export async function armHttpsTimeout(
  request: APIRequestContext,
  key: string,
): Promise<void> {
  const resp = await request.post(
    `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/timeout/arm?key=${encodeURIComponent(key)}`,
    { ignoreHTTPSErrors: true },
  )
  expect(
    resp.ok(),
    `POST /timeout/arm failed: ${resp.status()}`,
  ).toBeTruthy()
}
