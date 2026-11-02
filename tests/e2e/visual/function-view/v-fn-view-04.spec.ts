/**
 * V-FN-VIEW-04: the palette "Function Lib" button uses the FunctionSquare icon.
 *
 * Design Decisions: VIEW-8
 * REQ: REQ-3.2.1.1
 *
 * The palette renders COLLAPSED by default (palette-collapsed.tsx) and expands
 * on demand (palette-expanded.tsx). This spec asserts BOTH variants carry
 * FunctionSquare and neither carries the Blocks glyph.
 *
 * Pass Criteria:
 * 1. Collapsed (default): palette-icon-library shows the FunctionSquare glyph
 *    (lucide-react renders the alias as svg.lucide-square-function).
 * 2. Expanded: palette-blocks-library-button shows the same glyph + the
 *    "Function Lib" label.
 * 3. Neither variant renders the svg.lucide-blocks glyph.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

test.describe('V-FN-VIEW-04: FunctionSquare palette icon', () => {
  test('shows FunctionSquare in both the collapsed and expanded palette', async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // 1. Collapsed (default): the library icon is FunctionSquare, not Blocks.
    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
    const collapsedLib = page.locator('[data-testid="palette-icon-library"]')
    await expect(collapsedLib).toBeVisible()
    await expect(collapsedLib.locator('svg.lucide-square-function')).toBeVisible()
    await expect(collapsedLib.locator('svg.lucide-blocks')).toHaveCount(0)

    // 2. Expanded: FunctionSquare + the "Function Lib" label.
    await expandPalette(page)
    const expandedLib = page.locator('[data-testid="palette-blocks-library-button"]')
    await expect(expandedLib).toBeVisible()
    await expect(expandedLib.locator('svg.lucide-square-function')).toBeVisible()
    await expect(expandedLib).toContainText('Function Lib')
    await expect(expandedLib.locator('svg.lucide-blocks')).toHaveCount(0)
  })
})
