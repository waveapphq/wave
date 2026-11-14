/**
 * V-VARSET-VALUE-FIELD-OVERFLOW: Variable Setter string value field keeps a long
 * value inside its box instead of spilling onto its sibling controls.
 *
 * The Variable Setter row value is the inline one value field in the 880 px window:
 * name 189, type 100, secret 32, value box 357, expand 32, {x} 32, delete 32, 8 px
 * apart. A long string scrolls inside its bounded box and never pushes onto the
 * expand button, the {x} toggle or the trash button.
 *
 * Phase: no-data (parallel) - drops a Var Setter; no backend data needed.
 * Design Decisions: VARSET-7, VARSET-8, FIELD-16
 *
 * Pass Criteria:
 * 1. After typing a 60+ char string value into the row's value box
 *    (`param-input-varset-value-0`), the box keeps its 357 px width and the text is
 *    clipped inside it (the text is wider than the box).
 * 2. The value box's right edge does NOT overlap the expand button, and the expand
 *    button ends before the `{}` expression toggle.
 * 3. The value box's right edge stays inside the config sheet (no spill outside).
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'
import { cellBox } from '../../helpers/value-field'

const LONG_VALUE = '{{ s1 * 2 }} ' + 't'.repeat(60)
// The value column at the 880 px window (VARSET-8).
const VALUE_WIDTH = 357

async function dropVarSetterAndOpenConfig(page: Page): Promise<Locator> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'var setter', testId: 'palette-item-variable-setter' },
    { x: cb!.width / 2, y: cb!.height / 2 },
  )
  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function rightEdge(loc: Locator): Promise<number> {
  return loc.evaluate((el) => el.getBoundingClientRect().right)
}
async function leftEdge(loc: Locator): Promise<number> {
  return loc.evaluate((el) => el.getBoundingClientRect().left)
}

test.describe('V-VARSET-VALUE-FIELD-OVERFLOW: long string value truncates inside the setter row', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await waitForCanvasLoad(page)
  })

  test('S1: a long string value stays inside the value field, not onto the expand, {} toggle or trash', async ({
    page,
  }) => {
    const modal = await dropVarSetterAndOpenConfig(page)

    // Default row 0 is a string: type a long single-token value into its inline box.
    const input = modal.locator('input[data-testid="param-input-varset-value-0"]')
    await input.fill(LONG_VALUE)
    await expect(input).toHaveValue(LONG_VALUE)
    await modal.locator('[data-testid="varset-add-button"]').focus()

    const box = cellBox(modal, 'varset-value-0')
    await expect(box).toBeVisible()

    // (1) The box keeps its column width and the text is clipped inside it.
    const boxWidth = await box.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(boxWidth - VALUE_WIDTH), `value box is ${VALUE_WIDTH} px wide`).toBeLessThanOrEqual(1)
    const clipped = await input.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(clipped, 'the long value scrolls inside the box').toBe(true)

    // (2) The value box does not overlap the expand button, which ends before the `{}` toggle.
    const boxRight = await rightEdge(box)
    const expand = modal.locator('[data-testid="param-expand-varset-value-0"]')
    const expandLeft = await leftEdge(expand)
    expect(boxRight, 'value box must not spill onto the expand button').toBeLessThanOrEqual(expandLeft + 1)
    const toggleLeft = await leftEdge(modal.locator('[data-testid="varset-expression-toggle-0"]'))
    expect(await rightEdge(expand), 'expand button must not spill onto the {} toggle').toBeLessThanOrEqual(toggleLeft + 1)

    // (3) The value box stays inside the config sheet (no spill outside the modal).
    const modalRight = await rightEdge(modal)
    expect(boxRight).toBeLessThanOrEqual(modalRight + 1)
  })
})
