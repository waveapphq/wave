/**
 * V-FN-VIEW-03: single-outcome publish confirm (library View).
 *
 * Design Decisions: VIEW-7
 * REQ: REQ-3.1.2.2
 *
 * The in-Test publish keeps the three-option dialog; the library View collapses
 * it to a single Cancel + Publish confirm (no instance to re-pin).
 *
 * Pass Criteria:
 * 1. The metadata dialog -> Publish opens the single-outcome AlertDialog titled
 *    "Publish a new version?" with the mono vSrc -> vTgt line (1.0.0 -> 1.0.1).
 * 2. Single mode offers exactly Cancel + Publish (publish-outcome-single-confirm);
 *    the three-option "Publish and set New / keep Old" buttons are ABSENT.
 * 3. The single-mode description states the View switches to the new version.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, openFunctionView, logNode, startEdge } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

test.describe('V-FN-VIEW-03: single-outcome publish confirm', () => {
  test('renders the single Cancel + Publish confirm, not the three-option dialog', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-03-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })
    await openFunctionView(page, fn.functionId, fn.version)
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await page.locator('[data-testid="action-bar-publish-button"]').click()

    // Metadata dialog: changelog + details are mandatory before Publish.
    const meta = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(meta).toBeVisible({ timeout: 15_000 })
    await meta.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('view publish')
    await meta.locator('[data-testid="publish-edit-mode-details-input"]').fill('completion details')
    await meta.getByRole('button', { name: 'Publish' }).click()

    // Per VIEW-7: the single-outcome confirm with the default patch bump.
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await expect(confirm).toContainText('v1.0.0')
    await expect(confirm).toContainText('v1.0.1')
    await expect(confirm).toContainText('switches to the new version')

    // Single mode: Cancel + Publish only; the three-option buttons are absent.
    await expect(confirm.locator('[data-testid="publish-outcome-single-confirm"]')).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Publish and set New' })).toHaveCount(0)
    await expect(confirm.getByRole('button', { name: 'Publish and keep Old' })).toHaveCount(0)

    // This is a DOM spec - cancel out without mutating the library.
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
  })
})
