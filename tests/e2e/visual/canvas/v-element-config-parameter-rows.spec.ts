/**
 * V-ELEMENT-CONFIG-PARAMETER-ROWS: Parameter row overflow + expression toggle
 *
 * Phase: no-data (parallel) - palette drag + element-config interactions, no fixture data.
 * Design Decisions: literal cell overflow, inline expression overflow, modal
 * title routing.
 *
 * Pass Criteria:
 *  1. A long literal URL is cut with an ellipsis inside the parameter row's value cell (the
 *     one value field, FIELD-1); the row width does NOT push the modal wider.
 *  2. Toggling the parameter to expression mode (`{}` button) swaps the literal
 *     cell for an `ExpressionField` (CodeMirror) that honors the same overflow
 *     contract: long expressions scroll horizontally inside the editor.
 *  3. The expression editor's parent value cell does not exceed the row's
 *     allocated width.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { setStringParam } from '../../helpers/param-config'

async function dropHttpAndOpenConfig(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', {
    x: canvasBox!.width / 2,
    y: canvasBox!.height / 2,
  })

  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')

  await page
    .locator('[data-testid="node-configure"]')
    .click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('V-ELEMENT-CONFIG-PARAMETER-ROWS: row overflow + expression toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: long URL literal stays bounded in the value cell, modal stays bounded', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropHttpAndOpenConfig(page)

    const startWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)

    const urlRow = modal.locator('[data-testid="param-row-url"]')

    // 200 unbreakable chars - guaranteed to overflow whatever the cell is.
    const longValue = 'https://very-long-host.example.com/' + 's'.repeat(200)
    await setStringParam(urlRow, page, 'url', longValue)

    // FIELD-1: the one value field cuts the long value with an ellipsis inside the cell instead of stretching it.
    const box = urlRow.locator('[data-slot="input-group"] input')
    await expect(box).toHaveValue(longValue)
    const cut = await box.evaluate((el) => ({
      overflow: getComputedStyle(el).textOverflow,
      wider: el.scrollWidth > el.clientWidth,
    }))
    expect(cut).toEqual({ overflow: 'ellipsis', wider: true })

    // Modal width unchanged. (Caps at the configured maxWidth.)
    const endWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endWidth - startWidth)).toBeLessThanOrEqual(50)

    // Row width does not extend beyond modal viewport.
    const rowRight = await urlRow.evaluate((el) => el.getBoundingClientRect().right)
    const modalRight = await modal.evaluate((el) => el.getBoundingClientRect().right)
    expect(rowRight).toBeLessThanOrEqual(modalRight + 1)
  })

  test('S2: {} toggle replaces literal with ExpressionField (CodeMirror)', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropHttpAndOpenConfig(page)

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    const exprToggle = urlRow.locator('[data-testid="expression-toggle"]')
    await exprToggle.click()

    // CodeMirror editor surface inside the row.
    const cmContent = urlRow.locator('.cm-content').first()
    await expect(cmContent).toBeVisible()
  })

  test('S3: long expression scrolls inside CodeMirror, row width unchanged', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropHttpAndOpenConfig(page)

    const urlRow = modal.locator('[data-testid="param-row-url"]')

    const startRowWidth = await urlRow.evaluate((el) => el.getBoundingClientRect().width)
    const startModalWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)

    await urlRow.locator('[data-testid="expression-toggle"]').click()

    const cmContent = urlRow.locator('.cm-content').first()
    await cmContent.click()
    await page.keyboard.type('s'.repeat(200))

    // Row + modal width preserved.
    const endRowWidth = await urlRow.evaluate((el) => el.getBoundingClientRect().width)
    const endModalWidth = await modal.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endRowWidth - startRowWidth)).toBeLessThanOrEqual(50)
    expect(Math.abs(endModalWidth - startModalWidth)).toBeLessThanOrEqual(50)

    // CodeMirror's scroller is internally scrollable.
    const cmScrollerOverflow = await urlRow
      .locator('.cm-scroller')
      .first()
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(cmScrollerOverflow.scrollWidth).toBeGreaterThan(cmScrollerOverflow.clientWidth)
  })
})
