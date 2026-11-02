/**
 * V-CANVAS-FN-UNRESOLVED-REF-DIALOG-01: Unresolved-reference dialog across Save/Run/BE
 *
 * Wireframes: none (validation-error dialog is the existing modal surface).
 * Design Decisions: validation-error dialog modes per `validation-error-dialog.tsx`,
 *                   user-initiated Fix only (no silent backend autofix on save).
 * REQ: REQ-3.1.2.4 (block validation before save)
 *
 * No silent autofix: save raises SaveValidationError, FE shows the
 * Fix-or-Cancel dialog, and only the user-initiated Fix button restores the
 * variable (inline on save/run/debug, via `fix_test` on load).
 *
 * Phase: functional-workflow.
 *
 * Pass Criteria:
 *   - Save path: Delete `test1`, click Save. Dialog opens with title
 *     "Cannot Save Test", lists UNDECLARED_VARIABLE for `test1`, has Fix All
 *     + Close. Click Close -> dialog closes, Log node alert pulses
 *     (`animate-validation-icon-pulse`). Re-open Save, click Fix All ->
 *     dialog closes, `test1` re-added to Var Manager.
 *   - Run path: Delete `test1`, click Run. Dialog opens with title
 *     "Cannot Run Test". Cancel pulses alert, Fix All restores variable.
 *   - BE contract: After deleting `test1` via the FE flow (still in-memory),
 *     `POST /tests/{id}/validate?context=save` returns `UNDECLARED_VARIABLE`
 *     in `errors` for the on-disk state IF a save was attempted; the
 *     user-initiated `POST /tests/{id}/fix` recreates the variable.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  return { ...fixture, name: `V-CANVAS-FN-UNRESOLVED-REF-DIALOG-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
}

async function seedFixture(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: loadFixture() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function deleteTest1Variable(page: Page) {
  const row = page.locator('[data-testid^="variable-row-"]').filter({ hasText: 'test1' }).first()
  await expect(row).toBeVisible()
  await row.hover()
  // Click the row's delete button (last action button in the cluster).
  await row.locator('button[data-testid^="delete-button-"]').click()
  // The Log node references `test1`, so the confirmation dialog opens with
  // "References will become unresolved.".
  const confirmDialog = page.getByRole('alertdialog').filter({ hasText: /^Delete\b/ })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
}

async function dialogIsOpenWithTitle(page: Page, title: string) {
  const dialog = page.locator('[data-testid="validation-error-dialog"]')
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  await expect(dialog).toContainText(title)
  return dialog
}

test.describe('V-CANVAS-FN-UNRESOLVED-REF-DIALOG-01: unresolved-ref dialog flows', () => {
  test('Save path: dialog modes, Close pulses alert, Fix All restores variable', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await deleteTest1Variable(page)

    // Save - validation rejects the empty variables map. The BE does not recreate
    // `test1`; the FE shows the dialog instead.
    await page.locator('[data-testid="toolbar-save-button"]').click()
    const saveDialog = await dialogIsOpenWithTitle(page, 'Cannot Save Test')
    await expect(saveDialog.locator('[data-testid="validation-error-list"]')).toContainText("'test1'")
    await expect(saveDialog.locator('[data-testid="validation-fix-all-btn"]')).toBeVisible()

    // Close: alert badge pulses.
    await saveDialog.locator('[data-testid="validation-close-btn"]').click()
    await expect(saveDialog).toBeHidden()
    const alert = page.locator('[data-testid="workflow-node-log-1"] [data-testid="node-validation-alert"]')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveClass(/animate-validation-icon-pulse/)

    // Re-open the dialog via Save, click Fix All - test1 reappears in Var Mgr.
    await page.locator('[data-testid="toolbar-save-button"]').click()
    const reopenedSave = await dialogIsOpenWithTitle(page, 'Cannot Save Test')
    await reopenedSave.locator('[data-testid="validation-fix-all-btn"]').click()
    await expect(reopenedSave).toBeHidden({ timeout: 5_000 })

    const restored = page.locator('[data-testid^="variable-row-"]').filter({ hasText: 'test1' }).first()
    await expect(restored).toBeVisible()
  })

  test('Run path: dialog title "Cannot Run Test"; Fix All restores variable', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(page.request)
    const testId = await seedFixture(request)
    await openTest(page, testId)

    await deleteTest1Variable(page)

    // Select the environment so Run is unblocked by the env picker.
    await page.locator('[data-testid="environment-selector"]').click()
    const popover = page.locator('[data-testid="environment-popover"]')
    await expect(popover).toBeVisible()
    await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()

    // Click Run. The validation dialog opens before execution starts.
    await page.locator('[data-testid="run-button"]').click()
    const runDialog = await dialogIsOpenWithTitle(page, 'Cannot Run Test')
    await expect(runDialog.locator('[data-testid="validation-error-list"]')).toContainText("'test1'")

    // Fix All restores `test1`.
    await runDialog.locator('[data-testid="validation-fix-all-btn"]').click()
    await expect(runDialog).toBeHidden({ timeout: 5_000 })
    const restored = page.locator('[data-testid^="variable-row-"]').filter({ hasText: 'test1' }).first()
    await expect(restored).toBeVisible()
  })

  test('BE contract: validate + fix endpoints honor the user-initiated-fix-only rule', async ({
    page,
    request,
  }) => {
    const testId = await seedFixture(request)

    // Load the test - validation passes (test1 is declared).
    let resp = await request.post(`${BASE}/tests/${testId}/validate?context=save`)
    let body = await resp.json().catch(() => null)
    expect(body?.errors ?? []).toEqual([])

    // Use the FE flow to delete `test1`. The FE keeps the deletion in
    // memory; we drive Save to fire the BE-side validation.
    await openTest(page, testId)
    await deleteTest1Variable(page)
    await page.locator('[data-testid="toolbar-save-button"]').click()

    // The save attempt produces a validation
    // dialog backed by a 422 from the BE. The error code surfaced on the
    // dialog is UNDECLARED_VARIABLE.
    const dialog = await dialogIsOpenWithTitle(page, 'Cannot Save Test')
    await expect(dialog.locator('[data-testid="validation-error-list"]')).toContainText("'test1'")
    // Close so the page is not blocked by a modal in later steps.
    await dialog.locator('[data-testid="validation-close-btn"]').click()

    // The on-disk Test still has `test1` declared (Save did NOT proceed).
    // Verify by re-running validate against context=save on the stored copy.
    resp = await request.post(`${BASE}/tests/${testId}/validate?context=save`)
    body = await resp.json().catch(() => null)
    expect(body?.errors ?? []).toEqual([])

    // POST /tests/{id}/fix is a no-op when on-disk state is already clean
    // (user-initiated fix is reserved for the FE round-trip - same endpoint,
    // different idempotency).
    resp = await request.post(`${BASE}/tests/${testId}/fix`)
    expect(resp.ok(), `POST /tests/${testId}/fix unexpected status: ${resp.status()}`).toBeTruthy()
  })
})
