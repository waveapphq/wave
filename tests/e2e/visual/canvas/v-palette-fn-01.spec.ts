/**
 * V-PALETTE-FN-01: Bottom palette buttons + tooltips
 *
 * Design Decisions: CANVAS-200 (no in-palette Functions section), CANVAS-201 ("New Function" drag handle),
 *                   CANVAS-202 ("Function Lib" button opens the modal), CANVAS-203 (collapsed-strip tooltips).
 *
 * Phase: no-data (parallel) - pure UI assertions on a freshly loaded workbench;
 * no fixtures, no API state needed.
 *
 * Pass Criteria:
 *   1. Expanded palette bottom area shows a "New Function" button (draggable + cyan)
 *      whose label is the words alone beside a plus icon, followed by a
 *      "Function Lib" button (Blocks icon + indigo).
 *   2. Collapsed palette icon strip shows the Plus + Blocks icons at the bottom with
 *      tooltips "New Function" and "Function Lib" respectively.
 *   3. The "New Function" button is `draggable="true"` and pops the drag-hint
 *      tooltip on a click without drag.
 *   4. Clicking "Function Lib" opens the Functions Library modal (non-blocking,
 *      draggable header). Clicking the X or pressing Escape closes it.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, expandPalette } from '../../helpers/canvas'

async function collapsePalette(page: Page) {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'expanded') {
    await page.locator('[data-testid="palette-collapse-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
  }
}

test.describe('V-PALETTE-FN-01: Renamed bottom palette buttons + tooltips', () => {
  test.beforeEach(async ({ page }) => {
    // NOTE: do not delete /workbench/session here; the no-data phase shares it
    // with fixture-phase tests on the same worker.
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: expanded palette bottom buttons read "New Function" and "Function Lib"', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const newFunctionBtn = page.locator('[data-testid="palette-new-block-button"]')
    await expect(newFunctionBtn).toBeVisible()
    // The handle carries no leading "+" character; the plus is the icon.
    await expect(newFunctionBtn).toHaveText('New Function')
    await expect(newFunctionBtn.locator('svg')).toHaveCount(1)
    await expect(newFunctionBtn).toHaveAttribute('draggable', 'true')

    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    await expect(libraryBtn).toBeVisible()
    await expect(libraryBtn).toHaveText(/Function Lib/)
  })

  test('S2: collapsed palette bottom icons expose "New Function" and "Function Lib" tooltips', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await collapsePalette(page)

    const addIcon = page.locator('[data-testid="palette-icon-add"]')
    await expect(addIcon).toBeVisible()
    await expect(addIcon).toHaveAttribute('draggable', 'true')
    await expect(addIcon).toHaveAttribute('aria-label', 'New Function')

    const libIcon = page.locator('[data-testid="palette-icon-library"]')
    await expect(libIcon).toBeVisible()

    // Hover surfaces the Radix tooltip with "Function Lib" content.
    await libIcon.hover()
    await expect(page.getByText('Function Lib', { exact: true }).first()).toBeVisible()
  })

  test('S3: "Function Lib" button opens the Functions Library modal, X and Escape close it', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)

    const libraryBtn = page.locator('[data-testid="palette-blocks-library-button"]')
    await libraryBtn.click()

    const modal = page.getByRole('region', { name: 'Functions Library' })
    await expect(modal).toBeVisible()
    await expect(modal.locator('[data-testid="functions-library-drag-handle"]')).toBeVisible()

    // X close
    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden()

    // Reopen, close with Escape
    await libraryBtn.click()
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
  })

  test('S4: collapsed-strip Blocks icon also opens the Functions Library modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await collapsePalette(page)

    await page.locator('[data-testid="palette-icon-library"]').click()
    const modal = page.getByRole('region', { name: 'Functions Library' })
    await expect(modal).toBeVisible()
  })
})
