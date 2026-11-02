/**
 * V-VALIDATE-LOAD-01: Validation System Comprehensive Tests
 *
 * Covers the full validation system:
 * - Clean load (no errors, no alert icon)
 * - Visible warnings only (no dialog, no toast, persistent alert icon on the node)
 * - Fatal errors (dialog with Close only)
 * - Invisible (auto-fixable) errors (dialog with Fix All)
 * - Save-time 422 rejection (unified modal "Cannot Save Test"; close pulses alert icon)
 * - Run-time pre-validation (unified modal "Cannot Run Test"; close pulses alert icon)
 * - Debug-time pre-validation (unified modal "Cannot Debug Test")
 * - API-only validation (invalid context parameter)
 *
 * Fixture: tests/e2e/fixtures/canvas/v-validate-load-01/
 * Seeds one environment ("Validation Env") + 16 test entities.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import { exec } from '../../helpers/exec'
import { BACKEND_URL } from '../../helpers/config'

// Deterministic test IDs per scenario
const ID = {
  S01: 'ad010e00-0001-0001-0001-000000000001',
  S02: 'ad010e00-0002-0002-0002-000000000002',
  S03: 'ad010e00-0003-0003-0003-000000000003',
  S04: 'ad010e00-0004-0004-0004-000000000004',
  S05: 'ad010e00-0005-0005-0005-000000000005',
  S06: 'ad010e00-0006-0006-0006-000000000006',
  S07: 'ad010e00-0007-0007-0007-000000000007',
  S08: 'ad010e00-0008-0008-0008-000000000008',
  S09: 'ad010e00-0009-0009-0009-000000000009',
  S10: 'ad010e00-0010-0010-0010-000000000010',
  S11: 'ad010e00-0011-0011-0011-000000000011',
  S12: 'ad010e00-0012-0012-0012-000000000012',
  S13: 'ad010e00-0013-0013-0013-000000000013',
  S14: 'ad010e00-0014-0014-0014-000000000014',
  S15: 'ad010e00-0015-0015-0015-000000000015',
  S16: 'ad010e00-0016-0016-0016-000000000016',
}

// Environment seeded by 01-seed.sh for the Run/Debug pre-validation tests
const VALIDATION_ENV_NAME = 'Validation Env'

// Common selectors
const SEL = {
  dialog: '[data-testid="validation-error-dialog"]',
  errorList: '[data-testid="validation-error-list"]',
  errorCount: '[data-testid="validation-error-count"]',
  closeBtn: '[data-testid="validation-close-btn"]',
  fixAllBtn: '[data-testid="validation-fix-all-btn"]',
  canvas: '[data-testid="workflow-canvas"]',
  saveBtn: '[data-testid="toolbar-save-button"]',
  runBtn: '[data-testid="run-button"]',
  debugBtn: '[data-testid="debug-button"]',
  alertIcon: '[data-testid="node-validation-alert"]',
  envSelector: '[data-testid="environment-selector"]',
  envPopover: '[data-testid="environment-popover"]',
}

/** Navigate to workbench for a test ID and wait for initial load */
async function loadTest(page: Page, testId: string): Promise<void> {
  // Clear any active execution state from prior tests to avoid the
  // "Active Execution State" dialog blocking navigation
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
}

/** Wait for the validation dialog to appear */
async function waitForDialog(page: Page): Promise<void> {
  await expect(page.locator(SEL.dialog)).toBeVisible({ timeout: 15000 })
}

/** Wait for canvas to be visible with workflow loaded */
async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.locator(SEL.canvas)).toBeVisible({ timeout: 15000 })
}

/** Assert the validation dialog is NOT visible */
async function assertNoDialog(page: Page): Promise<void> {
  // Give the page time to settle, then verify no dialog appeared
  await page.waitForTimeout(1000)
  await expect(page.locator(SEL.dialog)).not.toBeVisible()
}

/** Assert no warning toast appeared. Validation warnings drive the static alert icon. */
async function assertNoWarningToast(page: Page): Promise<void> {
  await page.waitForTimeout(1000)
  const toast = page.locator('[data-toast]').filter({ has: page.locator('[data-toast-icon="warning"]') })
  await expect(toast).toHaveCount(0)
}

