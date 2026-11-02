/**
 * V-FN-VIEW-01: read-only library View - chrome + Function-only breadcrumb + action bar.
 *
 * Design Decisions: VIEW-1, VIEW-2
 * REQ: REQ-3.2.1.1
 *
 * Opening a published Function from the detail page "View workflow" drills
 * straight into the read-only Shared body. This spec proves the View chrome,
 * the Function-only breadcrumb, and that the action bar
 * drops the Test-only Save/Edit controls while
 * keeping Close (showTestControls={!functionViewMode}).
 *
 * Pass Criteria:
 * 1. READ-ONLY chrome: the Read-only pill + Edit Function button are shown.
 * 2. Breadcrumb shows ONLY the Function: back arrow + Function name, no Test
 *    segment (no parent links).
 * 3. Action bar omits the Test-only controls: toolbar-save-button +
 *    toolbar-edit-button ABSENT; toolbar-close-button PRESENT + ENABLED.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, logNode, startEdge } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

test.describe('V-FN-VIEW-01: read-only library View', () => {
  test('drills into the read-only body with a Function-only breadcrumb and no Test controls', async ({
    page,
    request,
  }) => {
    // Per VIEW-1 / VIEW-2: a published Function with a body, opened from the
    // detail page ("View workflow" wiring).
    const fn = await publishLibraryFunction(request, {
      name: `View-01-${randomUUID().slice(0, 6)}`,
      workflow: { nodes: [logNode('inner-log', 'Body', "'hi'")], edges: [startEdge('inner-log')] },
    })

    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/functions/${fn.functionId}`)
    await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()
    await page.locator('[data-testid="view-workflow"]').click()

    // 1. READ-ONLY chrome.
    const editFn = page.locator('[data-testid="action-bar-edit-function-button"]')
    await expect(editFn).toBeVisible({ timeout: 20_000 })
    await expect(editFn).toContainText('Edit Function')
    const readonlyPill = page.locator('[aria-label="Read-only inspect mode"]')
    await expect(readonlyPill).toBeVisible()
    await expect(readonlyPill).toContainText('Read-only')

    // 2. Function-only breadcrumb: back arrow + Function name, no Test segment.
    await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toBeVisible()
    await expect(page.locator('[data-testid="breadcrumb-back-arrow"]')).toBeVisible()
    const path = page.locator('[data-testid="breadcrumb-path"]')
    await expect(path).toContainText(fn.name)
    // A Function-only breadcrumb has just the leaf - no parent (Test) links.
    await expect(path.locator('a')).toHaveCount(0)

    // 3. Action bar: Save + Edit are Test-only (absent in the View); Close stays.
    await expect(page.locator('[data-testid="toolbar-save-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="toolbar-edit-button"]')).toHaveCount(0)
    const close = page.locator('[data-testid="toolbar-close-button"]')
    await expect(close).toBeVisible()
    await expect(close).toBeEnabled()
  })
})
