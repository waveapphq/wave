/**
 * V-CANVAS-03-S40/S41: Canvas Context Menu Reset
 *
 * Design Decisions: CANVAS-68, CANVAS-69
 *
 * Pass Criteria:
 * S40:
 *   1. Canvas right-click menu shows Reset option (↺ icon, last item)
 *   2. Reset is disabled when execution status is idle
 *   3. Reset is disabled when execution status is running or paused
 *
 * S41:
 *   1. Reset is enabled when execution status is passed, failed, or stopped
 *   2. Clicking enabled Reset clears execution state only
 *   3. Skip/disable states are preserved (user intent) after Reset
 *   4. executionStatus and onReset are threaded as props from workbench-container
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasToolbar } from '../../helpers/canvas'
import { exec } from '../../helpers/exec'
import { BACKEND_PORT } from '../../helpers/config'

// Test ID from seed script (reuses v-canvas-04 fixture)
const TEST_ID = 'ac04e000-0001-0001-0001-000000000001'

async function selectEnvironment(page: Page, envName: string = 'Development') {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()

  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()

  const envButton = envPopover.locator(`button:has-text("${envName}")`).first()
  await envButton.click()

  await expect(envPopover).not.toBeVisible()
}

async function loadTestWorkflow(page: Page) {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${TEST_ID}`)
  await waitForCanvasLoad(page)
  await waitForCanvasToolbar(page)
  await expect(page.locator('[data-testid^="workflow-node-"][data-nodetype]')).toBeVisible({
    timeout: 10000,
  })
}

// Helper to open canvas context menu (right-click on empty area)
async function openCanvasContextMenu(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  await page.mouse.click(canvasBox!.x + canvasBox!.width - 50, canvasBox!.y + 50, { button: 'right' })

  const contextMenu = page.locator('[role="menu"]')
  await expect(contextMenu).toBeVisible()
  return contextMenu
}

test.describe('V-CANVAS-03-S40/S41: Canvas Context Menu Reset', () => {
  test.beforeAll(() => {
    exec('chmod +x ./tests/e2e/fixtures/canvas/v-canvas-04/01-seed.sh')
    exec('./tests/e2e/fixtures/canvas/v-canvas-04/01-seed.sh')
  })

  // ============================================================================
  // V-CANVAS-03-S40: Canvas context menu shows Reset (disabled when idle)
  // ============================================================================

  test('S40: canvas context menu shows Reset menu item', async ({ page }) => {
    // Per CANVAS-68: Reset option visible in canvas right-click menu
    await loadTestWorkflow(page)

    const contextMenu = await openCanvasContextMenu(page)

    // Reset should be visible as the last menu item
    const resetItem = contextMenu.getByText('Reset')
    await expect(resetItem).toBeVisible()
  })

  test('S40: Reset is disabled when execution status is idle', async ({ page }) => {
    // Per CANVAS-69: Reset disabled when idle/running/paused
    await loadTestWorkflow(page)

    // Verify idle status
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'idle')

    const contextMenu = await openCanvasContextMenu(page)

    // Reset should be disabled (aria-disabled or pointer-events-none class)
    const resetItem = contextMenu.getByText('Reset')
    await expect(resetItem).toHaveAttribute('aria-disabled', 'true')
  })

  // ============================================================================
  // V-CANVAS-03-S41: Canvas Reset enabled after execution completes
  // ============================================================================

  test('S41: Reset is enabled after execution completes (passed)', async ({ page }) => {
    // Per CANVAS-69: Reset enabled when status is passed/failed/stopped
    await loadTestWorkflow(page)

    // Run the test to get to a terminal state
    await selectEnvironment(page)
    const runButton = page.locator('[data-testid="run-button"]')
    await runButton.click()

    // Wait for execution to complete
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'passed', { timeout: 10000 })

    // Open canvas context menu
    const contextMenu = await openCanvasContextMenu(page)

    // Reset should now be enabled (no aria-disabled)
    const resetItem = contextMenu.getByText('Reset')
    await expect(resetItem).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('S41: clicking enabled Reset clears execution state', async ({ page }) => {
    // Per design: Reset clears execution state, returns to idle
    await loadTestWorkflow(page)

    // Run to completion
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'passed', { timeout: 10000 })

    // The canvas context-menu Reset resets INSTANTLY when the session
    // holds zero artifacts - no dialog of any kind (only artifact-holding
    // sessions get the container-level Reset Session? dialog).
    const contextMenu = await openCanvasContextMenu(page)
    await contextMenu.getByText('Reset').click()

    // The run state actually clears, with no confirmation in between
    await expect(statusIndicator).toHaveAttribute('data-status', 'idle', { timeout: 5000 })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByText('Reset Workflow?')).toHaveCount(0)

    // Node should no longer have execution status
    const workflowNode = page.locator('[data-testid="workflow-node-log-node-1"]')
    await expect(workflowNode).not.toHaveAttribute('data-execution-status')
  })
})
