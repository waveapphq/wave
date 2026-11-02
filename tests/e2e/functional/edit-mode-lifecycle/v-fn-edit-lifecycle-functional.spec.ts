/**
 * V-FN-EDIT-LIFECYCLE (functional): the client-side edit-mode lifecycle,
 * NODE STATE only.
 *
 *   - Enter edit mode (no Save) -> Drop changes -> the node is a plain published
 *     reference again (editMode markers gone, kebab offers Edit not Drop).
 *   - Enter edit mode -> Save -> reload -> the node is STILL in edit mode (the
 *     edit state persists through the normal Test Save).
 *
 * REQ-3.1.2.2.
 *
 * Scope guard: this spec asserts node STATE only. The undo/redo behavior of Drop
 * (surgical history) is out of scope.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, expectNodeKebabItem } from '../../helpers/canvas'
import { publishLibraryFunction, sharedNode, startEdge, openTest } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-life'
const OVERLAY = `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`

async function seedCleanRefTest(request: APIRequestContext): Promise<string> {
  const lib = await publishLibraryFunction(request, { name: `LifeFn-${randomUUID().slice(0, 6)}` })
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-EDIT-LIFECYCLE ${randomUUID().slice(0, 8)}`,
      version: '1.0.0',
      description: 'clean shared ref for the edit-mode lifecycle',
      workflow: {
        nodes: [sharedNode(FN_NODE_ID, { functionId: lib.functionId, functionVersion: '1.0.0', label: lib.name })],
        edges: [startEdge(FN_NODE_ID)],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

/** Clear Radix's stuck <html>/<body> pointer-events lock after a fast dialog close. */
async function clearPointerLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.pointerEvents = ''
    document.body.style.pointerEvents = ''
  })
}

test.describe('V-FN-EDIT-LIFECYCLE (functional): edit-mode node state', () => {
  test('enter edit mode (no save) -> Drop changes -> clean Published reference', async ({ page, request }) => {
    const testId = await seedCleanRefTest(request)
    await openTest(page, testId)

    // Enter edit mode via the kebab (client-side); the asterisk overlay appears.
    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 10_000 })

    // Drop changes via the kebab -> ConfirmationDialog -> confirm.
    await clickNodeKebabItem(page, FN_NODE_ID, 'Drop changes')
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(confirm).toBeVisible({ timeout: 5_000 })
    await confirm.getByRole('button', { name: 'Drop changes' }).click()
    await expect(confirm).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)

    // Node state: edit-mode markers gone; the kebab offers Edit again, not Drop.
    // Atomic open+assert survives the post-drop node re-render closing the menu.
    await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 5_000 })
    await expectNodeKebabItem(page, FN_NODE_ID, /^Edit$/)
    await expect(
      page.locator('[role="menu"]').getByRole('menuitem', { name: 'Drop changes' }),
    ).toHaveCount(0)
  })

  test('enter edit mode -> Save -> reload -> still in edit mode', async ({ page, request }) => {
    const testId = await seedCleanRefTest(request)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 10_000 })

    // Save the Test: edit-mode entry persists only through the normal Save.
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 15_000 })

    // Reload the Test from storage: the node is STILL in edit mode.
    await openTest(page, testId)
    await expect(page.locator(OVERLAY)).toBeVisible({ timeout: 10_000 })
    await expectNodeKebabItem(page, FN_NODE_ID, 'Drop changes')
    await expect(
      page.locator('[role="menu"]').getByRole('menuitem', { name: /^Edit$/ }),
    ).toHaveCount(0)
  })
})
