/**
 * V-CTRL-ASSERT-02: Assert Control - Expression Row Alignment
 *
 * Validates that expression assertion rows are aligned with literal rows:
 * - Both row types span the full container width
 * - Action buttons (delete, move up/down) are right-aligned at the same position
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-02: Expression Row Alignment', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function setupPalette(page: Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function addAssertNode(page: Page) {
    await setupPalette(page)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('assert')
    await page.waitForTimeout(100)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'assert', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(300)
  }

  async function openConfigModal(page: Page) {
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    const node = workflowNodes.first()
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

  async function addLiteralAssertion(modal: import('@playwright/test').Locator) {
    const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
    await addBtn.click()
    const literalOption = modal.locator('[data-testid="assert-add-literal"]')
    await expect(literalOption).toBeVisible()
    await literalOption.click()
    await modal.page().waitForTimeout(100)
  }

  async function addExpressionAssertion(modal: import('@playwright/test').Locator) {
    const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
    await addBtn.click()
    const exprOption = modal.locator('[data-testid="assert-add-expression"]')
    await expect(exprOption).toBeVisible()
    await exprOption.click()
    await modal.page().waitForTimeout(100)
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  test('expression and literal rows have aligned action buttons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Setup assert control with mixed rows', async () => {
      await addAssertNode(page)
    })

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Add a literal then an expression assertion', async () => {
      await addLiteralAssertion(modal)
      await addExpressionAssertion(modal)

      // Verify both rows exist
      const rows = modal.locator('[data-testid^="assert-row-"]')
      await expect(rows).toHaveCount(2)
    })

    await test.step('Verify action buttons align between row types', async () => {
      // Get the delete button position for the literal row (rawIndex 0)
      // Expression is at rawIndex 2 (operator item sits at rawIndex 1 in the interleaved format)
      const literalDelete = modal.locator('[data-testid="assert-delete-0"]')
      const exprDelete = modal.locator('[data-testid="assert-delete-2"]')

      await expect(literalDelete).toBeVisible()
      await expect(exprDelete).toBeVisible()

      const litBox = await literalDelete.boundingBox()
      const exprBox = await exprDelete.boundingBox()

      expect(litBox, 'Literal delete button must be visible').not.toBeNull()
      expect(exprBox, 'Expression delete button must be visible').not.toBeNull()

      // Action buttons should be at the same horizontal position (within 2px tolerance)
      expect(
        Math.abs(litBox!.x - exprBox!.x),
        `Delete buttons should align: literal at x=${litBox!.x.toFixed(0)}, expression at x=${exprBox!.x.toFixed(0)}`,
      ).toBeLessThan(2)
    })

    await test.step('Both rows span the full container width', async () => {
      const row0 = modal.locator('[data-testid="assert-row-0"]')
      const row1 = modal.locator('[data-testid="assert-row-2"]')

      const box0 = await row0.boundingBox()
      const box1 = await row1.boundingBox()

      expect(box0, 'Literal row must be visible').not.toBeNull()
      expect(box1, 'Expression row must be visible').not.toBeNull()

      // Both rows should have the same width (within 2px tolerance)
      expect(
        Math.abs(box0!.width - box1!.width),
        `Row widths should match: literal=${box0!.width.toFixed(0)}, expression=${box1!.width.toFixed(0)}`,
      ).toBeLessThan(2)

      // Both rows should start at the same x position
      expect(
        Math.abs(box0!.x - box1!.x),
        `Row x positions should match: literal=${box0!.x.toFixed(0)}, expression=${box1!.x.toFixed(0)}`,
      ).toBeLessThan(2)
    })
  })
})
