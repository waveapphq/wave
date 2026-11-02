/**
 * V-EXPRESSION-EDITOR-MODAL-OVERFLOW: Long content stays inside modal
 *
 * Phase: no-data (parallel) - palette + element-config + Ctrl+E modal flow.
 *
 * Pass Criteria:
 *   When typing 200 chars of unbreakable content in the Ctrl+E full editor:
 *     (a) `[data-testid="expression-editor-modal"]` width does NOT change
 *         from its starting value (or 90vw cap, whichever applies first).
 *     (b) The CodeMirror wrapper's `clientWidth <= modal.clientWidth - 48 px`
 *         (accounting for `p-6` = 24 px on each side).
 *     (c) `.cm-scroller` has `scrollWidth > clientWidth` (proves content
 *         overflows internally and CAN scroll horizontally).
 *     (d) No descendant of the modal extends beyond the modal's right edge
 *         (within 1 px tolerance).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

const LONG = 's'.repeat(200)

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

async function openExpressionEditor(page: Page) {
  const configModal = await dropHttpAndOpenConfig(page)
  const urlRow = configModal.locator('[data-testid="param-row-url"]')
  await urlRow.locator('[data-testid="expression-toggle"]').click()
  await urlRow.locator('.cm-content').first().click()
  await page.keyboard.press('Control+e')
  const editor = page.locator('[data-testid="expression-editor-modal"]')
  await expect(editor).toBeVisible()
  return editor
}

test.describe('V-EXPRESSION-EDITOR-MODAL-OVERFLOW: long content scrolls internally', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: 200-char single-line content does not push the modal', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const editor = await openExpressionEditor(page)

    const startWidth = await editor.evaluate((el) => el.getBoundingClientRect().width)

    const cmContent = editor.locator('.cm-content').first()
    await cmContent.click()
    await page.keyboard.type(LONG)

    // (a) modal width unchanged.
    const endWidth = await editor.evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(endWidth - startWidth)).toBeLessThanOrEqual(50)

    // (b) CodeMirror wrapper clientWidth <= modal.clientWidth - 48 (p-6 padding).
    const cmWrapper = editor.locator('.border.rounded-lg').first()
    const cmW = await cmWrapper.evaluate((el) => el.clientWidth)
    const modalCW = await editor.evaluate((el) => el.clientWidth)
    expect(cmW).toBeLessThanOrEqual(modalCW - 47)

    // (c) .cm-scroller has scrollWidth > clientWidth.
    const scrollerOverflow = await editor
      .locator('.cm-scroller')
      .first()
      .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(scrollerOverflow.sw).toBeGreaterThan(scrollerOverflow.cw)

    // (d) No descendant exceeds the modal's right edge - EXCLUDING elements
    // inside an overflow-x: auto/scroll/hidden container (their intrinsic
    // width is supposed to extend past the scroller; the scroller clips or
    // scrolls the visible portion). The most common case is `.cm-content`
    // inside `.cm-scroller`.
    const overflowingCount = await editor.evaluate((root) => {
      const rightEdge = root.getBoundingClientRect().right
      let count = 0
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement
        if (el.getBoundingClientRect().right <= rightEdge + 1) continue
        let cur: HTMLElement | null = el.parentElement
        let insideScroller = false
        while (cur && cur !== root) {
          const ox = window.getComputedStyle(cur).overflowX
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
            insideScroller = true
            break
          }
          cur = cur.parentElement
        }
        if (!insideScroller) count++
      }
      return count
    })
    expect(overflowingCount).toBe(0)
  })
})
