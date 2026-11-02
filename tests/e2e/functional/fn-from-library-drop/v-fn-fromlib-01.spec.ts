/**
 * V-FN-FROMLIB-01: a Shared instance dropped from the Functions Library shows
 * its source-library link.
 * REQ: REQ-3.1.2.4.
 *
 * The real library-card drop stamps `originalLibraryName` on the instance
 * (`use-canvas-drop.ts`); a seed that omits it produced no "From library" link.
 * This guards the DROP-time stamp end-to-end
 * (distinct from from-library-link, which seeds `originalLibraryName` directly).
 *
 * Pass Criteria:
 *   1. Dragging a published Function card onto the canvas creates a shared node.
 *   2. The node's Edit Config shows the "From library: <name>" inline link.
 *   3. Clicking the link opens the Functions Library modal with search
 *      pre-filled with that name.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { publishLibraryFunction, createValidTest } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'

test.describe('V-FN-FROMLIB-01: dropped-from-library source link', () => {
  test('a dropped library Function exposes its From-library link', async ({ page, request }) => {
    const fn = await publishLibraryFunction(request, { name: `FromLibDrop ${Date.now()}` })
    const testId = await createValidTest(request, {
      name: `V-FN-FROMLIB-01 host ${Date.now()}`,
      nodes: [],
      edges: [],
    })

    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Open the Functions Library modal from the palette.
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const modal = page.locator('[aria-label="Functions Library"]')
    await expect(modal).toBeVisible({ timeout: 10_000 })

    const card = modal.locator('[data-testid="library-card"]').filter({ hasText: fn.name }).first()
    await expect(card).toBeVisible()

    // 1. Drag the card to the canvas (below the modal's footprint) - a real drop
    //    that stamps originalLibraryName.
    const fnNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    await expect(fnNodes).toHaveCount(0)
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    const modalBox = await modal.boundingBox()
    expect(box).toBeTruthy()
    expect(modalBox).toBeTruthy()
    await dragSourceToCanvas(page, card, {
      x: box!.width / 2,
      y: modalBox!.y + modalBox!.height + 30 - box!.y,
    })
    await expect(fnNodes).toHaveCount(1)

    // Close the Library modal so it cannot intercept the dblclick on the dropped
    // node (the node can render under the modal's footprint).
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5_000 })

    // 2. The dropped node's Edit Config exposes the From-library link.
    const droppedNode = fnNodes.first()
    await droppedNode.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const link = dialog.locator('[data-testid="function-from-library-link"]')
    await expect(link).toBeVisible({ timeout: 5_000 })
    await expect(link).toContainText('From library:')
    await expect(link).toContainText(fn.name)

    // 3. Clicking it opens the Library modal with search pre-filled.
    await link.click()
    await expect(page.locator('[data-testid="functions-library-drag-handle"]')).toBeVisible({
      timeout: 10_000,
    })
    const search = page
      .locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]')
      .first()
    await expect(search).toBeVisible({ timeout: 5_000 })
    expect(await search.inputValue()).toBe(fn.name)
  })
})
