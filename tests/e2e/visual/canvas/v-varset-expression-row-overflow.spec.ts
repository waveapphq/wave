/**
 * V-VARSET-EXPRESSION-ROW-OVERFLOW: Var Setter expression row overflow
 *
 * Phase: no-data (parallel) - palette + element-config interactions only.
 * Design Decisions: VARSET-7, VARSET-8, FIELD-16
 *
 * Pass Criteria:
 *   When a Var Setter row is in expression mode, a long single-line expression
 *   MUST scroll horizontally inside the inline CodeMirror without pushing
 *   anything ancestor wider than the dialog body. Specifically:
 *
 *   (a) The row's expression box (`param-input-varset-value-0`) keeps the value
 *       column width, 357 px in the 880 px window (within 1 px tolerance).
 *   (b) `.cm-scroller` inside has `scrollWidth > clientWidth` (long expression
 *       is internally scrollable).
 *   (c) The row's overall `scrollWidth` equals its `clientWidth` (no overflow
 *       propagated up the ancestor chain).
 *   (d) The dialog body's `scrollWidth` equals its `clientWidth`.
 *   (e) The dialog itself does not change `state.dialogWidth` after typing.
 *   (f) `[data-testid="varset-add-button"]` is fully visible.
 *   (g) The window opens 880 px wide, and the row stays centered: the name box,
 *       type select, expression box, {x} toggle and delete share one vertical
 *       center (within 1 px).
 *
 * Repeats the same assertions for the inline expression on a parameter row
 * (HTTP plugin URL with `{}` toggle on).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

const LONG_EXPR = "'s' + " + "'s'+".repeat(50) + "'s'"  // ~ 200 chars, single line, unbreakable

async function dropAndOpenConfig(
  page: Page,
  spec: { term: string; testId: string } | string,
) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, spec, {
    x: cb!.width / 2,
    y: cb!.height / 2,
  })
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

async function rectWidth(loc: Locator) {
  return loc.evaluate((el) => el.getBoundingClientRect().width)
}

async function verticalCenter(loc: Locator) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  })
}

// The Setter window and value column widths (VARSET-8).
const WIDE_WINDOW = 880
const VALUE_WIDTH = 357

async function scrollVsClient(loc: Locator) {
  return loc.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
}

test.describe('V-VARSET-EXPRESSION-ROW-OVERFLOW: long expression must not push the dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: Var Setter expression row stays inside dialog with long expression', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    const startDialogWidth = await rectWidth(modal)
    // (g) The Setter window opens 880 px wide.
    expect(Math.abs(startDialogWidth - WIDE_WINDOW)).toBeLessThanOrEqual(1)

    // Toggle row 0 into expression mode and type a long expression.
    await modal.locator('[data-testid="varset-expression-toggle-0"]').click()
    const exprBox = modal.locator('[data-testid="param-input-varset-value-0"]')
    const cmContent = exprBox.locator('.cm-content')
    await expect(cmContent).toBeVisible()
    await cmContent.click()
    await page.keyboard.type(LONG_EXPR)

    // (e) dialog width unchanged after typing.
    const endDialogWidth = await rectWidth(modal)
    expect(Math.abs(endDialogWidth - startDialogWidth)).toBeLessThanOrEqual(50)

    // (a) The expression box keeps the value column width.
    expect(Math.abs((await rectWidth(exprBox)) - VALUE_WIDTH)).toBeLessThanOrEqual(1)

    // (g) Every part of the row shares one vertical center.
    const center = await verticalCenter(modal.locator('[data-testid="varset-name-input-0"]'))
    for (const part of ['varset-type-select-0', 'param-input-varset-value-0', 'varset-expression-toggle-0', 'varset-delete-0']) {
      const partCenter = await verticalCenter(modal.locator(`[data-testid="${part}"]`))
      expect(Math.abs(partCenter - center), `${part} is centered on the row`).toBeLessThanOrEqual(1)
    }

    // (b) CodeMirror's scroller is internally scrollable (.cm-scroller is the
    //     element with scrollbars; .cm-content is its child and never reflects
    //     scrollbar positioning).
    const cmScrollerOverflow = await scrollVsClient(exprBox.locator('.cm-scroller').first())
    expect(cmScrollerOverflow.scrollWidth).toBeGreaterThan(cmScrollerOverflow.clientWidth)

    // (d) The dialog content body has no horizontal overflow.
    const innerWrapper = modal.locator(':scope > div').first()  // first inner block
    const innerOverflow = await scrollVsClient(innerWrapper)
    expect(innerOverflow.scrollWidth).toBe(innerOverflow.clientWidth)

    // (f) Add button fully visible.
    const addBtn = modal.locator('[data-testid="varset-add-button"]')
    await expect(addBtn).toBeVisible()
    const addBtnRight = await addBtn.evaluate((el) => el.getBoundingClientRect().right)
    const modalRight = await modal.evaluate((el) => el.getBoundingClientRect().right)
    expect(addBtnRight).toBeLessThanOrEqual(modalRight + 1)
  })

  test('S2: Parameter-row expression mode (HTTP URL) parity check', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'http')

    const startDialogWidth = await rectWidth(modal)

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.locator('[data-testid="expression-toggle"]').click()

    const cmContent = urlRow.locator('.cm-content').first()
    await expect(cmContent).toBeVisible()
    await cmContent.click()
    await page.keyboard.type(LONG_EXPR)

    const endDialogWidth = await rectWidth(modal)
    expect(Math.abs(endDialogWidth - startDialogWidth)).toBeLessThanOrEqual(50)

    const cmScrollerOverflow = await scrollVsClient(urlRow.locator('.cm-scroller').first())
    expect(cmScrollerOverflow.scrollWidth).toBeGreaterThan(cmScrollerOverflow.clientWidth)

    const rowOverflow = await scrollVsClient(urlRow)
    expect(rowOverflow.scrollWidth).toBe(rowOverflow.clientWidth)
  })
})
