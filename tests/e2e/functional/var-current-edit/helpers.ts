/**
 * Shared helpers for the var-current-edit specs (runtime variable override
 * while paused/stopped/idle). Self-contained per the per-dir
 * helper convention used by debug-step / function-debug-halt; the
 * import+validate logic mirrors those so every fixture passes
 * /tests/{id}/validate before it is run.
 */

import { expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, clickNodeKebabItem } from '../../helpers/canvas'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { editFromWatcher, saveWindow } from '../../helpers/variable-create'

export type WorkflowStatus = 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped' | 'running' | 'idle'

/** Import a fixture via POST /tests, assert it validates with zero errors, open
 *  it in the workbench, and expand the Variable Manager. Returns the test id. */
export async function importValidateOpen(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)

  const baseName = (fixture as { name?: string }).name ?? 'Var Current Edit'
  const uniqueFixture = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }

  const createResp = await page.request.post(`${BACKEND_URL}/tests`, { data: uniqueFixture })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body.data?.id ?? body.id) as string

  // Mandatory gate: the fixture must validate with zero errors.
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
  await expandVariableManager(page)
  return testId
}

export async function expandVariableManager(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="variable-manager"]')
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

export async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

/** Toggle a breakpoint via the node kebab (atomic-retry helper; the raw
 *  right-click + menuitem.click() races the node re-render). */
export async function setBreakpoint(page: Page, nodeId: string): Promise<void> {
  await clickNodeKebabItem(page, nodeId, 'Toggle Breakpoint')
}

export async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
}

export async function startRun(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
}

export async function waitForStatus(
  page: Page,
  expected: WorkflowStatus,
  timeout = 30_000,
): Promise<void> {
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    expected,
    { timeout },
  )
}

export async function expectPausedAt(page: Page, nodeId: string, timeout = 30_000): Promise<void> {
  await waitForStatus(page, 'paused', timeout)
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-paused',
    'true',
  )
}

export async function clickContinue(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-continue-button"]')
  await expect(btn).toBeVisible()
  await btn.click()
}

/** Stop the run immediately (Stop -> confirmation dialog -> Stop immediately). */
export async function stopImmediate(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
}

export async function getActiveSessionId(page: Page): Promise<string> {
  const resp = await page.request.get(`http://localhost:${BACKEND_PORT}/workbench/session`)
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /workbench/session failed: ${resp.status()}`).toBeTruthy()
  const sessionId = body?.data?.session_id ?? body?.session_id ?? null
  expect(sessionId, `expected an active session_id, got ${JSON.stringify(body)}`).toBeTruthy()
  return sessionId as string
}

/** Poll the active session id until it differs from `prev`, then return it.
 *  A re-run keeps the terminal status `passed`, so waiting on the status alone
 *  races the stale value; a new session id is the unambiguous "new run" signal. */
export async function waitForNewSession(page: Page, prev: string): Promise<string> {
  let current = prev
  await expect(async () => {
    current = await getActiveSessionId(page)
    expect(current).not.toBe(prev)
  }).toPass({ timeout: 20_000 })
  return current
}

export async function getSessionVariables(
  page: Page,
  sessionId: string,
): Promise<Record<string, { value: unknown; type: string }>> {
  const resp = await page.request.get(
    `http://localhost:${BACKEND_PORT}/workbench/${sessionId}/variables`,
  )
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /workbench/{sid}/variables failed: ${resp.status()}`).toBeTruthy()
  return body.data.variables
}

// ---------------------------------------------------------------------------
// Inspect-modal helpers
// ---------------------------------------------------------------------------

export const contentRoot = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

export const rowFor = (page: Page, name: string): Locator =>
  contentRoot(page).locator(`[aria-label="Variable ${name}"]`)

export const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

/** Open a variable's inspect modal (opens in Current view mode by default). */
export async function openInspector(page: Page, name: string): Promise<Locator> {
  const row = rowFor(page, name)
  await expect(row).toBeVisible()
  await row.hover()
  await row.locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

export async function closeInspector(page: Page, name: string): Promise<void> {
  const modal = modalFor(page, name)
  if ((await modal.count()) === 0) return
  await modal.locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(modal).toHaveCount(0)
}

/** Pick an inspect Mode (Initial / Current / Compare) via the color-coded pill. */
export async function setMode(
  page: Page,
  modal: Locator,
  label: 'Initial' | 'Current' | 'Compare',
): Promise<void> {
  await modal.locator('[data-testid="mode-dropdown"]').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

/** Pick an inspect View (Last Evaluated / Expression / Visual / Code) by label. */
export async function setView(page: Page, modal: Locator, label: string): Promise<void> {
  await modal.locator('[data-testid="view-dropdown"]').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

/** Open the Edit window of the watcher's variable at the value the watcher shows; returns the window. */
export async function clickEdit(modal: Locator): Promise<Locator> {
  return editFromWatcher(modal)
}

/** Save an Edit window and wait for it to close. */
export async function saveEdit(win: Locator): Promise<void> {
  await saveWindow(win.page(), win)
}

/** Replace the whole document of a CodeMirror editor inside the modal. */
export async function replaceCodeMirror(page: Page, host: Locator, text: string): Promise<void> {
  const cm = host.locator('.cm-content').first()
  await cm.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await cm.pressSequentially(text)
  await page.keyboard.press('Escape')
}
