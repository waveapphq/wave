/**
 * V-CANVAS-14: Workbench Execution Controls
 *
 * Design Decisions: RUN-1 to RUN-15, ENV-1 to ENV-16, DEBUG-1 to DEBUG-8
 * REQ: REQ-3.2.1.1 (Normal execution - run to completion)
 *
 * Main Purpose: Verify the environment selector, run/debug controls, and execution
 * dialogs in the canvas workbench.
 *
 * Pass Criteria:
 * 1. Environment selector visible in toolbar (RUN-1)
 * 2. Environment popover has search, recent, all sections (RUN-2, ENV-1 to ENV-12)
 * 3. Remember selection checkbox present and functional (RUN-3, ENV-14 to ENV-16)
 * 4. Run button opens env dialog when no env selected (RUN-4)
 * 5. Run split button with dropdown menu (RUN-5, RUN-7, RUN-8)
 * 6. Debug split button with dropdown menu (RUN-6, DEBUG-1, DEBUG-2)
 * 7. Debug options gear with checkboxes (RUN-10 to RUN-12, DEBUG-4 to DEBUG-8)
 * 8. Run/Debug enabled after environment selection
 * 9. Environment dialog search filters environments
 * 10. Reset disabled in idle state, enabled in terminal states
 * 11. Idle controls visible in idle/terminal states
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasToolbar } from '../../helpers/canvas'
import { exec } from '../../helpers/exec'
import { BACKEND_PORT } from '../../helpers/config'

/**
 * Helper to get the first environment from the visible list
 */
async function getFirstEnvironment(page: Page): Promise<{ name: string; testId: string } | null> {
  const envItems = page.locator('[data-testid^="env-"][data-testid$="-item"]').first()
  if (await envItems.isVisible()) {
    const testId = await envItems.getAttribute('data-testid')
    const name = await envItems.textContent()
    return { name: name || '', testId: testId || '' }
  }
  // Fallback: look for any button in All Environments section
  const allEnvSection = page.locator('text=All Environments').locator('..').locator('..')
  const firstBtn = allEnvSection.locator('button').first()
  if (await firstBtn.isVisible()) {
    const name = await firstBtn.textContent()
    return { name: name || '', testId: '' }
  }
  return null
}

