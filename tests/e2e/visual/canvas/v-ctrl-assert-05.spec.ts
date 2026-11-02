/**
 * V-CTRL-ASSERT-05: Assert Control - Split Mode Canvas Handles
 *
 * Validates that toggling the Assert control to "Split" mode and saving
 * causes dual pass/fail output handles to appear on the canvas node.
 *
 * The node reads mode from config.values.mode, which only updates on Save.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-05: Split Mode Canvas Handles', () => {
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

    const assertItem = page.locator('[data-testid="palette-item-assert"]')
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

  test('split mode shows dual pass/fail handles after save', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Drop Assert - it defaults to SPLIT mode', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('assert')
      await page.waitForTimeout(100)

      const canvas = page.locator('[data-testid="workflow-canvas"]')
      const canvasBox = await canvas.boundingBox()
      await dragPaletteItemToCanvas(page, 'assert', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(300)

      // Default is split mode: pass + fail handles are present from the
      // first render.
      await expect(page.locator('[data-testid="handle-output-pass"]')).toBeVisible()
      await expect(page.locator('[data-testid="handle-output-fail"]')).toBeVisible()
    })

    const modal = await test.step('Open config modal (already in split mode)', async () => {
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
    })

    await test.step('Add a complete assertion so Save is enabled', async () => {
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

    await test.step('Save and close modal', async () => {
      const saveBtn = modal.locator('button:has-text("Save")')
      await expect(saveBtn).toBeEnabled()
      await saveBtn.click()
      // Modal should close after save
      await expect(modal).not.toBeVisible()
    })

    await test.step('Verify dual pass/fail handles appear on canvas node', async () => {
      const passHandle = page.locator('[data-testid="handle-output-pass"]')
      const failHandle = page.locator('[data-testid="handle-output-fail"]')

      await expect(passHandle).toBeVisible()
      await expect(failHandle).toBeVisible()
    })

    await test.step('Re-open modal, switch back to single, save', async () => {
      // Click node to select
      const node = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      ).first()
      await node.locator('button').first().dispatchEvent('click')
      await expect(node).toHaveAttribute('data-selected', 'true')

      const gearButton = page.locator(
        '[data-testid="node-configure"]',
      )
      await gearButton.click()

      const modal2 = configSheet(page)
      await expect(modal2).toBeVisible()

      // Switch back to single mode
      const singleRadio = modal2.locator('#mode-single')
      await singleRadio.click()

      // Save
      const saveBtn = modal2.locator('button:has-text("Save")')
      await expect(saveBtn).toBeEnabled()
      await saveBtn.click()
      await expect(modal2).not.toBeVisible()
    })

    await test.step('Verify pass/fail handles are gone (back to single)', async () => {
      const passHandle = page.locator('[data-testid="handle-output-pass"]')
      const failHandle = page.locator('[data-testid="handle-output-fail"]')

      await expect(passHandle).toHaveCount(0)
      await expect(failHandle).toHaveCount(0)
    })
  })
})
