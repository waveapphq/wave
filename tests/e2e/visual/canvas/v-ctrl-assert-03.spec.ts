/**
 * V-CTRL-ASSERT-03: Assert Control - Expression Field Uses CodeMirror
 *
 * Validates that expression assertion rows use the CodeMirror-based
 * ExpressionField component (not a plain HTML input).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-03: Expression Uses CodeMirror', () => {
  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function addAssertAndOpenModal(page: Page) {
    await setupPalette(page)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('assert')
    await page.waitForTimeout(100)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'assert', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(300)

    // Select and open config
    const node = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    ).first()
    await node.locator('button').first().dispatchEvent('click')
    await expect(node).toHaveAttribute('data-selected', 'true')

    const gearButton = page.locator(
      '[data-testid="node-configure"]',
    )
    await gearButton.click()

    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  test('expression row renders CodeMirror editor', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    await test.step('Add an expression assertion', async () => {
      const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
      await addBtn.click()
      const exprOption = modal.locator('[data-testid="assert-add-expression"]')
      await expect(exprOption).toBeVisible()
      await exprOption.click()
      await page.waitForTimeout(100)
    })

    await test.step('Verify expression row contains CodeMirror (not plain input)', async () => {
      const exprWrapper = modal.locator('[data-testid="assert-expression-input-0"]')
      await expect(exprWrapper).toBeVisible()

      // CodeMirror renders a .cm-editor element
      const cmEditor = exprWrapper.locator('.cm-editor')
      await expect(cmEditor).toBeVisible()

      // There should be NO plain <input> element in the expression wrapper
      const plainInputs = exprWrapper.locator('input')
      await expect(plainInputs).toHaveCount(0)
    })

    await test.step('CodeMirror editor accepts typed text', async () => {
      const exprWrapper = modal.locator('[data-testid="assert-expression-input-0"]')
      const cmContent = exprWrapper.locator('.cm-content')

      // Click to focus
      await cmContent.click()
      // Type expression
      await page.keyboard.type('x > 5')

      // Verify text appears in the editor
      await expect(cmContent).toContainText('x > 5')
    })
  })
})
