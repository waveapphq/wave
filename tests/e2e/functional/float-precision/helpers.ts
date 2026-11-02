/**
 * Shared helpers for the float-precision specs (the float Decimal pipeline,
 * REQ-3.1.3.14). Self-contained per the per-dir helper
 * convention used by var-current-edit / debug-step; the import+validate logic
 * mirrors those so every fixture passes /tests/{id}/validate before it is run.
 */

import { expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, clickNodeKebabItem } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { editFromWatcher, openEditWindow, renameInWindow, saveWindow } from '../../helpers/variable-create'

export type WorkflowStatus =
  | 'paused'
  | 'passed'
  | 'failed'
  | 'stopped'
  | 'skipped'
  | 'running'
  | 'idle'

/** Import a fixture via POST /tests, assert it validates with zero errors, open
 *  it in the workbench, and expand the Variable Manager. Returns the test id. */
export async function importValidateOpen(
  page: Page,
  fixture: Record<string, unknown>,
): Promise<string> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await ensureEnvironment(page.request)

  const baseName = (fixture as { name?: string }).name ?? 'Float Precision'
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

  // The fixture must validate with zero errors before any UI interaction.
  const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate`)
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
  expect(errors.length, `Fixture failed validation. Errors: ${JSON.stringify(errors)}`).toBe(0)

  await openTest(page, testId)
  await expandVariableManager(page)
  return testId
}

/** (Re)open a test in the workbench with a clean localStorage. Drops any active
 *  workbench session first so a reload loads the saved definition (not the live
 *  session's variable space). */
export async function openTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
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
  // The env list can re-render and detach the row mid-click; retry the click
  // (re-querying the button, force past any transient overlay) until it closes.
  await expect(async () => {
    await popover
      .locator(`button:has-text("${E2E_ENV_NAME}")`)
      .first()
      .click({ force: true, timeout: 3000 })
    await expect(popover).not.toBeVisible({ timeout: 1500 })
  }).toPass({ timeout: 15_000 })
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

export async function getActiveSessionId(page: Page): Promise<string> {
  const resp = await page.request.get(`${BACKEND_URL}/workbench/session`)
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /workbench/session failed: ${resp.status()}`).toBeTruthy()
  const sessionId = body?.data?.session_id ?? body?.session_id ?? null
  expect(sessionId, `expected an active session_id, got ${JSON.stringify(body)}`).toBeTruthy()
  return sessionId as string
}

export async function getSessionVariables(
  page: Page,
  sessionId: string,
): Promise<Record<string, { value: unknown; type: string }>> {
  const resp = await page.request.get(`${BACKEND_URL}/workbench/${sessionId}/variables`)
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /workbench/{sid}/variables failed: ${resp.status()}`).toBeTruthy()
  return body.data.variables
}

/** Read the persisted test definition back from the backend. */
export async function getTest(page: Page, testId: string): Promise<Record<string, any>> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `GET /tests/{id} failed: ${resp.status()}`).toBeTruthy()
  return body.data ?? body
}

/** Read the persisted test definition's variables back from the backend. */
export async function getTestVariables(
  page: Page,
  testId: string,
): Promise<Record<string, { value: unknown; type: string; isExpression?: boolean }>> {
  return (await getTest(page, testId)).variables
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

/** Open a variable's inspect modal via the eye (opens in Current view mode). */
export async function openInspector(page: Page, name: string): Promise<Locator> {
  const row = rowFor(page, name)
  await expect(row).toBeVisible()
  await row.hover()
  await row.locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

/** Open a variable's Edit window via the row pencil (opens on Initial); returns the window. */
export async function openInspectEditViaPencil(page: Page, name: string): Promise<Locator> {
  return openEditWindow(page, name)
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
  await expect(modal.locator('[data-testid="mode-dropdown"]')).toContainText(label)
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

/** Replace an Edit window's Name with a new variable name. */
export async function renameInModal(win: Locator, newName: string): Promise<void> {
  await renameInWindow(win, newName)
}

/** Persist the in-memory workbench spec: editing an existing test saves
 *  directly (no dialog); the toolbar button disables once the save flushes. */
export async function toolbarSave(page: Page): Promise<void> {
  const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
}
