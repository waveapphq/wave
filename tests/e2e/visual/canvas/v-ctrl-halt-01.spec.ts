/**
 * V-CTRL-HALT-01: Halt Control - Visual Tests
 *
 * Validates the Halt control's palette presence, canvas rendering,
 * no-output-handle behavior (dead-end node), config modal parameters,
 * and metadata display.
 *
 * Scenarios:
 * S1 - Palette search and canvas drop
 * S2 - No output handle (halt is a dead-end)
 * S3 - Config modal shows scope, status, message parameters
 * S4 - Version and metadata display (changelog + details)
 *
 * REQ: REQ-3.5.1.4 (Halt block), REQ-3.5.1.14 (Halt scope configuration)
 *
 * Pass Criteria:
 * 1. Halt appears in palette search and can be dragged to canvas
 * 2. Halt node renders with OctagonX icon and "Halt" label
 * 3. Halt node has NO output handle (dead-end, terminating node)
 * 4. Config modal shows scope dropdown (test/suite/regression)
 * 5. Config modal shows status dropdown (passed/failed/skipped)
 * 6. Config modal shows message text field
 * 7. Version 1.0.0 displayed with changelog and details
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CTRL-HALT-01: Halt Control', () => {
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

  async function addHaltNode(page: Page) {
    await setupPalette(page)

    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill('halt')
    await page.waitForTimeout(100)

    const haltItem = page.locator('[data-testid="palette-item-halt"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'halt', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
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
  // S1: Halt appears in palette and can be dropped on canvas
  // ---------------------------------------------------------------------------

  test('S1: palette search and canvas drop', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    await test.step('Search for "halt" in palette and find Halt item', async () => {
      await setupPalette(page)
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('halt')
      await page.waitForTimeout(100)

      const haltItem = page.locator('[data-testid="palette-item-halt"]')
      await expect(haltItem).toBeVisible()
    })

    await test.step('Drag Halt onto canvas', async () => {
      const haltItem = page.locator('[data-testid="palette-item-halt"]')
      const canvas = page.locator('[data-testid="workflow-canvas"]')
      const canvasBox = await canvas.boundingBox()

      await dragPaletteItemToCanvas(page, 'halt', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(300)
    })

    await test.step('Verify node appears with OctagonX icon and Halt label', async () => {
      const workflowNodes = page.locator(
        '[data-testid^="workflow-node-"][data-nodetype]',
      )
      await expect(workflowNodes.first()).toBeVisible()

      // Verify the icon has the octagon-x data-icon attribute
      const icon = workflowNodes.first().locator('[data-testid="workflow-node-icon"]')
      await expect(icon).toHaveAttribute('data-icon', 'octagon-x')

      // Verify the label text
      await expect(workflowNodes.first()).toContainText('Halt')
    })
  })

  // ---------------------------------------------------------------------------
  // S2: Halt node has NO output handle (dead-end)
  // ---------------------------------------------------------------------------

  test('S2: no output handle on halt node', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addHaltNode(page)

    await test.step('Verify halt node has input handle (top)', async () => {
      // Halt should still accept incoming connections
      const inputHandle = page.locator('[data-testid="handle-input"]')
      await expect(inputHandle).toBeVisible()
    })

    await test.step('Verify halt node has NO output handle (bottom)', async () => {
      // Halt is a dead-end - no default output handle
      const defaultHandle = page.locator('[data-testid="handle-output"]')
      await expect(defaultHandle).not.toBeVisible()

      // No branch output handles either
      const branchHandles = page.locator('[data-testid^="handle-output-"]')
      await expect(branchHandles).toHaveCount(0)
    })
  })

  // ---------------------------------------------------------------------------
  // S3: Config modal shows scope, status, message parameters
  // ---------------------------------------------------------------------------

  test('S3: config modal with scope, status, and message parameters', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await addHaltNode(page)

    const modal = await test.step('Open config modal', async () => {
      return await openConfigModal(page)
    })

    await test.step('Verify modal title is "Edit Config"', async () => {
      const title = modal.locator('[class*="DialogTitle"], h2').first()
      await expect(title).toContainText('Edit Config')
    })

    await test.step('Verify scope parameter row exists', async () => {
      const scopeRow = modal.locator('[data-testid="param-row-scope"]')
      await expect(scopeRow).toBeVisible()
      // Scope label should be visible
      await expect(scopeRow).toContainText('Scope')
    })

    await test.step('Verify status parameter row exists', async () => {
      const statusRow = modal.locator('[data-testid="param-row-status"]')
      await expect(statusRow).toBeVisible()
      await expect(statusRow).toContainText('Status')
    })

    await test.step('Verify message parameter row exists', async () => {
      const messageRow = modal.locator('[data-testid="param-row-message"]')
      await expect(messageRow).toBeVisible()
      await expect(messageRow).toContainText('Message')
    })

    await test.step('Verify scope dropdown has default value "test"', async () => {
      const scopeRow = modal.locator('[data-testid="param-row-scope"]')
      // The Select component renders the current value in a button trigger
      await expect(scopeRow).toContainText('test')
    })

    await test.step('Verify status dropdown has default value "failed"', async () => {
      const statusRow = modal.locator('[data-testid="param-row-status"]')
      await expect(statusRow).toContainText('failed')
    })

    await test.step('Verify scope dropdown options', async () => {
      // Click the scope Select trigger to open dropdown
      const scopeRow = modal.locator('[data-testid="param-row-scope"]')
      const selectTrigger = scopeRow.locator('button[role="combobox"]')
      await selectTrigger.click()

      // Verify all scope options are available
      const options = page.locator('[role="option"]')
      await expect(options.filter({ hasText: 'test' })).toBeVisible()
      await expect(options.filter({ hasText: 'suite' })).toBeVisible()
      await expect(options.filter({ hasText: 'regression' })).toBeVisible()

      // Close dropdown by pressing Escape
      await page.keyboard.press('Escape')
    })

    await test.step('Verify status dropdown options', async () => {
      const statusRow = modal.locator('[data-testid="param-row-status"]')
      const selectTrigger = statusRow.locator('button[role="combobox"]')
      await selectTrigger.click()

      const options = page.locator('[role="option"]')
      await expect(options.filter({ hasText: 'passed' })).toBeVisible()
      await expect(options.filter({ hasText: 'failed' })).toBeVisible()
      await expect(options.filter({ hasText: 'skipped' })).toBeVisible()

      await page.keyboard.press('Escape')
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
    await addHaltNode(page)

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

      // Auto-naming labels the dropped node `Halt_N` so the dialog title
      // is `Halt_1 - Changelog`. Match the suffix.
      const changelogDialog = page.locator('[role="dialog"]').filter({ hasText: /Halt.* - Changelog/ })
      await expect(changelogDialog).toBeVisible()

      // Verify changelog entries from the Halt 1.0.0 metadata
      await expect(changelogDialog).toContainText('configurable scope')

      // Close the changelog dialog
      await page.keyboard.press('Escape')
      await expect(changelogDialog).not.toBeVisible()
    })

    await test.step('Click Details button and verify content', async () => {
      const detailsBtn = modal.locator('button:has-text("Details")')
      await expect(detailsBtn).toBeVisible()
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').filter({ hasText: /Halt.* - Documentation/ })
      await expect(detailsDialog).toBeVisible()

      // Verify some details content from the Halt 1.0.0 metadata
      await expect(detailsDialog).toContainText('scope')
      await expect(detailsDialog).toContainText('status')

      // Close the details dialog
      await page.keyboard.press('Escape')
      await expect(detailsDialog).not.toBeVisible()
    })

    await test.step('Close config modal', async () => {
      await closeModalWithCancel(modal)
    })
  })
})
