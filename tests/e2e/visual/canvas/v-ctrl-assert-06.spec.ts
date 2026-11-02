/**
 * V-CTRL-ASSERT-06: Assert Control - Group Move Up/Down
 *
 * Validates that groups in the assertion builder can be moved up and down
 * using the arrow buttons, just like individual assertion rows.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-06: Group Move Up/Down', () => {
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

  async function addLiteralAssertion(modal: import('@playwright/test').Locator) {
    const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
    await addBtn.click()
    const literalOption = modal.locator('[data-testid="assert-add-literal"]')
    await expect(literalOption).toBeVisible()
    await literalOption.click()
    await modal.page().waitForTimeout(100)
  }

  async function addGroup(modal: import('@playwright/test').Locator) {
    const addGroupBtn = modal.locator('[data-testid="assert-add-group"]')
    await addGroupBtn.click()
    await modal.page().waitForTimeout(100)
  }

  test('groups can be moved up and down with arrow buttons', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    await test.step('Add a literal assertion, then a group, then another literal', async () => {
      await addLiteralAssertion(modal)
      await addGroup(modal)
      await addLiteralAssertion(modal)

      // Verify we have 3 items: literal at [0], group at [1], literal at [2]
      const rows = modal.locator('[data-testid^="assert-row-"]')
      await expect(rows).toHaveCount(2) // Two literal rows
      // Group container uses border-dashed class - unique to group containers
      const groups = modal.locator('.border-dashed[data-testid^="assert-group-"]')
      await expect(groups).toHaveCount(1) // One group
    })

    let groupId: string
    await test.step('Find the group and verify its move buttons exist', async () => {
      const group = modal.locator('.border-dashed[data-testid^="assert-group-"]')
      const groupTestId = await group.getAttribute('data-testid')
      groupId = groupTestId!.replace('assert-group-', '')

      // Move up and move down buttons should exist
      const moveUpBtn = modal.locator(`[data-testid="assert-group-move-up-${groupId}"]`)
      const moveDownBtn = modal.locator(`[data-testid="assert-group-move-down-${groupId}"]`)
      await expect(moveUpBtn).toBeVisible()
      await expect(moveDownBtn).toBeVisible()
    })

    await test.step('Group at index 1 - move up should be enabled, move down enabled', async () => {
      const moveUpBtn = modal.locator(`[data-testid="assert-group-move-up-${groupId}"]`)
      const moveDownBtn = modal.locator(`[data-testid="assert-group-move-down-${groupId}"]`)
      await expect(moveUpBtn).toBeEnabled()
      await expect(moveDownBtn).toBeEnabled()
    })

    await test.step('Move group up - it becomes first item', async () => {
      const moveUpBtn = modal.locator(`[data-testid="assert-group-move-up-${groupId}"]`)
      await moveUpBtn.click()
      await page.waitForTimeout(100)

      // After moving up, the group should be first (index 0)
      // The assertion builder's first child should be the group
      const builder = modal.locator('[data-testid="assertion-builder-root"]')
      const firstChild = builder.locator('> .space-y-1 > div').first()
      const groupInFirst = firstChild.locator(`[data-testid="assert-group-${groupId}"]`)
      await expect(groupInFirst).toBeVisible()

      // Move up should now be disabled (already at top)
      const moveUpBtnAfter = modal.locator(`[data-testid="assert-group-move-up-${groupId}"]`)
      await expect(moveUpBtnAfter).toBeDisabled()
    })

    await test.step('Move group down twice - it becomes last item', async () => {
      const moveDownBtn = modal.locator(`[data-testid="assert-group-move-down-${groupId}"]`)
      await moveDownBtn.click()
      await page.waitForTimeout(100)
      await moveDownBtn.click()
      await page.waitForTimeout(100)

      // After moving down twice from index 0, it should be at index 2 (last)
      // Move down should now be disabled (already at bottom)
      const moveDownBtnAfter = modal.locator(`[data-testid="assert-group-move-down-${groupId}"]`)
      await expect(moveDownBtnAfter).toBeDisabled()
    })
  })
})
