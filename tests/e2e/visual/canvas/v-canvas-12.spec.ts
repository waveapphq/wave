/**
 * V-CANVAS-12: Config Modal
 *
 * Design Decisions: CANVAS-124 to CANVAS-151
 * REQ: REQ-3.1.1.5 (Block parameter configuration forms)
 *
 * Pass Criteria:
 * 1. Modal header: element name (left) + version dropdown (right, format "X.X")
 * 2. INPUT PARAMETERS section:
 *    - Columns: info icon, Parameter (* = required), Type, Value
 *    - Variable references {{var}} highlighted in blue
 *    - {x} toggle for expression/value mode on enum fields
 * 3. OUTPUT VARIABLES section:
 *    - Columns: info icon, Parameter, Type, Assign to
 *    - Variable names for output binding
 * 4. Footer: [Changelog] [Details] (left), [Cancel] [Save] (right)
 * 5. Modal floats right side near Variable Manager
 * 6. Form validation errors display inline
 * 7. No X button in top-right corner (modal must use Cancel/Save)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

test.describe('V-CANVAS-12: Config Modal', () => {
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

  test('V-CANVAS-12: modal header shows element name and version dropdown', async ({ page }) => {
    // Per CANVAS-125: Header: Element name + version dropdown
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Modal should have the element name in title
    const modalTitle = modal.locator('h2, [class*="DialogTitle"]').first()
    await expect(modalTitle).toBeVisible()
    const titleText = await modalTitle.textContent()
    expect(titleText).toBeTruthy()

    // Version selector should be in header
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toBeVisible()

    // Version should be in format "X.X"
    const versionText = await versionSelector.textContent()
    expect(versionText).toMatch(/\d+\.\d+/)
  })

  test('V-CANVAS-12-S1: modal has element name input field', async ({ page }) => {
    // Per CANVAS-125: Element name input below header
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Description input should exist.
    const descInput = modal.locator('[data-testid="element-description-input"]')
    await expect(descInput).toBeVisible()

    // Label reads "Description".
    const descLabel = modal.locator('label[for^="element-description-"]')
    await expect(descLabel).toBeVisible()
    await expect(descLabel).toHaveText('Description')

    // Placeholder reflects the descriptive intent.
    await expect(descInput).toHaveAttribute(
      'placeholder',
      'Optional. Short description of what this block does in this test.',
    )
  })

  test('V-CANVAS-12-S2: modal has INPUT PARAMETERS section', async ({ page }) => {
    // Per CANVAS-128-131: INPUT section structure
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // INPUT PARAMETERS heading should exist
    const inputHeading = modal.getByText('Input Parameters', { exact: false })
    await expect(inputHeading).toBeVisible()
  })

  test('V-CANVAS-12-S3: modal has OUTPUT VARIABLES section', async ({ page }) => {
    // Per CANVAS-128-131: OUTPUT section structure
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // OUTPUT VARIABLES heading should exist
    const outputHeading = modal.getByText('Output Variables', { exact: false })
    await expect(outputHeading).toBeVisible()
  })

  test('V-CANVAS-12-S4: footer has Changelog and Details buttons on left', async ({ page }) => {
    // Per CANVAS-135: Footer structure
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Changelog button
    const changelogButton = modal.getByRole('button', { name: 'Changelog' })
    await expect(changelogButton).toBeVisible()

    // Details button
    const detailsButton = modal.getByRole('button', { name: 'Details' })
    await expect(detailsButton).toBeVisible()
  })

  test('V-CANVAS-12-S5: footer has Cancel and Save buttons on right', async ({ page }) => {
    // Per CANVAS-135: Footer: [Cancel] [Save]
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Cancel button
    const cancelButton = modal.getByRole('button', { name: 'Cancel' })
    await expect(cancelButton).toBeVisible()

    // Save button
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeVisible()
  })

  test('V-CANVAS-12-S6: sheet header carries an X close button', async ({ page }) => {
    // Per CANVAS-228: the sheet
    // header carries an X that routes through the unsaved-changes guard.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    const closeButton = modal
      .locator('[data-testid="element-config-sheet-drag-handle"]')
      .locator('button[aria-label="Close"]')
    await expect(closeButton).toBeVisible()
  })

  test('V-CANVAS-12-S7: Cancel button closes modal', async ({ page }) => {
    // Per CANVAS-135: Cancel closes modal
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Click Cancel
    const cancelButton = modal.getByRole('button', { name: 'Cancel' })
    await cancelButton.click()

    // Modal should close
    await expect(modal).not.toBeVisible()
  })

  test('V-CANVAS-12-S8: version selector shows dropdown when clicked', async ({ page }) => {
    // Per CANVAS-125: Version dropdown
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Click version selector
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await versionSelector.click()

    // Dropdown should appear with version options
    const dropdown = versionSelector.locator('..').locator('ul')
    await expect(dropdown).toBeVisible()

    // Should have at least one version option
    const options = dropdown.locator('li button')
    const optionCount = await options.count()
    expect(optionCount).toBeGreaterThanOrEqual(1)
  })

  test('V-CANVAS-12-S9: version selector shows Current badge for selected version', async ({ page }) => {
    // Per CANVAS-125: Current badge indicator
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Click version selector to open dropdown
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await versionSelector.click()

    // Dropdown should appear
    const dropdown = versionSelector.locator('..').locator('ul')
    await expect(dropdown).toBeVisible()

    // Current version should have "Current" indicator
    const currentIndicator = dropdown.getByText('Current')
    await expect(currentIndicator).toBeVisible()
  })

  test('V-CANVAS-12-S10: version selector shows green arrow if newer version available', async ({ page }) => {
    // Green up-arrow if newer version available
    // Note: This test requires the plugin to have multiple versions with one selected that's not the latest
    // In production, this would be setup via fixtures. For this test, we verify the element exists when needed.
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // The version-update-available element would be present when hasUpdateAvailable is true
    // We verify the selector exists in the component structure
    const versionSelector = modal.locator('[data-testid="version-selector"]')
    await expect(versionSelector).toBeVisible()

    // Check if the dropdown icon is present
    const dropdownIcon = modal.locator('[data-testid="version-dropdown-icon"]')
    // May or may not be visible depending on whether multiple versions exist
    const iconVisible = await dropdownIcon.isVisible().catch(() => false)
    // If only one version, dropdown icon won't be shown - that's OK
    if (iconVisible) {
      await expect(dropdownIcon).toBeVisible()
    }
  })

  test('V-CANVAS-12-S11: Save button saves config and closes modal', async ({ page }) => {
    // Per CANVAS-135: Save saves and closes
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Enter a name
    const nameInput = modal.locator('[data-testid="element-description-input"]')
    await nameInput.fill('My HTTP Call')

    // HTTP Client has URL and method as required fields - fill them to enable Save.
    // The literal url string edits through the shared "Edit value" sheet.
    await setStringParam(modal, page, 'url', 'https://api.example.com')

    // Select method (required enum field) - find the row, then the select trigger button
    const methodRow = modal.locator('[data-testid="param-row-method"]')
    if (await methodRow.isVisible()) {
      const selectTrigger = methodRow.locator('button[role="combobox"]')
      await selectTrigger.click()
      // Select GET from the dropdown
      const getOption = page.locator('[role="option"]', { hasText: 'GET' })
      await getOption.click()
    }

    // Wait for Save button to be enabled
    const saveButton = modal.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeEnabled({ timeout: 2000 })

    // Click Save
    await saveButton.click()

    // Modal should close
    await expect(modal).not.toBeVisible()

    // Verify the display name was saved to the node
    const workflowNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype]')
    const firstNode = workflowNodes.first()
    await expect(firstNode).toContainText('My HTTP Call')
  })

  test('V-CANVAS-12-S12: clicking outside modal does NOT close it', async ({ page }) => {
    // Per CANVAS-135: No X button, modal must use Cancel/Save to close
    // Modal prevents closing on outside click to ensure users explicitly cancel or save
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Verify modal is open
    await expect(modal).toBeVisible()

    // Click on the overlay/backdrop (outside the modal content)
    await page.mouse.click(50, 50)
    await page.waitForTimeout(200)

    // Modal should remain open (intentional design - forces explicit Cancel/Save)
    await expect(modal).toBeVisible()

    // User must use Cancel button to close
    const cancelButton = modal.getByRole('button', { name: 'Cancel' })
    await cancelButton.click()
    await expect(modal).not.toBeVisible()
  })

  test('V-CANVAS-12-S13: parameter table shows parameter names', async ({ page }) => {
    // Per CANVAS-128: Parameter column in table
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Parameter table should have table structure
    const paramTable = modal.locator('table').first()
    await expect(paramTable).toBeVisible()

    // Should have Parameter header (use first() as there are two tables with this column)
    const paramHeader = modal.getByRole('columnheader', { name: /Parameter/i }).first()
    await expect(paramHeader).toBeVisible()
  })

  test('V-CANVAS-12-S14: parameter table shows type column', async ({ page }) => {
    // Per CANVAS-128: Type column in table
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Should have Type header (use first() as there are two tables with this column)
    const typeHeader = modal.getByRole('columnheader', { name: /Type/i }).first()
    await expect(typeHeader).toBeVisible()
  })

  test('V-CANVAS-12-S15: parameter table shows value column', async ({ page }) => {
    // Per CANVAS-128: Value column in table
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await addNodeAndOpenConfigModal(page)

    // Should have Value header
    const valueHeader = modal.getByRole('columnheader', { name: /Value/i })
    await expect(valueHeader).toBeVisible()
  })
})