test.describe('V-CANVAS-14: Workbench Execution Controls', () => {
  test.beforeAll(() => {
    // Reset and seed environments for testing
    exec('chmod +x ./tests/e2e/fixtures/canvas/v-canvas-14/01-seed.sh')
    exec('./tests/e2e/fixtures/canvas/v-canvas-14/01-seed.sh')
  })

  test.beforeEach(async ({ page }) => {
    // Clear any backend execution session from previous tests
    // to ensure clean execution state for each test
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {
      // Ignore errors - session may not exist
    })
  })

  // ============================================================================
  // Environment Selector Popover Tests (ENV-1 to ENV-16)
  // ============================================================================

  test('V-CANVAS-14-S1: Environment selector popover opens on click', async ({ page }) => {
    // Per ENV-1: Button shows blue border when active
    // Per ENV-2: Popup below trigger, left-aligned
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector).toBeVisible()
    await expect(envSelector).toContainText('Select Environment')

    // Click to open popover
    await envSelector.click()

    // Verify popover is visible (ENV-2, ENV-3)
    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()
  })

  test('V-CANVAS-14-S2: Environment popover has search input', async ({ page }) => {
    // Per ENV-4: Search: "Search environments..."
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="environment-selector"]').click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    // Verify search input exists with placeholder
    const searchInput = page.locator('[data-testid="environment-search"]')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', 'Search environments…')
  })

  test('V-CANVAS-14-S3: Environment popover shows All Environments section', async ({ page }) => {
    // Per ENV-10: ALL ENVIRONMENTS header style
    // Per ENV-11: Alphabetical, scrollable
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="environment-selector"]').click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    // Verify "All Environments" section header exists
    const allEnvHeader = envPopover.locator('text=All Environments')
    await expect(allEnvHeader).toBeVisible()

    // Verify at least one environment is listed (seeded by fixture)
    const envList = envPopover.locator('button:has-text("Development"), button:has-text("Staging"), button:has-text("Production")')
    const count = await envList.count()
    expect(count, 'Should have seeded environments visible').toBeGreaterThan(0)
  })

  test('V-CANVAS-14-S4: Environment popover search filters results', async ({ page }) => {
    // Per ENV-4: Search filters environments
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="environment-selector"]').click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    // Type in search to filter
    const searchInput = page.locator('[data-testid="environment-search"]')
    await searchInput.fill('Prod')

    // Wait for filtering
    await page.waitForTimeout(100)

    // Production should be visible, Development should not
    await expect(envPopover.locator('button:has-text("Production")')).toBeVisible()
    await expect(envPopover.locator('button:has-text("Development")')).not.toBeVisible()
  })

  test('V-CANVAS-14-S5: Remember selection checkbox present', async ({ page }) => {
    // Per ENV-14 to ENV-16: Checkbox "Remember selection", unchecked by default
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="environment-selector"]').click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    // Verify checkbox exists with label
    const rememberCheckbox = page.locator('[data-testid="remember-selection-checkbox"]')
    await expect(rememberCheckbox).toBeVisible()

    // Verify label text
    const checkboxLabel = envPopover.locator('text=Remember selection')
    await expect(checkboxLabel).toBeVisible()
  })

  test('V-CANVAS-14-S6: Selecting environment updates selector button', async ({ page }) => {
    // Per ENV-7: Selected shows checkmark and updates button text
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    const envSelector = page.locator('[data-testid="environment-selector"]')
    await envSelector.click()

    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()

    // Click on Development environment
    const devEnv = envPopover.locator('button:has-text("Development")').first()
    await devEnv.click()

    // Popover should close
    await expect(envPopover).not.toBeVisible()

    // Selector should now show the selected environment
    await expect(envSelector).toContainText('Development')
  })

  // ============================================================================
  // Run/Debug Button Tests (RUN-5 to RUN-8, DEBUG-1 to DEBUG-3)
  // ============================================================================

  test('V-CANVAS-14-S7: Run button opens env dialog when no environment selected', async ({ page }) => {
    // Per RUN-4: Run disabled until environment selected (first time)
    // Behavior: When no env, clicking Run opens env selection dialog
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Verify no environment selected
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector).toContainText('Select Environment')

    // Click Run button (main part, not dropdown)
    const runButton = page.locator('[data-testid="run-button"]')
    await runButton.click()

    // Environment selection dialog should appear
    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    // Dialog title should be "Run Test"
    const dialogTitle = envDialog.locator('h2')
    await expect(dialogTitle).toHaveText('Run Test')
  })

  test('V-CANVAS-14-S8: Debug button opens env dialog when no environment selected', async ({ page }) => {
    // Same behavior as Run for Debug button
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    const debugButton = page.locator('[data-testid="debug-button"]')
    await debugButton.click()

    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    const dialogTitle = envDialog.locator('h2')
    await expect(dialogTitle).toHaveText('Debug Test')
  })

  test('V-CANVAS-14-S9: Run dropdown shows Run Scope and Run All options', async ({ page }) => {
    // Per RUN-7, RUN-8: Primary click = current scope, dropdown shows options
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // First select an environment so dropdown is enabled
    await page.locator('[data-testid="environment-selector"]').click()
    await page.locator('[data-testid="environment-popover"] button:has-text("Development")').first().click()

    // Click the Run dropdown trigger (not the main button)
    const runDropdown = page.locator('[data-testid="run-button-dropdown"]')
    await expect(runDropdown).toBeEnabled()
    await runDropdown.click()

    // Verify dropdown options
    await expect(page.locator('[data-testid="run-current-option"]')).toBeVisible()
    await expect(page.locator('[data-testid="run-all-option"]')).toBeVisible()
  })

  test('V-CANVAS-14-S10: Debug dropdown shows Debug Scope and Debug All options', async ({ page }) => {
    // Per DEBUG-1: Dropdown mirrors Run
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // First select an environment
    await page.locator('[data-testid="environment-selector"]').click()
    await page.locator('[data-testid="environment-popover"] button:has-text("Development")').first().click()

    // Click the Debug dropdown trigger
    const debugDropdown = page.locator('[data-testid="debug-button-dropdown"]')
    await expect(debugDropdown).toBeEnabled()
    await debugDropdown.click()

    // Verify dropdown options
    await expect(page.locator('[data-testid="debug-current-option"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-all-option"]')).toBeVisible()
  })

  test('V-CANVAS-14-S11: Run/Debug dropdowns disabled when no environment selected', async ({ page }) => {
    // Per design: Dropdown triggers disabled without environment
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Verify no environment selected
    await expect(page.locator('[data-testid="environment-selector"]')).toContainText('Select Environment')

    // Dropdown triggers should be disabled
    const runDropdown = page.locator('[data-testid="run-button-dropdown"]')
    const debugDropdown = page.locator('[data-testid="debug-button-dropdown"]')

    await expect(runDropdown).toBeDisabled()
    await expect(debugDropdown).toBeDisabled()
  })

  // ============================================================================
  // Debug Options Gear Tests (RUN-10 to RUN-12, DEBUG-4 to DEBUG-8)
  // ============================================================================

  test('V-CANVAS-14-S12: Debug options gear opens popover with checkboxes', async ({ page }) => {
    // Per DEBUG-4 to DEBUG-5: Gear triggers popover with two checkboxes
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    const debugGear = page.locator('[data-testid="debug-options-gear"]')
    await debugGear.click()

    const debugPopover = page.locator('[data-testid="debug-options-popover"]')
    await expect(debugPopover).toBeVisible()

    // Verify both checkboxes present (DEBUG-5)
    await expect(page.locator('[data-testid="pause-on-first-checkbox"]')).toBeVisible()
    await expect(page.locator('[data-testid="pause-on-errors-checkbox"]')).toBeVisible()
  })

  test('V-CANVAS-14-S13: Debug options checkboxes unchecked by default', async ({ page }) => {
    // Per DEBUG-6: Checkboxes unchecked by default
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="debug-options-gear"]').click()

    const pauseOnFirst = page.locator('[data-testid="pause-on-first-checkbox"]')
    const pauseOnErrors = page.locator('[data-testid="pause-on-errors-checkbox"]')

    // Verify checkboxes are not checked initially
    await expect(pauseOnFirst).not.toBeChecked()
    await expect(pauseOnErrors).not.toBeChecked()
  })

  test('V-CANVAS-14-S14: Debug gear highlights when options active', async ({ page }) => {
    // Per DEBUG-4: Gear $blue10 when active
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    const debugGear = page.locator('[data-testid="debug-options-gear"]')

    // Initially not highlighted (no options active)
    await expect(debugGear).not.toHaveClass(/text-primary/)

    // Click to open and check an option
    await debugGear.click()
    const pauseOnFirst = page.locator('[data-testid="pause-on-first-checkbox"]')
    await pauseOnFirst.click()

    // Close popover by clicking elsewhere
    await page.locator('[data-testid="canvas-toolbar"]').click({ position: { x: 10, y: 10 } })

    // Gear should now be highlighted
    await expect(debugGear).toHaveClass(/text-primary/)
  })

  // ============================================================================
  // Environment Selection Dialog Tests
  // ============================================================================

  test('V-CANVAS-14-S15: Env dialog has search, list, and confirm/cancel buttons', async ({ page }) => {
    // Per design: Dialog has search, environment list, Cancel and Run/Debug buttons
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="run-button"]').click()

    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    // Search input
    await expect(page.locator('[data-testid="env-dialog-search"]')).toBeVisible()

    // Cancel button
    await expect(page.locator('[data-testid="env-dialog-cancel"]')).toBeVisible()

    // Confirm button (disabled initially)
    const confirmButton = page.locator('[data-testid="env-dialog-confirm"]')
    await expect(confirmButton).toBeVisible()
    await expect(confirmButton).toBeDisabled()
  })

  test('V-CANVAS-14-S16: Env dialog confirm enabled after selection', async ({ page }) => {
    // Selecting an environment enables the confirm button
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="run-button"]').click()

    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    // Select an environment by clicking it
    const envButton = envDialog.locator('button:has-text("Development")').first()
    await envButton.click()

    // Confirm button should now be enabled
    const confirmButton = page.locator('[data-testid="env-dialog-confirm"]')
    await expect(confirmButton).toBeEnabled()
  })

  test('V-CANVAS-14-S17: Env dialog search filters environments', async ({ page }) => {
    // Per design: Search filters the environment list
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="run-button"]').click()

    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    const searchInput = page.locator('[data-testid="env-dialog-search"]')
    await searchInput.fill('Stag')

    await page.waitForTimeout(100)

    // Only Staging should be visible
    await expect(envDialog.locator('button:has-text("Staging")')).toBeVisible()
    await expect(envDialog.locator('button:has-text("Development")')).not.toBeVisible()
  })

  test('V-CANVAS-14-S18: Env dialog cancel closes without action', async ({ page }) => {
    // Cancel button closes dialog without selecting environment
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    await page.locator('[data-testid="run-button"]').click()

    const envDialog = page.locator('[data-testid="env-selection-dialog"]')
    await expect(envDialog).toBeVisible()

    // Click Cancel
    await page.locator('[data-testid="env-dialog-cancel"]').click()

    // Dialog should close
    await expect(envDialog).not.toBeVisible()

    // Environment selector should still show placeholder
    await expect(page.locator('[data-testid="environment-selector"]')).toContainText('Select Environment')
  })

  // ============================================================================
  // Reset and State Tests
  // ============================================================================

  test('V-CANVAS-14-S19: Reset link disabled in idle state', async ({ page }) => {
    // Per design: Reset disabled when status is idle
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Check workflow status is idle
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'idle')

    // Verify Reset link is disabled
    const resetLink = page.locator('[data-testid="breadcrumb-reset-link"]')
    await expect(resetLink).toBeDisabled()
  })

  test('V-CANVAS-14-S20: Idle controls visible in idle state', async ({ page }) => {
    // Per design: Idle state shows environment selector, Debug, Run
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Verify idle controls are visible
    await expect(page.locator('[data-testid="environment-selector"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-options-gear"]')).toBeVisible()
    await expect(page.locator('[data-testid="debug-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="run-button"]')).toBeVisible()

    // Verify running controls are NOT visible
    await expect(page.locator('[data-testid="action-pause-button"]')).not.toBeVisible()
    await expect(page.locator('[data-testid="action-stop-button"]')).not.toBeVisible()
  })

  test('V-CANVAS-14-S21: Run button enabled after environment selection', async ({ page }) => {
    // Per RUN-4: Run enabled after environment selection
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Initially Run dropdown is disabled (no env)
    await expect(page.locator('[data-testid="run-button-dropdown"]')).toBeDisabled()

    // Select an environment
    await page.locator('[data-testid="environment-selector"]').click()
    await page.locator('[data-testid="environment-popover"] button:has-text("Development")').first().click()

    // Now dropdown should be enabled
    await expect(page.locator('[data-testid="run-button-dropdown"]')).toBeEnabled()
    await expect(page.locator('[data-testid="debug-button-dropdown"]')).toBeEnabled()
  })
})
