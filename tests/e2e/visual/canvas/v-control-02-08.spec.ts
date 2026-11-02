/**
 * V-CONTROL-02-08: Control Configuration Modal - Version-Specific Behavior
 *
 * Design Decisions: CANVAS-97 through CANVAS-110
 * REQ: REQ-5.2.1.48, REQ-5.2.1.46
 *
 * Test Groups:
 * - V-CONTROL-02: Delay control element UI (metadata integrity)
 * - V-CONTROL-03: Version selector green arrow indicator
 * - V-CONTROL-04: Version selector single version behavior
 * - V-CONTROL-05: Changelog dialog layout and content
 * - V-CONTROL-06: Details dialog markdown rendering
 * - V-CONTROL-07: Version-specific parameters
 * - V-CONTROL-08: Initial version on canvas drop
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragPaletteItemToCanvas } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'

test.describe('V-CONTROL-02-08: Control Configuration Modal', () => {
  // No backend data needed - control metadata is hardcoded in frontend
  // Runs in parallel no-data phase

  // Helper to drop a control on canvas and select it
  async function dropControlAndSelect(
    page: import('@playwright/test').Page,
    controlId: string,
    searchTerm: string
  ) {
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    // controlId is the palette-item-<X> testid suffix; searchTerm is what
    // the user types into the palette filter (e.g. 'try' finds Try/Catch).
    // Pass both explicitly so the helper doesn't have to guess the mapping.
    await dragPaletteItemToCanvas(
      page,
      { term: searchTerm, testId: `palette-item-${controlId}` },
      { x: canvasBox!.width / 2, y: canvasBox!.height / 2 },
    )

    // Select the node
    const workflowNodes = page.locator(
      '[data-testid^="workflow-node-"][data-nodetype]'
    )
    const firstNode = workflowNodes.first()
    await firstNode.locator('button').first().dispatchEvent('click')
    await expect(firstNode).toHaveAttribute('data-selected', 'true')

    return firstNode
  }

  // Helper to open config modal for selected node
  async function openConfigModal(page: import('@playwright/test').Page) {
    const gearButton = page.locator(
      '[data-testid="node-configure"]'
    )
    await gearButton.click()
    const modal = configSheet(page)
    await expect(modal).toBeVisible()
    return modal
  }

  // ==========================================================================
  // V-CONTROL-02: Delay Control Element UI (Metadata Integrity)
  // ==========================================================================

  test.describe('V-CONTROL-02: Delay Control Element UI', () => {
    test('V-CONTROL-02-S2: If/Else has exactly 1 version', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'if-else', 'if')
      const modal = await openConfigModal(page)

      // Open version dropdown
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await versionSelector.click()
      const dropdown = versionSelector.locator('..').locator('ul')
      await expect(dropdown).toBeVisible()

      // Should have exactly 1 option
      const options = dropdown.locator('li button')
      await expect(options).toHaveCount(1)

      // Should be 1.0.0
      await expect(options.first()).toContainText('1.0.0')
    })

    test('V-CONTROL-02-S3: While has exactly 1 version', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'while', 'while')
      const modal = await openConfigModal(page)

      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await versionSelector.click()
      const dropdown = versionSelector.locator('..').locator('ul')
      await expect(dropdown).toBeVisible()

      const options = dropdown.locator('li button')
      await expect(options).toHaveCount(1)
      await expect(options.first()).toContainText('1.0.0')
    })
  })

  // ==========================================================================
  // V-CONTROL-03: Version Selector Green Arrow Indicator
  // ==========================================================================

  test.describe('V-CONTROL-03: Version Selector Green Arrow', () => {
    test('V-CONTROL-03-S1: No green arrow when on latest version (Delay at 1.0.0)', async ({
      page,
    }) => {
      // Delay is on its latest version, so no green arrow should appear
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Version selector should show 1.0.0
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toContainText('1.0.0')

      // No green arrow (version-update-available) should be visible
      const updateIndicator = modal.locator('[data-testid="version-update-available"]')
      await expect(updateIndicator).not.toBeVisible()
    })

    test('V-CONTROL-03-S3: No green arrow for single-version controls (Assert)', async ({
      page,
    }) => {
      // Assert has one version, which is also its latest
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'assert', 'assert')
      const modal = await openConfigModal(page)

      // No green arrow should appear since its only version is the latest
      const updateIndicator = modal.locator('[data-testid="version-update-available"]')
      await expect(updateIndicator).not.toBeVisible()
    })
  })

  // ==========================================================================
  // V-CONTROL-04: Version Selector Single Version Behavior
  // ==========================================================================

  test.describe('V-CONTROL-04: Version Selector Single Version Behavior', () => {
    test('V-CONTROL-04-S1: Dropdown opens even with single version', async ({ page }) => {
      // If/Else has only one version, but dropdown should still open
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'if-else', 'if')
      const modal = await openConfigModal(page)

      // Click version selector
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await versionSelector.click()

      // Dropdown should open
      const dropdown = versionSelector.locator('..').locator('ul')
      await expect(dropdown).toBeVisible()

      // Should show single version with "Current" badge
      const option = dropdown.locator('li button')
      await expect(option).toContainText('1.0.0')
      await expect(option).toContainText('Current')
    })

    test('V-CONTROL-04-S2: Dropdown arrow icon always visible', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'assert', 'assert')
      const modal = await openConfigModal(page)

      // Dropdown chevron icon should be visible
      const dropdownIcon = modal.locator('[data-testid="version-dropdown-icon"]')
      await expect(dropdownIcon).toBeVisible()
    })

    test('V-CONTROL-04-S4: No "Latest" label in dropdown (per wireframe)', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Open version dropdown
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await versionSelector.click()
      const dropdown = versionSelector.locator('..').locator('ul')
      await expect(dropdown).toBeVisible()

      // Should NOT contain "Latest" text anywhere
      const latestText = dropdown.getByText('Latest')
      await expect(latestText).not.toBeVisible()
    })
  })

  // ==========================================================================
  // V-CONTROL-05: Changelog Dialog Layout and Content
  // ==========================================================================

  test.describe('V-CONTROL-05: Changelog Dialog', () => {
    test('V-CONTROL-05-S1: Changelog dialog layout - no close button in footer', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Open changelog dialog
      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      // Wait for changelog dialog
      const changelogDialog = page.locator('[role="dialog"]').first() // Second dialog
      await expect(changelogDialog).toBeVisible()

      // Footer should NOT have a "Close" button (uses header 'x' only)
      const closeInFooter = changelogDialog.locator(
        'footer button, [class*="Footer"] button'
      )
      // Count buttons in footer area
      const footerButtons = await closeInFooter.count()
      // Should be 0 (no buttons in footer)
      expect(footerButtons).toBe(0)
    })

    test('V-CONTROL-05-S2: Version dropdown and release date on same row', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      // Version dropdown should be visible
      const versionText = changelogDialog.getByText('Version:')
      await expect(versionText).toBeVisible()

      // Release date should be visible
      const releasedText = changelogDialog.getByText(/Released:/)
      await expect(releasedText).toBeVisible()
    })

    test('V-CONTROL-05-S4: Production version changelog shows meaningful entries', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Open changelog (should be on 1.0.0 by default)
      const changelogBtn = modal.getByRole('button', { name: 'Changelog' })
      await changelogBtn.click()

      const changelogDialog = page.locator('[role="dialog"]').first()
      await expect(changelogDialog).toBeVisible()

      // Should show meaningful changelog entries for 1.0.0
      await expect(changelogDialog.getByText('Full implementation released')).toBeVisible()
      await expect(
        changelogDialog.getByText(/Duration input with seconds, minutes, hours/)
      ).toBeVisible()
      await expect(changelogDialog.getByText(/Async non-blocking execution/)).toBeVisible()
    })
  })

  // ==========================================================================
  // V-CONTROL-06: Details Dialog Markdown Rendering
  // ==========================================================================

  test.describe('V-CONTROL-06: Details Dialog', () => {
    test('V-CONTROL-06-S1: Details dialog layout - no close button in footer', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Open details dialog
      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      // Wait for details dialog
      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Title should indicate documentation
      await expect(detailsDialog.getByText(/Documentation/)).toBeVisible()
    })

    test('V-CONTROL-06-S2: Details dialog shows version badge', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Version badge should be visible
      const versionBadge = detailsDialog.getByText('1.0.0')
      await expect(versionBadge).toBeVisible()
    })

    test('V-CONTROL-06-S3: Markdown bold renders correctly', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Bold text should render as <strong> not literal **text**
      // Check that "Use Cases:" is bold
      const boldText = detailsDialog.locator('strong', { hasText: 'Use Cases:' })
      await expect(boldText).toBeVisible()

      // Should NOT contain literal asterisks
      const content = await detailsDialog.textContent()
      expect(content).not.toContain('**')
    })

    test('V-CONTROL-06-S4: Markdown code renders correctly', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      const detailsBtn = modal.getByRole('button', { name: 'Details' })
      await detailsBtn.click()

      const detailsDialog = page.locator('[role="dialog"]').first()
      await expect(detailsDialog).toBeVisible()

      // Inline code should render as <code> not literal `code`
      const codeElement = detailsDialog.locator('code', { hasText: 'duration' })
      await expect(codeElement).toBeVisible()
    })
  })

  // ==========================================================================
  // V-CONTROL-07: Version-Specific Parameters
  // ==========================================================================

  test.describe('V-CONTROL-07: Version-Specific Parameters', () => {
    test('V-CONTROL-07-S2: Production version (1.0.0) shows parameters', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Should be on 1.0.0 by default
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toContainText('1.0.0')

      // Duration parameter should be visible (integer input)
      const durationInput = modal.locator('[data-testid="param-input-duration"]')
      await expect(durationInput).toBeVisible()
    })

    test('V-CONTROL-07-S5: Production version with empty required param disables Save', async ({
      page,
    }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // On 1.0.0, duration is required but empty
      const saveBtn = modal.getByRole('button', { name: 'Save' })
      await expect(saveBtn).toBeDisabled()

      // Fill duration (integer input)
      const durationInput = modal.locator('[data-testid="param-input-duration"]')
      await durationInput.fill('5')

      // Save should now be enabled
      await expect(saveBtn).toBeEnabled()
    })
  })

  // ==========================================================================
  // V-CONTROL-08: Initial Version on Canvas Drop
  // ==========================================================================

  test.describe('V-CONTROL-08: Initial Version on Canvas', () => {
    // No inline version label on the canvas. The configuration
    // modal header is the only version-display surface. S1-S4 below assert the
    // legacy inline label is gone; S5 still verifies the modal version.
    test('V-CONTROL-08-S1: Delay drop renders without inline version on the canvas', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      const node = await dropControlAndSelect(page, 'delay', 'delay')

      await expect(node).not.toContainText('1.0.0')
    })

    test('V-CONTROL-08-S2: If/Else drop renders without inline version on the canvas', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      const node = await dropControlAndSelect(page, 'if-else', 'if')

      await expect(node).not.toContainText('1.0.0')
    })

    test('V-CONTROL-08-S3: Assert drop renders without inline version on the canvas', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      const node = await dropControlAndSelect(page, 'assert', 'assert')

      await expect(node).not.toContainText('1.0.0')
    })

    test('V-CONTROL-08-S4: Parallel drop renders without inline version on the canvas', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      const node = await dropControlAndSelect(page, 'parallel', 'parallel')

      await expect(node).not.toContainText('1.0.0')
    })

    test('V-CONTROL-08-S5: Version on node matches version in modal', async ({ page }) => {
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await dropControlAndSelect(page, 'delay', 'delay')
      const modal = await openConfigModal(page)

      // Modal shows 1.0.0
      const versionSelector = modal.locator('[data-testid="version-selector"]')
      await expect(versionSelector).toContainText('1.0.0')
    })
  })
})
