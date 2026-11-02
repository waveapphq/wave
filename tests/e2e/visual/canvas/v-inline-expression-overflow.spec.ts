/**
 * V-INLINE-EXPRESSION-OVERFLOW: Inline expression field overflow
 *
 * Phase: no-data (parallel) - palette + element-config interactions only.
 *
 * Pass Criteria:
 *   - Long inline expression: CodeMirror panel stays inside the row.
 *   - A horizontal scrollbar appears INSIDE the field (`.cm-scroller`).
 *   - The expression stays single-line (no line wrap).
 *   - The row's overall `scrollWidth` equals its `clientWidth` (overflow does
 *     not propagate to the row).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

const LONG = "'s' + " + "'s'+".repeat(50) + "'s'"

async function dropHttpAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', { x: cb!.width / 2, y: cb!.height / 2 })
  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await node.locator('button').first().dispatchEvent('click')
  await page
    .locator('[data-testid="node-configure"]')
    .click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-INLINE-EXPRESSION-OVERFLOW: long expression scrolls inside the field', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: long expression scrolls inside CodeMirror; row + modal stay bounded', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropHttpAndOpenConfig(page)
    const startModalWidth = await modal.evaluate(
      (el) => el.getBoundingClientRect().width,
    )

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.locator('[data-testid="expression-toggle"]').click()
    const cmContent = urlRow.locator('.cm-content').first()
    await expect(cmContent).toBeVisible()
    await cmContent.click()
    await page.keyboard.type(LONG)

    // .cm-scroller has overflow.
    const scroller = urlRow.locator('.cm-scroller').first()
    const scrollerOverflow = await scroller.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(scrollerOverflow.sw).toBeGreaterThan(scrollerOverflow.cw)

    // Row overflow is contained.
    const rowOverflow = await urlRow.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(rowOverflow.sw).toBe(rowOverflow.cw)

    // Modal width unchanged.
    const endModalWidth = await modal.evaluate(
      (el) => el.getBoundingClientRect().width,
    )
    expect(Math.abs(endModalWidth - startModalWidth)).toBeLessThanOrEqual(50)

    // Single-line: only one .cm-line element should be in the editor (the
    // single-line extension strips newlines, so even paste keeps one line).
    const lineCount = await urlRow.locator('.cm-line').count()
    expect(lineCount).toBe(1)
  })
})
