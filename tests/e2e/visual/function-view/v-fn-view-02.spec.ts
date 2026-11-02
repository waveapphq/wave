/**
 * V-FN-VIEW-02: edit-mode chrome with the primary Publish button.
 *
 * Design Decisions: VIEW-6
 * REQ: REQ-3.2.1.1
 *
 * Pass Criteria:
 * 1. Entering edit mode shows the Edit-mode pill + Drop changes + Publish.
 * 2. Publish is the PRIMARY (blue) variant carrying the Upload icon, aria-label
 *    "Publish".
 * 3. Publish is rightmost in the edit-mode cluster (after Drop changes, which is
 *    NOT primary).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, openFunctionView, logNode, startEdge } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

test.describe('V-FN-VIEW-02: edit-mode chrome Publish button', () => {
  test('shows a primary blue Upload Publish button rightmost in the edit cluster', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-02-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })
    await openFunctionView(page, fn.functionId, fn.version)

    // Enter edit mode (in-memory draft).
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()

    // Per VIEW-6: the edit-mode chrome shows the Edit-mode pill + Drop changes +
    // the primary Publish.
    await expect(page.locator('[aria-label="Edit-mode inspect"]')).toBeVisible({ timeout: 15_000 })
    const publish = page.locator('[data-testid="action-bar-publish-button"]')
    const drop = page.locator('[data-testid="action-bar-drop-changes-button"]')
    await expect(publish).toBeVisible()
    await expect(drop).toBeVisible()

    // Primary (design-system btn-primary) + Upload icon + aria-label.
    await expect(publish).toHaveAttribute('aria-label', 'Publish')
    await expect(publish).toHaveClass(/btn-primary/)
    await expect(publish.locator('svg.lucide-upload')).toBeVisible()

    // Drop changes is the outline (non-primary) sibling; Publish sits to its right.
    await expect(drop).not.toHaveClass(/btn-primary/)
    const dropBox = await drop.boundingBox()
    const pubBox = await publish.boundingBox()
    expect(dropBox).not.toBeNull()
    expect(pubBox).not.toBeNull()
    expect(pubBox!.x).toBeGreaterThan(dropBox!.x)
  })
})
