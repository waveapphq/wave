/**
 * V-CTRL-ASSERT-04: Assert Control - Save Button Enabled
 *
 * Validates that the Save button in the Assert config modal is enabled
 * when assertions are configured (not always disabled).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-04: Save Button Enabled', () => {
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

  test('save button is enabled after adding an assertion', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    await test.step('Add a complete assertion', async () => {
      // A literal row would need a variable to pick and the draft canvas
      // declares none; an unfinished row is what blocks Save.
      const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
      await addBtn.click()
      const expressionOption = modal.locator('[data-testid="assert-add-expression"]')
      await expect(expressionOption).toBeVisible()
      await expressionOption.click()

      const editor = modal.locator('[data-testid^="assert-expression-input-"] .cm-content').last()
      await expect(editor).toBeVisible()
      await editor.click()
      await page.keyboard.type('1 == 1')
      await page.keyboard.press('Escape')
    })

    await test.step('Save button should be enabled (not disabled)', async () => {
      const saveBtn = modal.locator('button:has-text("Save")')
      await expect(saveBtn).toBeVisible()
      await expect(saveBtn).toBeEnabled()
    })
  })
})
