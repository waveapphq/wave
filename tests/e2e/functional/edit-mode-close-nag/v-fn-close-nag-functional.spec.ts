/**
 * V-FN-CLOSE-NAG (functional): the OK-only edit-mode close nag. Closing a Test
 * that still has a Shared Function in edit
 * mode pops a non-blocking "Functions still in edit mode" nag BEFORE the close
 * completes, with the Test canvas still visible behind it.
 *
 * REQ-5.2.1.23.
 *
 * Relevance matrix:
 *   - clean close of an already-saved edit-mode Test -> nag, then close on OK.
 *   - Save-and-Close of a dirty edit-mode Test -> close-confirm first, then nag
 *     after the save, then close on OK.
 *   - Discard-and-Close of a dirty edit-mode Test -> NO nag (the discard makes
 *     the edit-mode state irrelevant); the close proceeds directly.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { publishLibraryFunction, sharedNode, startEdge, openTest } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const NAG = '[data-testid="edit-mode-nag-modal"]'
const CLOSE_BTN = '[data-testid="toolbar-close-button"]'

async function seedLib(request: APIRequestContext) {
  return publishLibraryFunction(request, { name: `NagFn-${randomUUID().slice(0, 6)}` })
}

/** A clean Test with one Shared reference (not in edit mode). */
async function seedCleanRefTest(request: APIRequestContext, lib: { functionId: string; name: string }): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-CLOSE-NAG ${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      description: 'clean shared ref for close-nag coverage',
      workflow: {
        nodes: [sharedNode('fn-nag', { functionId: lib.functionId, functionVersion: '1.0.0', label: lib.name })],
        edges: [startEdge('fn-nag')],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

/** Enter edit mode on the clean ref via the kebab (client-side; dirties the canvas). */
async function enterEditMode(page: Page): Promise<void> {
  await clickNodeKebabItem(page, 'fn-nag', 'Edit')
  await expect(
    page.locator(`[data-testid="workflow-node-fn-nag"] [data-testid="edit-mode-mark-wrapper"]`),
  ).toBeVisible({ timeout: 10_000 })
}

test.describe('V-FN-CLOSE-NAG (functional): edit-mode close nag ordering + relevance', () => {
  test('clean close of a saved edit-mode Test nags BEFORE closing; OK proceeds', async ({ page, request }) => {
    const lib = await seedLib(request)
    const testId = await seedCleanRefTest(request, lib)
    await openTest(page, testId)

    // Enter edit mode then SAVE so the Test is saved-AND-clean while still holding
    // an edit-mode Function (the "already-saved edit-mode Test" clean-close case).
    await enterEditMode(page)
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 15_000 })

    // Clean close -> the nag fires immediately (no close-confirm: nothing dirty).
    await page.locator(CLOSE_BTN).click()
    await expect(page.locator(NAG)).toBeVisible({ timeout: 10_000 })
    // The Test canvas is still visible behind the nag (close has NOT completed).
    await expect(page.locator(`[data-testid="workflow-node-fn-nag"]`)).toBeVisible()

    // OK acknowledges and the close proceeds (canvas resets to the empty state).
    await page.locator(NAG).getByRole('button', { name: 'OK' }).click()
    await expect(page.locator(NAG)).toBeHidden({ timeout: 5_000 })
    await expect(page.locator(`[data-testid="workflow-node-fn-nag"]`)).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('[data-testid="onboarding-placeholder"]')).toBeVisible({ timeout: 10_000 })
  })

  test('Save-and-Close of a dirty edit-mode Test: close-confirm first, THEN nag, THEN close', async ({ page, request }) => {
    const lib = await seedLib(request)
    const testId = await seedCleanRefTest(request, lib)
    await openTest(page, testId)
    await enterEditMode(page)

    // Dirty close shows the close-confirm dialog first.
    await page.locator(CLOSE_BTN).click()
    const confirm = page.locator('[role="dialog"]', { hasText: 'Unsaved Changes' })
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(NAG)).toHaveCount(0)

    // Save and Close -> the nag fires after the save, canvas still visible.
    await confirm.getByRole('button', { name: 'Save and Close' }).click()
    await expect(page.locator(NAG)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(`[data-testid="workflow-node-fn-nag"]`)).toBeVisible()

    await page.locator(NAG).getByRole('button', { name: 'OK' }).click()
    await expect(page.locator(NAG)).toBeHidden({ timeout: 5_000 })
    await expect(page.locator('[data-testid="onboarding-placeholder"]')).toBeVisible({ timeout: 10_000 })
  })

  test('Discard-and-Close of a dirty edit-mode Test does NOT nag', async ({ page, request }) => {
    const lib = await seedLib(request)
    const testId = await seedCleanRefTest(request, lib)
    await openTest(page, testId)
    await enterEditMode(page)

    await page.locator(CLOSE_BTN).click()
    const confirm = page.locator('[role="dialog"]', { hasText: 'Unsaved Changes' })
    await expect(confirm).toBeVisible({ timeout: 10_000 })

    // Discard makes the edit-mode state irrelevant - no nag, close proceeds.
    await confirm.getByRole('button', { name: 'Discard and Close' }).click()
    await expect(page.locator('[data-testid="onboarding-placeholder"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(NAG)).toHaveCount(0)
    await expect(page.locator(`[data-testid="workflow-node-fn-nag"]`)).toHaveCount(0)
  })
})
