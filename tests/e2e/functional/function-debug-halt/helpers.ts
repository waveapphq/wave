/**
 * Shared helpers for the function-debug-halt specs (step/skip/repeat on a
 * Function composite + function-scope Halt).
 * Self-contained per the per-dir helper convention used by debug-step and
 * fn-debug-step-over. The import+validate logic mirrors debug-step/helpers.ts
 * so every fixture passes /tests/{id}/validate before it is run.
 */

import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'

export type WorkflowStatus = 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped' | 'running'

/** Import a fixture via POST /tests, assert it validates with zero errors, then open it. */
export async function importAndNavigate(page: Page, fixture: Record<string, unknown>): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)

  const baseName = (fixture as { name?: string }).name ?? 'Function Debug Halt'
  const uniqueFixture = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: uniqueFixture })
  const body = await createResp.json().catch(() => null)
  expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id || body.id

  const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? validateBody?.errors ?? []
  expect(errors.length, `Fixture failed validation. Errors: ${JSON.stringify(errors)}`).toBe(0)

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

export async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
}

export async function startRun(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
}

export async function waitForStatus(page: Page, expected: WorkflowStatus, timeout = 30_000): Promise<void> {
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', expected, { timeout })
}

export async function expectPausedAt(page: Page, nodeId: string, timeout = 30_000): Promise<void> {
  await waitForStatus(page, 'paused', timeout)
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute('data-paused', 'true')
}

export async function clickContinue(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-continue-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

export async function clickStepOver(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-step-over-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

export async function clickStepInto(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-step-into-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

export async function clickRepeatStep(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-repeat-step-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

export async function clickSkipBlock(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-skip-block-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

export async function getNodeExecStatus(page: Page, nodeId: string): Promise<string | null> {
  return page.locator(`[data-testid="workflow-node-${nodeId}"]`).getAttribute('data-execution-status')
}

/** Read a node's run-state badge state ('pass' | 'fail' | 'skip' | ...) or null when no badge is shown. */
export async function getRunStateBadge(page: Page, nodeId: string): Promise<string | null> {
  const badge = page
    .locator(`[data-testid="workflow-node-${nodeId}"]`)
    .locator('[data-testid="node-run-state-badge"]')
  if ((await badge.count()) === 0) return null
  return badge.first().getAttribute('data-state')
}

export { type APIRequestContext }
