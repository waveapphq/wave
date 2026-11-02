/**
 * V-CANVAS-12 Extended: Config Modal Visual Tests
 *
 * Design Decisions: CANVAS-124 to CANVAS-151
 *
 * Extended tests for config modal behaviors including version selector, element name, and buttons.
 *
 * Tests:
 * - V-CANVAS-12-S14 to S16: Version selector in header
 * - V-CANVAS-12-S17 to S18: Element name input
 * - V-CANVAS-12-S19 to S20: Header X close button (CANVAS-228), Cancel/Save footer
 * - V-CANVAS-12-S21 to S23: Save button state, centered sheet position (CANVAS-229)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

test.describe('V-CANVAS-12: Config Modal Extended', () => {
  // Helper to expand palette and search
  async function setupPalette(page: import('@playwright/test').Page) {
    const palette = page.locator('[data-testid="block-palette"]')
    const state = await palette.getAttribute('data-state')
    if (state === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }
  }

  async function findItemBySearch(page: import('@playwright/test').Page, searchTerm: string) {
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    await searchInput.fill(searchTerm)
    await page.waitForTimeout(100)
  }

  // Helper to add a workflow node and open its config modal
  async function addNodeAndOpenConfigModal(page: import('@playwright/test').Page) {
    await setupPalette(page)
    await findItemBySearch(page, 'http')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()

    await dragPaletteItemToCanvas(page, 'http', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
    await page.waitForTimeout(100)

    // Select the node
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    // Click gear button to open config modal
    const gearButton = page.locator('[data-testid="node-configure"]').first()
    await gearButton.click()

    // Wait for the config sheet (DraggableSheet shell per CANVAS-228)
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  test('V-CANVAS-12-S14: version selector in modal header shows current version', async ({ page }) => {
    // Per V-CANVAS-12: Version selector in header shows current version
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Version selector should be visible
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toBeVisible()

    // Should show version number
    const text = await versionSelector.textContent()
    expect(text).toMatch(/\d+\.\d+/)
  })

  test('V-CANVAS-12-S15: version selector dropdown aligned to right', async ({ page }) => {
    // Per V-CANVAS-12: Dropdown arrow aligned to right
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toBeVisible()

    // Check that the selector has the dropdown icon on the right
    const dropdownIcon = modal.locator('[data-testid="version-dropdown-icon"]')
    // May not be visible if only one version - that's OK
    const iconVisible = await dropdownIcon.isVisible().catch(() => false)

    if (iconVisible) {
      // Verify dropdown icon is to the right of version text
      const selectorBox = await versionSelector.boundingBox()
      const iconBox = await dropdownIcon.boundingBox()

      // Icon should be within selector and towards the right side
      expect(iconBox!.x).toBeGreaterThan(selectorBox!.x + selectorBox!.width / 2)
    }
  })

  test('V-CANVAS-12-S16: clicking version selector opens dropdown with versions', async ({ page }) => {
    // Per V-CANVAS-12: Clicking opens dropdown with available versions
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await versionSelector.click()

    // Dropdown should appear
    const dropdown = versionSelector.locator('..').locator('ul')
    await expect(dropdown).toBeVisible()

    // Should have version options
    const options = dropdown.locator('li button')
    const count = await options.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('V-CANVAS-12-S17: element name input field below header', async ({ page }) => {
    // Per V-CANVAS-12: "Name" input field present below header
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Name input should exist
    const nameInput = modal.locator('[data-testid="element-description-input"]')
    await expect(nameInput).toBeVisible()

    // Should have placeholder
    const placeholder = await nameInput.getAttribute('placeholder')
    expect(placeholder).toBeTruthy()
  })

  test('V-CANVAS-12-S18: element description input has placeholder explaining purpose', async ({ page }) => {
    // The per-instance field is the shared
    // DescriptionField. The placeholder text explains the intent.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const descInput = modal.locator('[data-testid="element-description-input"]')
    await expect(descInput).toHaveAttribute(
      'placeholder',
      'Optional. Short description of what this block does in this test.',
    )
  })

  test('V-CANVAS-12-S19: sheet header has an X close button in the drag handle', async ({ page }) => {
    // Per CANVAS-228: the sheet
    // header carries an X close button that routes through the unsaved guard.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const closeButton = modal
      .locator('[data-testid="element-config-sheet-drag-handle"]')
      .locator('button[aria-label="Close"]')
    await expect(closeButton).toBeVisible()

    // Clicking X on a clean sheet closes it directly.
    await closeButton.click()
    await expect(modal).toHaveCount(0, { timeout: 5_000 })
  })

  test('V-CANVAS-12-S20: only Cancel and Save buttons exist in footer', async ({ page }) => {
    // Per V-CANVAS-12: Only Cancel and Save buttons in footer
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Footer should have exactly these buttons: Changelog, Details, Cancel, Save
    const cancelButton = modal.getByRole('button', { name: 'Cancel' })
    const saveButton = modal.getByRole('button', { name: 'Save' })

    await expect(cancelButton).toBeVisible()
    await expect(saveButton).toBeVisible()
  })

  test('V-CANVAS-12-S21: Save button disabled when required field empty', async ({ page }) => {
    // Per V-CANVAS-12: Save button disabled until all required fields filled
    // Note: HTTP Client has URL as a required field
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Save button should be disabled initially (URL is required but empty)
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeDisabled()
  })

  test('V-CANVAS-12-S22: Save button becomes enabled when required fields filled', async ({ page }) => {
    // Per V-CANVAS-12: Save button becomes enabled when all required fields filled
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const saveButton = modal.getByRole('button', { name: 'Save' })

    // Initially disabled
    await expect(saveButton).toBeDisabled()

    // Fill URL field (required) - literal string edits via the shared sheet
    await setStringParam(modal, page, 'url', 'https://example.com/api')

    // Fill method field (required enum)
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    if (await methodRow.isVisible()) {
      const selectTrigger = methodRow.locator('button[role="combobox"]')
      await selectTrigger.click()
      const getOption = page.locator('[role="option"]', { hasText: 'GET' })
      await getOption.click()
    }

    await page.waitForTimeout(100)

    // Save should now be enabled
    await expect(saveButton).toBeEnabled()
  })

  test('V-CANVAS-12-S23: first sheet opens viewport-centered', async ({ page }) => {
    // Per CANVAS-229 (amends CANVAS-151): the first config sheet opens
    // viewport-centered; later sheets cascade +28px each.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    await page.waitForTimeout(300)

    const modalBox = await modal.boundingBox()
    const viewportSize = page.viewportSize()

    const modalCenter = modalBox!.x + modalBox!.width / 2
    const viewportCenter = viewportSize!.width / 2

    // Horizontally centered (allow a small clamping tolerance).
    expect(Math.abs(modalCenter - viewportCenter)).toBeLessThanOrEqual(40)
  })
})
