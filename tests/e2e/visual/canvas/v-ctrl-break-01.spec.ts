/**
 * V-CTRL-BREAK-01: Break Control - Visual Tests
 *
 * Validates the Break control's palette presence, canvas rendering,
 * config modal with target_loop parameter, and metadata display.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - Standard sequential node (input + output handles)
 * S3 - Config modal shows target_loop parameter
 * S4 - Version and metadata display
 *
 * REQ: REQ-3.5.1.2
 *
 * Pass Criteria:
 * 1. Break appears in palette search and can be dragged to canvas
 * 2. Break node renders with LogOut icon (data-icon="log-out") and "Break" label
 * 3. Break node has input handle (top) AND output handle (bottom) - standard sequential
 * 4. Config modal shows target_loop parameter row
 * 5. Version 1.0.0 displayed with changelog and details
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-BREAK-01: Break Control', () => {
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

  async function addBreakNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('break')
    await page.waitForTimeout(100)

    const breakItem = page.locator('[data-testid="palette-item-break"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'break', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
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

  async function closeModalWithCancel(modal: import('@playwright/test').Locator) {
    const page = modal.page()
    const cancelBtn = modal.locator('button:has-text("Cancel")')
    await cancelBtn.click()

    // If unsaved changes dialog appears, discard
    const unsavedClose = page.getByTestId('unsaved-close')
    if (await unsavedClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await unsavedClose.click()
    }

    await expect(modal).not.toBeVisible()
  }

  // ---------------------------------------------------------------------------
  // S1: Break appears in palette and can be dropped on canvas
  // ---------------------------------------------------------------------------

  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "break" in palette and find Break item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('break')
      await page.waitForTimeout(100)

      const breakItem = page.locator('[data-testid="palette-item-break"]')
      await expect(breakItem).toBeVisible()
    })

    await test.step('Drag Break onto canvas', async () => {
      const breakItem = page.locator('[data-testid="palette-item-break"]')
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      const canvasBox = await canvas.boundingBox()

      await dragPaletteItemToCanvas(page, 'break', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(300)
    })

    await test.step('Verify node appears with LogOut icon and Break label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()

      // Verify the icon has the log-out data-icon attribute
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'log-out')

      // Verify the label text
      await expect(workflowNodes.first()).toContainText('Break')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Break node has input AND output handles (standard sequential)
  // ---------------------------------------------------------------------------

  test('S2: standard sequential handles', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addBreakNode(page)

    await test.step('Verify break node has input handle (top)', async () => {
      // Break should accept incoming connections
      const inputHandle = page.locator('[data-testid="handle-input"]')
      await expect(inputHandle).toBeVisible()
    })

    await test.step('Verify break node has output handle (bottom)', async () => {
      // Break is a standard sequential node - it has a default output handle
      const defaultHandle = page.locator('[data-testid="handle-output"]')
      await expect(defaultHandle).toBeVisible()

      // No branch output handles
      const branchHandles = page.locator('[data-testid^="handle-output-"]')
      await expect(branchHandles).toHaveCount(0)
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Config modal shows target_loop parameter
  // ---------------------------------------------------------------------------

  test('S3: config modal with target_loop parameter', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addBreakNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify modal title is "Edit Config"', async () => {
      const title = modal.locator('[class*="DialogTitle"], h2').first()
      await expect(title).toContainText('Edit Config')
    })

    await test.step('Verify Target Loop selector exists', async () => {
      // Break/Continue uses LoopTargetSelector instead of standard param rows
      await expect(modal.locator('text=Target Loop')).toBeVisible()
    })

    await test.step('Close modal with Cancel', async () => {
      await closeModalWithCancel(modal)
    })
  })

  // ---------------------------------------------------------------------------
  // S4: Version and metadata display
  // ---------------------------------------------------------------------------

  test('S4: version and metadata display', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addBreakNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify version shows "1.0.0"', async () => {
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toBeVisible()
      await expect(versionSelector).toContainText('1.0.0')
    })

    await test.step('Click Changelog button and verify content', async () => {
      const changelogBtn = modal.locator('button:has-text("Changelog")')
      await expect(changelogBtn).toBeVisible()
      await changelogBtn.click()

      // Auto-naming labels the dropped node `Break_N` so the dialog title
      // is `Break_1 - Changelog`. Match the unchanging `- Changelog` suffix.
      const changelogDialog = page.locator('[role="dialog"]').filter({ hasText: /Break.* - Changelog/ })
      await expect(changelogDialog).toBeVisible()

      // Close the changelog dialog
      await page.keyboard.press('Escape')
      await expect(changelogDialog).not.toBeVisible()
    })

    await test.step('Click Details button and verify content', async () => {
      const detailsBtn = modal.locator('button:has-text("Details")')
      await expect(detailsBtn).toBeVisible()
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').filter({ hasText: /Break.* - Documentation/ })
      await expect(detailsDialog).toBeVisible()

      // Close the details dialog
      await page.keyboard.press('Escape')
      await expect(detailsDialog).not.toBeVisible()
    })

    await test.step('Close config modal', async () => {
      await closeModalWithCancel(modal)
    })
  })
})
