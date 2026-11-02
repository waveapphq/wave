/**
 * V-CTRL-ASSERT-07: Assert Control - Move Assertions In/Out of Groups
 *
 * Validates that assertions can be moved across group boundaries using
 * up/down arrows:
 * - Moving up from top of group pops the item out above the group
 * - Moving down from bottom of group pops the item out below the group
 * - Moving down into a neighboring group inserts at the top
 * - Moving up into a neighboring group inserts at the bottom
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-07: Move Assertions In/Out of Groups', () => {
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

  async function addLiteralAtRoot(modal: import('@playwright/test').Locator) {
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

  async function addLiteralToGroup(
    modal: import('@playwright/test').Locator,
    groupId: string,
  ) {
    const addBtn = modal.locator(`[data-testid="assert-group-add-assertion-${groupId}"]`)
    await addBtn.click()
    const literalOption = modal.locator(`[data-testid="assert-group-add-literal-${groupId}"]`)
    await expect(literalOption).toBeVisible()
    await literalOption.click()
    await modal.page().waitForTimeout(100)
  }

  test('move assertion out of group via up arrow at top', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    // Build: [literal-A] [group containing literal-B]
    await addLiteralAtRoot(modal)
    await addGroup(modal)

    // Find the group's ID
    const group = modal.locator('.border-dashed[data-testid^="assert-group-"]')
    const groupTestId = await group.getAttribute('data-testid')
    const groupId = groupTestId!.replace('assert-group-', '')

    // Add a literal inside the group
    await addLiteralToGroup(modal, groupId)

    await test.step('Verify group has 1 child assertion', async () => {
      const groupRows = group.locator('[data-testid^="assert-row-"]')
      await expect(groupRows).toHaveCount(1)
    })

    await test.step('Move group child up - should pop out above group', async () => {
      // The child is at path [2, 0] (group is at root rawIndex 2 due to interleaved operator at 1)
      // Its move-up button testid: assert-move-up-2-0
      const moveUpBtn = modal.locator('[data-testid="assert-move-up-2-0"]')
      await moveUpBtn.click()
      await page.waitForTimeout(100)

      // Group should now be empty
      const groupRows = group.locator('[data-testid^="assert-row-"]')
      await expect(groupRows).toHaveCount(0)

      // Root level should now have 3 items: literal-A, literal-B (popped out), group (empty)
      const rootRows = modal.locator('[data-testid="assertion-builder-root"] > .space-y-1 > div > [data-testid^="assert-row-"]')
      await expect(rootRows).toHaveCount(2)
    })
  })

  test('move assertion into group via down arrow above group', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    // Build: [literal-A] [empty group]
    await addLiteralAtRoot(modal)
    await addGroup(modal)

    await test.step('Verify group starts empty', async () => {
      const group = modal.locator('.border-dashed[data-testid^="assert-group-"]')
      const groupRows = group.locator('[data-testid^="assert-row-"]')
      await expect(groupRows).toHaveCount(0)
    })

    await test.step('Move literal-A down - should enter the group', async () => {
      // literal-A is at root index 0, move down button: assert-move-down-0
      const moveDownBtn = modal.locator('[data-testid="assert-move-down-0"]')
      await moveDownBtn.click()
      await page.waitForTimeout(100)

      // Group should now have 1 child
      const group = modal.locator('.border-dashed[data-testid^="assert-group-"]')
      const groupRows = group.locator('[data-testid^="assert-row-"]')
      await expect(groupRows).toHaveCount(1)

      // Root level should have only the group (no standalone rows)
      const rootRows = modal.locator('[data-testid="assertion-builder-root"] > .space-y-1 > div > [data-testid^="assert-row-"]')
      await expect(rootRows).toHaveCount(0)
    })
  })
})
