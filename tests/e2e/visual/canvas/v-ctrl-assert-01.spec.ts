/**
 * V-CTRL-ASSERT-01: Assert Control - AND/OR Toggle Per-Pair
 *
 * Validates that the Assert control's AND/OR toggles between assertion rows
 * operate independently (per-pair), not as a global group operator.
 *
 * Test Scenarios:
 * 1. Add 3 assertions, verify all show AND by default
 * 2. Click the first AND toggle - it changes to OR, second stays AND
 * 3. Click the second AND toggle - both are now OR independently
 * 4. Click the first OR toggle back to AND - only first changes
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-ASSERT-01: Assert AND/OR Per-Pair Toggle', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function addAssertNode(page: Page) {
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'assert', {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    })
  }

  async function openConfigModal(page: Page) {
    // Select the assert node
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]',
    )
    const assertNode = workflowNodes.first()
    await assertNode.locator('button').first().dispatchEvent('click')
    await expect(assertNode).toHaveAttribute('data-selected', 'true')

    // Click gear button to open config modal
    const gearButton = page.locator(
      '[data-testid="node-configure"]',
    )
    await gearButton.click()

    // Wait for modal
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  async function addLiteralAssertion(modal: import('@playwright/test').Locator) {
    const page = modal.page()

    // Click "Add Assertion" button
    const addBtn = modal.locator('[data-testid="assert-add-assertion"]')
    await addBtn.click()

    // Click "Literal" in the popup
    const literalOption = modal.locator('[data-testid="assert-add-literal"]')
    await expect(literalOption).toBeVisible()
    await literalOption.click()

    // Wait for the popup to close
    await page.waitForTimeout(100)
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  test('per-pair AND/OR toggles operate independently', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Drop Assert control on canvas and open config', async () => {
      await addAssertNode(page)
    })

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Add 3 literal assertions', async () => {
      await addLiteralAssertion(modal)
      await addLiteralAssertion(modal)
      await addLiteralAssertion(modal)

      // Verify 3 rows exist
      const rows = modal.locator('[data-testid^="assert-row-"]')
      await expect(rows).toHaveCount(3)
    })

    await test.step('Verify both AND/OR toggles show AND by default', async () => {
      const toggle1 = modal.locator('[data-testid="assert-operator-toggle-root-1"]')
      const toggle2 = modal.locator('[data-testid="assert-operator-toggle-root-2"]')

      await expect(toggle1).toBeVisible()
      await expect(toggle2).toBeVisible()
      await expect(toggle1).toContainText('AND')
      await expect(toggle2).toContainText('AND')
    })

    await test.step('Click first toggle - only it changes to OR', async () => {
      const toggle1 = modal.locator('[data-testid="assert-operator-toggle-root-1"]')
      const toggle2 = modal.locator('[data-testid="assert-operator-toggle-root-2"]')

      await toggle1.click()

      // First toggle should now show OR
      await expect(toggle1).toContainText('OR')
      // Second toggle should still show AND
      await expect(toggle2).toContainText('AND')
    })

    await test.step('Click second toggle - it changes to OR independently', async () => {
      const toggle1 = modal.locator('[data-testid="assert-operator-toggle-root-1"]')
      const toggle2 = modal.locator('[data-testid="assert-operator-toggle-root-2"]')

      await toggle2.click()

      // Both toggles now show OR, each set independently
      await expect(toggle1).toContainText('OR')
      await expect(toggle2).toContainText('OR')
    })

    await test.step('Click first toggle back to AND - only it changes', async () => {
      const toggle1 = modal.locator('[data-testid="assert-operator-toggle-root-1"]')
      const toggle2 = modal.locator('[data-testid="assert-operator-toggle-root-2"]')

      await toggle1.click()

      // First toggle back to AND
      await expect(toggle1).toContainText('AND')
      // Second toggle still OR
      await expect(toggle2).toContainText('OR')
    })
  })
})