/** Assert the persistent alert badge is visible on the given workflow node. */
async function assertAlertIconVisible(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  const alert = node.locator(SEL.alertIcon)
  await expect(alert).toBeVisible({ timeout: 10000 })
}

/** Assert that the alert icon on the given node currently carries the
 *  pulse animation class. */
async function assertAlertIconPulses(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  const alert = node.locator(SEL.alertIcon)
  await expect(alert).toHaveClass(/animate-validation-icon-pulse/, { timeout: 5000 })
}

/** Pick the seeded "Validation Env" environment so the Run / Debug split
 *  buttons leave the no-env warning path. */
async function selectValidationEnvironment(page: Page): Promise<void> {
  await page.locator(SEL.envSelector).click()
  const popover = page.locator(SEL.envPopover)
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${VALIDATION_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

/** Click Fix All and wait for dialog to close and canvas to load */
async function clickFixAllAndWait(page: Page): Promise<void> {
  await page.locator(SEL.fixAllBtn).click()
  await expect(page.locator(SEL.dialog)).not.toBeVisible({ timeout: 15000 })
  await expect(page.locator(SEL.canvas)).toBeVisible({ timeout: 10000 })
  await expect(page).toHaveURL(/\/workbench/, { timeout: 5000 })
}

/** Click Close and wait for navigation to /tests */
async function clickCloseAndNavigateAway(page: Page): Promise<void> {
  await page.locator(SEL.closeBtn).click()
  await expect(page).toHaveURL(/\/tests/, { timeout: 5000 })
}

test.describe('V-VALIDATE-LOAD-01: Validation System', () => {
  // Seed once - each test uses a unique entity ID so no cross-contamination,
  // even for Fix All tests that mutate their own entity via POST /tests/{id}/fix
  test.beforeAll(() => {
    exec('tests/e2e/fixtures/canvas/v-validate-load-01/01-seed.sh')
  })

  // =========================================================================
  // Group 1: Clean / No-Dialog
  // =========================================================================

  test.describe('Clean Load', () => {
    test('S1: Clean test loads without dialog or toast', async ({ page }) => {
      await loadTest(page, ID.S01)
      await waitForCanvas(page)

      // No dialog should appear
      await assertNoDialog(page)

      // No warning toast
      await assertNoWarningToast(page)

      // Node should be rendered
      await expect(page.getByText('My HTTP Call')).toBeVisible()
    })

    test('S11: Disabled node skips param validation - clean load', async ({ page }) => {
      await loadTest(page, ID.S11)
      await waitForCanvas(page)

      // No dialog - disabled node's missing params are skipped
      await assertNoDialog(page)

      // No warning toast
      await assertNoWarningToast(page)

      // Disabled node should be visible
      await expect(page.getByText('Disabled HTTP')).toBeVisible()

      // Also verify run context passes (disabled nodes skip param validation on run too)
      const runResponse = await page.request.post(
        `${BACKEND_URL}/tests/${ID.S11}/validate?context=run`
      )
      expect(runResponse.status()).toBe(200)
      const runBody = await runResponse.json()
      expect(runBody.data.fatal).toBe(false)
      expect(runBody.data.errors).toHaveLength(0)
      expect(runBody.data.warnings).toHaveLength(0)
    })
  })

  // =========================================================================
  // Group 2: Visible Warnings -> Static Alert Icon (no modal, no toast)
  // =========================================================================

  test.describe('Warnings', () => {
    test('S2: Missing required params on load surface as static alert icon (no modal, no toast)', async ({ page }) => {
      await loadTest(page, ID.S02)
      await waitForCanvas(page)

      // No dialog should appear (warnings do not trigger the unified modal on Load).
      await assertNoDialog(page)

      // No warning toast either - validation warnings are conveyed exclusively
      // by the persistent alert badge on the affected node.
      await assertNoWarningToast(page)

      // Canvas should load with the node
      await expect(page.getByText('HTTP Node')).toBeVisible()

      // The HTTP node has REQUIRED_PARAM_MISSING for url + method, so the
      // alert badge must render at the top-left of the node body.
      await assertAlertIconVisible(page, 'n1')
    })
  })

  // =========================================================================
  // Group 3: Fatal Dialog
  // =========================================================================

  test.describe('Fatal Errors', () => {
    test('S9: MISSING_WORKFLOW shows fatal dialog with Close only', async ({ page }) => {
      await loadTest(page, ID.S09)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)

      // Title should indicate fatal
      await expect(dialog.getByText('Cannot Load Test')).toBeVisible()

      // Only Close button visible (no Fix All)
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()
      await expect(dialog.locator(SEL.fixAllBtn)).not.toBeVisible()

      // Error list should mention MISSING_WORKFLOW
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('MISSING_WORKFLOW')

      // Click Close -> navigates to /tests
      await clickCloseAndNavigateAway(page)
    })

    test('S10: INVALID_NODES shows fatal dialog with Close only', async ({ page }) => {
      await loadTest(page, ID.S10)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)

      // Title should indicate fatal
      await expect(dialog.getByText('Cannot Load Test')).toBeVisible()

      // Only Close button (no Fix All)
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()
      await expect(dialog.locator(SEL.fixAllBtn)).not.toBeVisible()

      // Error list should mention INVALID_NODES
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('INVALID_NODES')

      // Click Close -> navigates to /tests
      await clickCloseAndNavigateAway(page)
    })
  })

  // =========================================================================
  // Group 4: Fixable Dialog + Fix All
  // =========================================================================

  test.describe('Fixable Errors', () => {
    test('S3: MISSING_LABEL - dialog appears, Fix All generates label', async ({ page }) => {
      await loadTest(page, ID.S03)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)

      // Fixable variant title
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()

      // Error count badge should be visible
      await expect(dialog.locator(SEL.errorCount)).toBeVisible()

      // Error list should describe the issue (fixable dialog shows messages, not codes)
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('Block must have a name')

      // Both Close and Fix All should be visible
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()
      await expect(dialog.locator(SEL.fixAllBtn)).toBeVisible()

      // Click Fix All
      await clickFixAllAndWait(page)

      // After fix, the block carries its type's palette name (EXEC-25)
      await expect(page.getByTestId('workflow-node-body-n1')).toHaveText('HTTP')
    })

    test('S4: DANGLING_EDGE - dialog appears, Fix All removes dangling edge', async ({ page }) => {
      await loadTest(page, ID.S04)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()

      // Error list should mention dangling edge
      await expect(dialog.locator(SEL.errorList)).toContainText('references non-existent block')

      // Click Fix All
      await clickFixAllAndWait(page)

      // Node should be present after fix
      await expect(page.getByText('HTTP Call')).toBeVisible()
    })

    test('S5: UNKNOWN_BLOCK_TYPE - Fix All removes unknown node + connected edges', async ({ page }) => {
      await loadTest(page, ID.S05)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()
      await expect(dialog.locator(SEL.errorList)).toContainText('Unknown block type')

      // Click Fix All
      await clickFixAllAndWait(page)

      // Node A and C should remain, Node B (unknown) removed
      await expect(page.getByTestId('workflow-node-nA')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nC')).toBeVisible()
      // Node B should be gone
      await expect(page.getByTestId('workflow-node-nB')).not.toBeVisible()
    })

    test('S6: SELF_LOOP_EDGE - Fix All removes self-loop, preserves chain', async ({ page }) => {
      await loadTest(page, ID.S06)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()
      await expect(dialog.locator(SEL.errorList)).toContainText('same source and target')

      // Click Fix All
      await clickFixAllAndWait(page)

      // All three nodes should still be present (chain preserved minus self-loop)
      await expect(page.getByTestId('workflow-node-nA')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nB')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nC')).toBeVisible()
    })

    test('S7: INVALID_VARIABLE - Fix All handles 3 refactor cases', async ({ page }) => {
      await loadTest(page, ID.S07)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()

      // Should show invalid variable name errors
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('Invalid variable name')

      // Should have exactly 3 INVALID_VARIABLE rows (one per bad-named variable)
      const varErrorRows = errorList.locator('tr').filter({ hasText: 'Invalid variable name' })
      await expect(varErrorRows).toHaveCount(3)

      // Click Fix All
      await clickFixAllAndWait(page)

      // Nodes should still be present after fix
      await expect(page.getByText('HTTP Request')).toBeVisible()
      await expect(page.getByText('Log Same 1')).toBeVisible()
    })

    test('S8: INVALID_VARIABLE_TYPE - Fix All corrects bogus type to string', async ({ page }) => {
      await loadTest(page, ID.S08)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()
      await expect(dialog.locator(SEL.errorList)).toContainText('Invalid variable type')

      // Click Fix All
      await clickFixAllAndWait(page)

      // Canvas should load (even though no nodes, canvas container should be visible)
      await expect(page.locator(SEL.canvas)).toBeVisible()
    })

    test('S14: MULTIPLE_EDGES - Fix All removes excess edges', async ({ page }) => {
      await loadTest(page, ID.S14)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()
      await expect(dialog.locator(SEL.errorList)).toContainText('outgoing edges')

      // Click Fix All
      await clickFixAllAndWait(page)

      // All nodes should remain (only edges are removed)
      await expect(page.getByTestId('workflow-node-nA')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nB')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nC')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nD')).toBeVisible()
    })

    test('S15: SELF_LOOP + MULTIPLE_EDGES - Fix All handles combined errors', async ({ page }) => {
      await loadTest(page, ID.S15)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()

      // Both error types should be listed
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('same source and target')
      await expect(errorList).toContainText('outgoing edges')

      // Click Fix All
      await clickFixAllAndWait(page)

      // All nodes should remain (fixes only remove edges)
      await expect(page.getByTestId('workflow-node-nA')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nB')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nC')).toBeVisible()
      await expect(page.getByTestId('workflow-node-nD')).toBeVisible()
    })

    test('S16: MISSING_POSITION + INVALID_POSITION - Fix All assigns positions', async ({ page }) => {
      await loadTest(page, ID.S16)
      await waitForDialog(page)

      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Test Issues Found')).toBeVisible()

      // Both position error types should be listed
      const errorList = dialog.locator(SEL.errorList)
      await expect(errorList).toContainText('must have a position')
      await expect(errorList).toContainText('must be numeric')

      // Click Fix All
      await clickFixAllAndWait(page)

      // All 4 nodes should be visible after position fix
      await expect(page.getByText('Good Node A')).toBeVisible()
      await expect(page.getByText('Missing Position B')).toBeVisible()
      await expect(page.getByText('Invalid Position C')).toBeVisible()
      await expect(page.getByText('Good Node D')).toBeVisible()
    })
  })

  // =========================================================================
  // Group 5: Save-Time Validation
  // =========================================================================

  test.describe('Save-Time Validation', () => {
    test('S13: Save with missing params shows "Cannot Save Test" modal; close pulses the alert icon', async ({ page }) => {
      await loadTest(page, ID.S13)
      await waitForCanvas(page)

      // No warning toast - load warnings drive the alert icon instead.
      await assertNoWarningToast(page)

      // Canvas loads normally with the node
      await expect(page.getByText('HTTP Node')).toBeVisible()

      // Static alert icon is visible on the affected node before any save attempt.
      await assertAlertIconVisible(page, 'n1')

      // Dirty the canvas by dragging a new block from palette (reliable pattern)
      const palette = page.locator('[data-testid="block-palette"]')
      const paletteState = await palette.getAttribute('data-state')
      if (paletteState === 'collapsed') {
        await page.locator('[data-testid="palette-expand-button"]').click()
        await expect(palette).toHaveAttribute('data-state', 'expanded')
      }
      const searchInput = page.locator('[data-testid="palette-search-input"]')
      await searchInput.fill('log')
      await page.waitForTimeout(100)
      const canvas = page.locator(SEL.canvas)
      const canvasBox = await canvas.boundingBox()
      await dragPaletteItemToCanvas(page, 'log', { x: canvasBox!.width / 2, y: canvasBox!.height / 2 })
      await page.waitForTimeout(200)

      // Click save button
      const saveBtn = page.locator(SEL.saveBtn)
      // Wait for save button to be enabled (canvas should be dirty after drop)
      await expect(saveBtn).toBeEnabled({ timeout: 5000 })
      await saveBtn.click()

      // Save-mode validation dialog should appear
      await waitForDialog(page)
      const dialog = page.locator(SEL.dialog)

      // Title should show save-mode variant
      await expect(dialog.getByText('Cannot Save Test')).toBeVisible()

      // No Fix All button in save mode
      await expect(dialog.locator(SEL.fixAllBtn)).not.toBeVisible()

      // Close button is visible
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()

      // Click Close - should stay on canvas (not navigate away)
      await dialog.locator(SEL.closeBtn).click()
      await expect(page.locator(SEL.dialog)).not.toBeVisible({ timeout: 5000 })
      await expect(page).toHaveURL(/\/workbench/, { timeout: 5000 })

      // Closing the unified modal triggers the pulse on the
      // affected node's alert icon (transient cue that the modal is gone).
      await assertAlertIconPulses(page, 'n1')
    })
  })

  // =========================================================================
  // Group 7: Run / Debug Pre-Validation
  // =========================================================================
  //
  // Reuses the S13 fixture (HTTP node with empty params - REQUIRED_PARAM_MISSING
  // for url + method). On Run / Debug, the validation API treats those as errors
  // (visible class), so the unified modal opens with mode='run' / 'debug'.

  test.describe('Run / Debug Pre-Validation', () => {
    test('S17: Run with missing params shows "Cannot Run Test" modal; close pulses alert icon', async ({ page }) => {
      await loadTest(page, ID.S13)
      await waitForCanvas(page)

      // Static alert icon is visible on load (REQUIRED_PARAM_MISSING is visible class).
      await assertAlertIconVisible(page, 'n1')

      await selectValidationEnvironment(page)

      // Click the Run primary action; the pre-run validation gate should
      // produce the unified modal in mode='run'.
      await page.locator(SEL.runBtn).click()
      await waitForDialog(page)
      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Cannot Run Test')).toBeVisible()

      // Run / Debug modes never show Fix All or Delete Test - only Close.
      await expect(dialog.locator(SEL.fixAllBtn)).not.toBeVisible()
      await expect(dialog.locator('[data-testid="validation-delete-test-btn"]')).not.toBeVisible()
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()

      // Close the modal - we stay on canvas and the alert icon pulses.
      await dialog.locator(SEL.closeBtn).click()
      await expect(page.locator(SEL.dialog)).not.toBeVisible({ timeout: 5000 })
      await expect(page).toHaveURL(/\/workbench/, { timeout: 5000 })
      await assertAlertIconPulses(page, 'n1')
    })

    test('S18: Debug with missing params shows "Cannot Debug Test" modal', async ({ page }) => {
      await loadTest(page, ID.S13)
      await waitForCanvas(page)

      await assertAlertIconVisible(page, 'n1')

      await selectValidationEnvironment(page)

      // Click the Debug primary action; pre-debug validation gate should
      // produce the unified modal in mode='debug'.
      await page.locator(SEL.debugBtn).click()
      await waitForDialog(page)
      const dialog = page.locator(SEL.dialog)
      await expect(dialog.getByText('Cannot Debug Test')).toBeVisible()
      await expect(dialog.locator(SEL.fixAllBtn)).not.toBeVisible()
      await expect(dialog.locator(SEL.closeBtn)).toBeVisible()

      // Close - pulse appears on the affected node.
      await dialog.locator(SEL.closeBtn).click()
      await expect(page.locator(SEL.dialog)).not.toBeVisible({ timeout: 5000 })
      await assertAlertIconPulses(page, 'n1')
    })
  })

  // =========================================================================
  // Group 6: API-Only
  // =========================================================================

  test.describe('API Validation', () => {
    test('S12: Invalid context parameter returns 400', async ({ page }) => {
      // Direct API call - no UI needed
      const response = await page.request.post(
        `${BACKEND_URL}/tests/${ID.S12}/validate?context=bogus`
      )

      // Assert HTTP 400
      expect(response.status()).toBe(400)

      const body = await response.json()
      // Error message should mention invalid context
      expect(body.error.message).toContain('Invalid validation context')
      expect(body.error.message).toContain('bogus')
    })
  })
})
