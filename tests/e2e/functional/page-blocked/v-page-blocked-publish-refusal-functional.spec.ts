/**
 * V-PAGE-BLOCKED-PUBLISH-REFUSAL: a Function is not published over tags that
 * never loaded
 *
 * Phase: functional-workflow. The publish dialog reads the tag universe so the
 * author can put the new library entry where it belongs. When that read fails
 * the dialog does not block the canvas behind it: it refuses inside itself,
 * says why, and offers its own retry. Publishing anyway would write a library
 * entry whose tags were chosen from a list that was never there.
 *
 * Design Decisions: LIST-11 (a failed read is never presented as a result),
 * LIST-18 (the blocked surface is whatever the failed read serves), LIST-16
 * (the retry re-runs the read that failed).
 *
 * Pass Criteria:
 *  1. A failed tag read shows the dialog's own refusal line.
 *  2. Publish is refused and reads as refused: disabled, dimmed, and no
 *     publish request is issued.
 *  3. The canvas behind the dialog is untouched.
 *  4. The dialog's own Try Again over a restored backend clears the refusal
 *     and Publish becomes available.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { countApiFetches, failApiRoute } from '../../helpers/api-route'
import {
  clickNodeKebabItem,
  dragSourceToCanvas,
  expandPalette,
  waitForCanvasLoad,
} from '../../helpers/canvas'
import {
  FUNCTIONS_LIST_ROUTE,
  FUNCTION_TAGS_ROUTE,
  expectNotBlocked,
} from '../../helpers/page-block'
import { releaseWorkbenchOwnership } from '../../helpers/fn-seed'

const TAGS_DETAIL = 'Tag index unavailable'
const TAGS_REFUSAL = 'Could not load tags, so this Function cannot be published yet.'

// Long enough for a publish that was going to be issued to have been issued.
const SETTLE_MS = 700

test.describe('V-PAGE-BLOCKED-PUBLISH-REFUSAL: the dialog refuses inside itself', () => {
  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
  })

  test('PR1: a failed tag read refuses the publish and retries from the dialog', async ({
    page,
  }) => {
    await releaseWorkbenchOwnership(page.request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await expandPalette(page)
    const newFunctionButton = page.locator('[data-testid="palette-new-block-button"]')
    await expect(newFunctionButton).toBeVisible()
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box, 'the canvas must be laid out').toBeTruthy()
    await dragSourceToCanvas(page, newFunctionButton, {
      x: box!.width * 0.4,
      y: box!.height * 0.4,
    })
    const node = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]').first()
    await expect(node).toBeVisible()
    const nodeTestId = await node.getAttribute('data-testid')
    const nodeId = nodeTestId!.replace(/^workflow-node-/, '')

    // Armed after the canvas is up, so only the dialog's own read fails.
    let failing = true
    await failApiRoute(page, FUNCTION_TAGS_ROUTE, () => (failing ? { detail: TAGS_DETAIL } : null))
    const publishWrites = countApiFetches(page, FUNCTIONS_LIST_ROUTE, 'POST')

    await clickNodeKebabItem(page, nodeId, 'Publish to Library')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
    await expect(dialog).toBeVisible({ timeout: 15000 })

    // 1. The dialog says what is missing, in its own words.
    const tagsError = dialog.getByTestId('publish-tags-error')
    await expect(tagsError).toBeVisible({ timeout: 15000 })
    await expect(tagsError).toContainText(TAGS_REFUSAL)

    // 2. Publish is refused, and it reads as refused.
    await dialog.locator('[data-testid="publish-name-input"]').fill('PBLK Publish Refusal')
    const publish = dialog.getByRole('button', { name: 'Publish', exact: true })
    await expect(publish).toBeDisabled()
    await expect(publish).toHaveCSS('opacity', '0.5')
    await expect(publish).toHaveCSS('cursor', 'not-allowed')
    await page.waitForTimeout(SETTLE_MS)
    expect(publishWrites(), 'no library entry may be written').toBe(0)

    // 3. The canvas behind the dialog is not the failed surface.
    await expectNotBlocked(page)

    // 4. The dialog's own retry re-runs its own read.
    failing = false
    await dialog.getByTestId('publish-tags-retry').click()
    await expect(tagsError).toHaveCount(0, { timeout: 15000 })
    await expect(publish).toBeEnabled()
    expect(publishWrites(), 'recovering must not publish anything by itself').toBe(0)
  })
})
