/**
 * V-LIB-FN-01: Empty Functions Library modal
 *
 * Design Decisions: CANVAS-202 ("Function Lib" button opens the modal),
 *                   CANVAS-204 (non-blocking + draggable modal shell).
 *
 * Phase: no-data (parallel) - asserts the modal's empty state only; there is
 * no library content (search, tag filters, card grid, drag-to-canvas) to
 * exercise.
 *
 * Pass Criteria:
 *   1. Clicking the "Function Lib" button opens a non-blocking modal whose
 *      accessible region is named "Functions Library" and whose body renders
 *      the verbatim empty-state copy:
 *      "No published Functions yet. Build one in the canvas, then Publish it."
 *   2. The X close button dismisses the modal.
 *   3. Pressing Escape dismisses the modal.
 *
 * The library-content surface (search, tag filters, populated card grid,
 * drag-to-canvas) is out of scope for this spec.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const EMPTY_COPY =
  'No published Functions yet. Build one in the canvas, then Publish it.'

test.describe('V-LIB-FN-01: empty Functions Library modal', () => {
  test.beforeEach(async ({ page, request }) => {
    // Empty-state assertion needs a clean library; the shared no-data backend has no functions reset, so a sibling spec's seed can persist.
    const list = await request.get(`${BACKEND_URL}/functions?per_page=100`)
    const ids = ((await list.json()).data ?? []).map((fn: { id: string }) => fn.id)
    if (ids.length > 0) {
      await request.delete(`${BACKEND_URL}/functions/batch`, {
        data: { ids, cascade: true },
      })
    }
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: clicking "Function Lib" opens the modal with the empty-state copy', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    await page.locator('[data-testid="palette-blocks-library-button"]').click()

    const modal = page.getByRole('region', { name: 'Functions Library' })
    await expect(modal).toBeVisible()
    await expect(modal.getByText(EMPTY_COPY, { exact: true })).toBeVisible()
  })

  test('S2: X close button dismisses the modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()

    const modal = page.getByRole('region', { name: 'Functions Library' })
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden()
  })

  test('S3: Escape dismisses the modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()

    const modal = page.getByRole('region', { name: 'Functions Library' })
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
  })
})
