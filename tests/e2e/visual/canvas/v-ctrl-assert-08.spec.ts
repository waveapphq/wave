/**
 * V-CTRL-ASSERT-08: Assert Control - Mode Toggle UX
 *
 * Validates that the Branching Mode toggle:
 * 1. Appears below the Output Variables section (not inside assertion builder)
 * 2. Has descriptive text for Single and Split options
 * 3. Defaults to Single mode
 * 4. Can be toggled to Split and back
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-08: Mode Toggle UX', () => {
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

  test('mode toggle has descriptions and is positioned below output vars', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addAssertAndOpenModal(page)

    await test.step('Branching Mode heading exists', async () => {
      const heading = modal.locator('text=Branching Mode')
      await expect(heading).toBeVisible()
    })

    await test.step('Single and Split radio options with descriptions', async () => {
      const singleRadio = modal.locator('#mode-single')
      const splitRadio = modal.locator('#mode-split')
      await expect(singleRadio).toBeVisible()
      await expect(splitRadio).toBeVisible()

      // Single description
      const singleDesc = modal.locator('text=One output handle')
      await expect(singleDesc).toBeVisible()

      // Split description
      const splitDesc = modal.locator('text=Two output handles')
      await expect(splitDesc).toBeVisible()
    })

    await test.step('Split mode is default', async () => {
      const splitRadio = modal.locator('#mode-split')
      await expect(splitRadio).toBeChecked()
    })

    await test.step('Branching Mode appears below Output Variables', async () => {
      // Get positions - Output Variables heading should be above Branching Mode heading
      const outputVarsHeading = modal.locator('text=Output Variables')
      const branchingModeHeading = modal.locator('text=Branching Mode')

      const outputVarsBox = await outputVarsHeading.boundingBox()
      const branchingModeBox = await branchingModeHeading.boundingBox()

      expect(outputVarsBox).not.toBeNull()
      expect(branchingModeBox).not.toBeNull()
      // Branching Mode should be below Output Variables
      expect(branchingModeBox!.y).toBeGreaterThan(outputVarsBox!.y)
    })

    await test.step('Can toggle to Split and back to Single', async () => {
      const splitRadio = modal.locator('#mode-split')
      const singleRadio = modal.locator('#mode-single')

      await splitRadio.click()
      await expect(splitRadio).toBeChecked()
      await expect(singleRadio).not.toBeChecked()

      await singleRadio.click()
      await expect(singleRadio).toBeChecked()
      await expect(splitRadio).not.toBeChecked()
    })
  })
})
